import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { router, publicProcedure } from '../trpc';
import {
  verifySlipImage,
  receiverMatches,
  proxyMatches,
  hashSlipImage,
  EXPECTED_RECEIVING_BANK,
} from '../../rdcw';
import {
  mintPaymentToken,
  negCacheGet,
  negCacheSet,
  rateLimitHit,
  quotaCacheRead,
  quotaCacheWrite,
} from '../../redis';
import { tables, bookings } from '../../db/schema';
import { INDIVIDUAL_PRICE } from '../../../data/mockData';

// Abuse gates for the paid RDCW slip API (~115 lifetime calls). A single abuser
// gets ≤5 API-costing attempts per 10 min per IP and per session; identical
// re-uploads are free (negative cache); a distributed flood trips the breaker
// before the ceiling. Tuned for the 115-call quota — see plan.
const IP_LIMIT = 5;
const SESSION_LIMIT = 5;
const RL_WINDOW_SEC = 600; // 10 min
const QUOTA_RESERVE = 15; // keep this many calls for admin/edge cases

export const slipsRouter = router({
  // Verify an uploaded slip against RDCW: valid slip + correct payee + bank + the
  // server-authoritative amount for the thing being bought. On success, mint a
  // one-time payment token bound to {key, sessionId, amount} that confirmBooking
  // must consume — the client never gets to name its own price.
  //
  // Cheap → expensive: the RDCW call is the LAST resource spent, behind a hash
  // negative-cache, per-IP/session rate limit, and a global quota breaker.
  verify: publicProcedure
    .input(
      z.object({
        slipImage: z.string(), // data:image/…;base64,… from the browser
        // What's being paid for — the price is looked up server-side from this,
        // NOT sent by the client. tableId absent ⇒ a table-less individual ticket.
        tableId: z.string().regex(/^T\d{2}$/).optional(),
        bookingType: z.enum(['whole_table', 'individual_seats', 'individual']),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // ── Gate 1: negative cache. Same image bytes that already failed an
      // intrinsic check (wrong payee/bank/proxy) fail identically — return the
      // cached verdict with ZERO API calls. Pure CPU hash + one Redis GET.
      const hash = hashSlipImage(input.slipImage);
      const cached = await negCacheGet(hash);
      if (cached) {
        return { success: false as const, failureReason: cached };
      }

      // ── Gate 2: rate limit (novel images only). Per-IP AND per-session, so
      // dropping the session cookie doesn't reset the IP budget and vice-versa.
      const ipOk = await rateLimitHit('ip', ctx.ip, IP_LIMIT, RL_WINDOW_SEC);
      const sidOk = await rateLimitHit('sid', ctx.sessionId, SESSION_LIMIT, RL_WINDOW_SEC);
      if (!ipOk || !sidOk) {
        return {
          success: false as const,
          failureReason:
            'คุณส่งสลิปบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง (หรือติดต่อผู้ดูแลระบบ)',
        };
      }

      // Server-authoritative expected amount. Table bookings read pricePerTable
      // from Postgres; individual tickets use the pinned INDIVIDUAL_PRICE. A bad
      // tableId (or a booked/closed table) can't be paid for.
      let expectedAmount: number;
      let tokenKey: string;
      if (input.bookingType === 'individual') {
        expectedAmount = INDIVIDUAL_PRICE;
        tokenKey = `individual:${ctx.sessionId}`;
      } else {
        if (!input.tableId) {
          return { success: false as const, failureReason: 'ไม่พบโต๊ะที่เลือก กรุณาลองใหม่' };
        }
        const [row] = await ctx.db.select().from(tables).where(eq(tables.id, input.tableId));
        if (!row) {
          return { success: false as const, failureReason: 'ไม่พบโต๊ะที่เลือก กรุณาลองใหม่' };
        }
        expectedAmount = row.pricePerTable;
        tokenKey = input.tableId;
      }

      // ── Gate 3: global quota breaker. Refuse to call when near the ceiling,
      // reserving headroom for admin manual review (which already exists). Uses
      // the last quota RDCW reported (persisted below). Cold start ⇒ allow.
      const q = await quotaCacheRead();
      if (q && q.usage >= q.limit - QUOTA_RESERVE) {
        return {
          success: false as const,
          failureReason: 'ระบบไม่สามารถรับการจองได้ในขณะนี้ กรุณาติดต่อผู้ดูแลระบบ',
        };
      }

      // All gates passed — spend one RDCW call.
      let data, quota;
      try {
        ({ data, quota } = await verifySlipImage(input.slipImage));
      } catch (err) {
        // Do NOT negative-cache the throw path: it bundles intrinsic (not-a-slip)
        // with transient (network / HTTP 5xx / creds) errors, and caching a
        // transient failure would reject a good re-upload for 24h. The rate limit
        // already caps junk-image spam.
        return {
          success: false as const,
          failureReason: err instanceof Error ? err.message : 'ตรวจสอบสลิปไม่สำเร็จ',
        };
      }

      // Persist the freshest quota so the breaker above works across restarts.
      if (quota) await quotaCacheWrite(quota.usage, quota.limit);

      // Post-call quota gate — even on a cold start (no cached quota), don't
      // reserve if the account is already exhausted after this call.
      if (quota && quota.usage >= quota.limit - QUOTA_RESERVE) {
        return {
          success: false as const,
          failureReason: 'ระบบไม่สามารถรับการจองได้ในขณะนี้ กรุณาติดต่อผู้ดูแลระบบ',
        };
      }

      // Intrinsic checks below are a pure function of the image content, so a
      // failure is cached — the same image never re-spends a call.
      if (!receiverMatches(data.receiver?.displayName ?? data.receiver?.name)) {
        const reason = 'บัญชีผู้รับเงินในสลิปไม่ตรงกับบัญชีของงาน กรุณาตรวจสอบว่าโอนถูกบัญชี';
        await negCacheSet(hash, reason);
        return { success: false as const, failureReason: reason };
      }

      if (data.receivingBank && data.receivingBank !== EXPECTED_RECEIVING_BANK) {
        const reason = 'ธนาคารผู้รับเงินในสลิปไม่ตรงกับบัญชีของงาน กรุณาตรวจสอบว่าโอนถูกบัญชี';
        await negCacheSet(hash, reason);
        return { success: false as const, failureReason: reason };
      }

      // PromptPay proxy check — only rejects on a definite mismatch. Absent or fully
      // masked proxy (direct bank transfer) returns null and falls through to the
      // name+bank gates above, so legacy slips still verify.
      if (proxyMatches(data.receiver?.proxy?.value) === false) {
        const reason = 'พร้อมเพย์ผู้รับเงินในสลิปไม่ตรงกับบัญชีของงาน กรุณาตรวจสอบว่าโอนถูกบัญชี';
        await negCacheSet(hash, reason);
        return { success: false as const, failureReason: reason };
      }

      // Amount mismatch is NOT cached: it depends on which table/ticket is being
      // paid for, not the image — the same slip may be the right amount elsewhere.
      if (data.amount !== expectedAmount) {
        return {
          success: false as const,
          transRef: data.transRef,
          amount: data.amount,
          failureReason: `ยอดเงินโอน (${data.amount.toLocaleString()} บาท) ไม่ตรงกับยอดที่ต้องชำระ (${expectedAmount.toLocaleString()} บาท)`,
        };
      }

      // Reject only if this slip already backs a PERSISTED booking. Read-only:
      // unlike the old Redis claim (which marked the transRef used at verify time,
      // stranding it for 30 days whenever a first attempt failed downstream), a
      // failed/abandoned attempt writes no row, so the same slip stays usable on
      // retry. The unique trans_ref index in confirmBooking is the atomic backstop.
      const [used] = await ctx.db
        .select({ id: bookings.id })
        .from(bookings)
        .where(eq(bookings.transRef, data.transRef));
      if (used) {
        return {
          success: false as const,
          transRef: data.transRef,
          failureReason: 'สลิปนี้ถูกใช้ยืนยันการชำระเงินไปแล้ว กรุณาใช้สลิปการโอนใหม่',
        };
      }

      // Mint the payment token confirmBooking will consume. Bound to this session
      // and the server-derived amount — the client can't confirm a booking it
      // didn't pay the right amount for, from a session that didn't pay.
      await mintPaymentToken({
        transRef: data.transRef,
        key: tokenKey,
        sessionId: ctx.sessionId,
        amount: expectedAmount,
        bookingType: input.bookingType,
      });

      return {
        success: true as const,
        transRef: data.transRef,
        amount: data.amount,
        receiverName: data.receiver?.displayName ?? data.receiver?.name,
      };
    }),
});

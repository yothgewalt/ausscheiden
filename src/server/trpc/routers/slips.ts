import { z } from 'zod';
import { trace } from '@opentelemetry/api';
import { eq } from 'drizzle-orm';
import { router, publicProcedure } from '../trpc';
import {
  verifySlipImage,
  receiverMatches,
  proxyMatches,
  hashSlipImage,
  EXPECTED_RECEIVING_BANK,
} from '../../rdcw';
import type { RdcwSlipData, RdcwQuota } from '../../rdcw';
import {
  mintPaymentToken,
  negCacheGet,
  negCacheSet,
  posCacheGet,
  posCacheSet,
  rateLimitHit,
  quotaCacheRead,
  quotaCacheWrite,
  readLock,
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

/**
 * Every rejection returns through here so the reason is logged exactly once.
 * The app used to log NOTHING on this path — a proxy 504 stranded a buyer and
 * left no server-side trace at all. Keep the `success: false` literal: the
 * client narrows the union on it (BookingContext reads `res.failureReason`).
 */
function fail(
  failureReason: string,
  extra?: { transRef?: string; amount?: number; gate?: string }
): { success: false; failureReason: string; transRef?: string; amount?: number } {
  const { gate, ...rest } = extra ?? {};
  // One choke point ⇒ one place to mark the span. `gate` names WHICH rung of the
  // cheap→expensive ladder rejected the buyer, which is the thing you actually
  // want to filter on in Jaeger. A rejection is a business outcome, not an
  // exception, so the span stays OK — the attribute carries the verdict.
  const span = trace.getActiveSpan();
  span?.addEvent('verify.reject', { 'verify.gate': gate ?? 'unknown' });
  span?.setAttribute('verify.outcome', 'rejected');
  span?.setAttribute('verify.gate', gate ?? 'unknown');
  console.warn(`[slips.verify] reject: ${failureReason}`);
  return { success: false, failureReason, ...rest };
}

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
        return fail(cached, { gate: 'negcache' });
      }

      // ── Gate 1b: positive cache. A verify that succeeded upstream but died
      // downstream (proxy 504, dropped connection, a confirm that failed) used to
      // make the buyer's retry spend a SECOND of the ~115 lifetime RDCW calls —
      // and after 5 tries lock them out for 10 minutes. Re-use the transaction we
      // already read from these exact bytes; every gate below still re-runs.
      const memo = await posCacheGet(hash);
      if (memo) {
        // The whole point of this cache is that a retry costs neither an RDCW
        // call nor a rate-limit slot — make that visible, it is the thing to
        // check when the ~115-call quota moves unexpectedly.
        trace.getActiveSpan()?.addEvent('slip.poscache_hit');
      }

      // ── Gate 2: rate limit. Only novel images spend budget — a cache hit costs
      // us nothing, so it must not cost the buyer a retry slot. Per-IP AND
      // per-session, so dropping the session cookie doesn't reset the IP budget.
      if (!memo) {
        const ipOk = await rateLimitHit('ip', ctx.ip, IP_LIMIT, RL_WINDOW_SEC);
        const sidOk = await rateLimitHit('sid', ctx.sessionId, SESSION_LIMIT, RL_WINDOW_SEC);
        if (!ipOk || !sidOk) {
          return fail('คุณส่งสลิปบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง (หรือติดต่อผู้ดูแลระบบ)', {
            gate: 'rate_limit',
          });
        }
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
          return fail('ไม่พบโต๊ะที่เลือก กรุณาลองใหม่', { gate: 'table_missing' });
        }
        const [row] = await ctx.db.select().from(tables).where(eq(tables.id, input.tableId));
        if (!row) {
          return fail('ไม่พบโต๊ะที่เลือก กรุณาลองใหม่', { gate: 'table_missing' });
        }
        // The caller must actually HOLD this table. mintPaymentToken is a bare SET
        // keyed by tableId, so without this a second session could verify against
        // someone else's table and overwrite the token the rightful buyer paid
        // for — who then hits FORBIDDEN at confirm with money already sent. Also
        // stops an RDCW call being spent on a table the caller could never book
        // (confirmBooking rejects it anyway, just later and more expensively).
        const lock = await readLock(input.tableId);
        if (!lock || lock.sessionId !== ctx.sessionId) {
          return fail('สิทธิ์การจองโต๊ะนี้หมดอายุแล้ว กรุณาเลือกโต๊ะและจองใหม่อีกครั้ง', {
            gate: 'lock_not_owned',
          });
        }
        expectedAmount = row.pricePerTable;
        tokenKey = input.tableId;
      }

      let data: RdcwSlipData;
      let quota: RdcwQuota | undefined;
      if (memo) {
        data = memo;
      } else {
        // ── Gate 3: global quota breaker. Refuse to call when near the ceiling,
        // reserving headroom for admin manual review (which already exists). Uses
        // the last quota RDCW reported (persisted below). Cold start ⇒ allow.
        const q = await quotaCacheRead();
        if (q && q.usage >= q.limit - QUOTA_RESERVE) {
          return fail('ระบบไม่สามารถรับการจองได้ในขณะนี้ กรุณาติดต่อผู้ดูแลระบบ', {
            gate: 'quota_breaker',
          });
        }

        // All gates passed — spend one RDCW call.
        try {
          ({ data, quota } = await verifySlipImage(input.slipImage));
        } catch (err) {
          // Do NOT negative-cache the throw path: it bundles intrinsic (not-a-slip)
          // with transient (network / timeout / HTTP 5xx / creds) errors, and caching a
          // transient failure would reject a good re-upload for 24h. The rate limit
          // already caps junk-image spam.
          return fail(err instanceof Error ? err.message : 'ตรวจสอบสลิปไม่สำเร็จ', {
            gate: 'rdcw_error',
          });
        }

        // Persist the freshest quota so the breaker above works across restarts.
        if (quota) await quotaCacheWrite(quota.usage, quota.limit);
        // NOTE: no post-call quota gate. Once the call is spent and the slip is
        // valid, refusing on quota tells a buyer who has already transferred money
        // to "contact an admin". The pre-call gate above is what protects the
        // ceiling; rejecting here only ever punishes the person who paid.
      }

      // Intrinsic checks below are a pure function of the image content, so a
      // failure is cached — the same image never re-spends a call.
      if (!receiverMatches(data.receiver?.displayName ?? data.receiver?.name)) {
        const reason = 'บัญชีผู้รับเงินในสลิปไม่ตรงกับบัญชีของงาน กรุณาตรวจสอบว่าโอนถูกบัญชี';
        await negCacheSet(hash, reason);
        return fail(reason, { gate: 'payee_mismatch' });
      }

      if (data.receivingBank && data.receivingBank !== EXPECTED_RECEIVING_BANK) {
        const reason = 'ธนาคารผู้รับเงินในสลิปไม่ตรงกับบัญชีของงาน กรุณาตรวจสอบว่าโอนถูกบัญชี';
        await negCacheSet(hash, reason);
        return fail(reason, { gate: 'bank_mismatch' });
      }

      // PromptPay proxy check — only rejects on a definite mismatch. Absent or fully
      // masked proxy (direct bank transfer) returns null and falls through to the
      // name+bank gates above, so legacy slips still verify.
      if (proxyMatches(data.receiver?.proxy?.value) === false) {
        const reason = 'พร้อมเพย์ผู้รับเงินในสลิปไม่ตรงกับบัญชีของงาน กรุณาตรวจสอบว่าโอนถูกบัญชี';
        await negCacheSet(hash, reason);
        return fail(reason, { gate: 'promptpay_mismatch' });
      }

      // The slip is a real transfer to the right payee. Memoise it BEFORE the
      // amount/reuse gates so a retry — or a re-upload against the correct table —
      // is free. Those gates depend on what's being bought, not on the image.
      if (!memo) await posCacheSet(hash, data);

      // Amount mismatch is NOT cached: it depends on which table/ticket is being
      // paid for, not the image — the same slip may be the right amount elsewhere.
      if (data.amount !== expectedAmount) {
        return fail(
          `ยอดเงินโอน (${data.amount.toLocaleString()} บาท) ไม่ตรงกับยอดที่ต้องชำระ (${expectedAmount.toLocaleString()} บาท)`,
          { transRef: data.transRef, amount: data.amount, gate: 'amount_mismatch' }
        );
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
        return fail('สลิปนี้ถูกใช้ยืนยันการชำระเงินไปแล้ว กรุณาใช้สลิปการโอนใหม่', {
          transRef: data.transRef,
          gate: 'slip_used',
        });
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

      const span = trace.getActiveSpan();
      span?.setAttribute('verify.outcome', 'accepted');
      span?.setAttribute('verify.from_cache', Boolean(memo));
      span?.setAttribute('booking.amount', expectedAmount);
      span?.setAttribute('token.key', tokenKey);
      span?.addEvent('verify.accepted');

      console.info(
        `[slips.verify] ok: transRef=${data.transRef} key=${tokenKey} amount=${expectedAmount}${memo ? ' (cached, no API call)' : ''}`
      );
      return {
        success: true as const,
        transRef: data.transRef,
        amount: data.amount,
        receiverName: data.receiver?.displayName ?? data.receiver?.name,
      };
    }),
});

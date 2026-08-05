import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { router, publicProcedure } from '../trpc';
import { verifySlipImage, receiverMatches, proxyMatches, EXPECTED_RECEIVING_BANK } from '../../rdcw';
import { claimTransRef, mintPaymentToken } from '../../redis';
import { tables } from '../../db/schema';
import { INDIVIDUAL_PRICE } from '../../../data/mockData';

export const slipsRouter = router({
  // Verify an uploaded slip against RDCW: valid slip + correct payee + bank + the
  // server-authoritative amount for the thing being bought. On success, mint a
  // one-time payment token bound to {key, sessionId, amount} that confirmBooking
  // must consume — the client never gets to name its own price.
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

      let data, quota;
      try {
        ({ data, quota } = await verifySlipImage(input.slipImage));
      } catch (err) {
        return {
          success: false as const,
          failureReason: err instanceof Error ? err.message : 'ตรวจสอบสลิปไม่สำเร็จ',
        };
      }

      // Quota gate — if the account's slip-verify quota is exhausted, don't reserve.
      if (quota && quota.usage >= quota.limit) {
        return {
          success: false as const,
          failureReason: 'ระบบไม่สามารถรับการจองได้ในขณะนี้ กรุณาติดต่อผู้ดูแลระบบ',
        };
      }

      if (!receiverMatches(data.receiver?.displayName ?? data.receiver?.name)) {
        return {
          success: false as const,
          failureReason: 'บัญชีผู้รับเงินในสลิปไม่ตรงกับบัญชีของงาน กรุณาตรวจสอบว่าโอนถูกบัญชี',
        };
      }

      if (data.receivingBank && data.receivingBank !== EXPECTED_RECEIVING_BANK) {
        return {
          success: false as const,
          failureReason: 'ธนาคารผู้รับเงินในสลิปไม่ตรงกับบัญชีของงาน กรุณาตรวจสอบว่าโอนถูกบัญชี',
        };
      }

      // PromptPay proxy check — only rejects on a definite mismatch. Absent or fully
      // masked proxy (direct bank transfer) returns null and falls through to the
      // name+bank gates above, so legacy slips still verify.
      if (proxyMatches(data.receiver?.proxy?.value) === false) {
        return {
          success: false as const,
          failureReason: 'พร้อมเพย์ผู้รับเงินในสลิปไม่ตรงกับบัญชีของงาน กรุณาตรวจสอบว่าโอนถูกบัญชี',
        };
      }

      if (data.amount !== expectedAmount) {
        return {
          success: false as const,
          transRef: data.transRef,
          amount: data.amount,
          failureReason: `ยอดเงินโอน (${data.amount.toLocaleString()} บาท) ไม่ตรงกับยอดที่ต้องชำระ (${expectedAmount.toLocaleString()} บาท)`,
        };
      }

      // Claim the transRef so the same slip can't confirm twice. Only reached once
      // everything else passed, so we never burn a valid ref on a rejected slip.
      if (!(await claimTransRef(data.transRef))) {
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
      });

      return {
        success: true as const,
        transRef: data.transRef,
        amount: data.amount,
        receiverName: data.receiver?.displayName ?? data.receiver?.name,
      };
    }),
});

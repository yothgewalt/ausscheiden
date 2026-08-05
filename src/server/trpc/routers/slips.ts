import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { verifySlipImage, receiverMatches, EXPECTED_RECEIVING_BANK } from '../../rdcw';
import { claimTransRef } from '../../redis';

export const slipsRouter = router({
  // Verify an uploaded slip against RDCW: valid slip + correct payee + matching amount.
  // Returns a flat result the client maps into slipVerificationResult.
  verify: publicProcedure
    .input(
      z.object({
        slipImage: z.string(), // data:image/…;base64,… from the browser
        expectedAmount: z.number().positive(),
      })
    )
    .mutation(async ({ input }) => {
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

      if (data.amount !== input.expectedAmount) {
        return {
          success: false as const,
          transRef: data.transRef,
          amount: data.amount,
          failureReason: `ยอดเงินโอน (${data.amount.toLocaleString()} บาท) ไม่ตรงกับยอดที่ต้องชำระ (${input.expectedAmount.toLocaleString()} บาท)`,
        };
      }

      // Last gate: claim the transRef so the same slip can't confirm twice.
      // Only reached once everything else passed, so we never burn a valid ref on a rejected slip.
      if (!(await claimTransRef(data.transRef))) {
        return {
          success: false as const,
          transRef: data.transRef,
          failureReason: 'สลิปนี้ถูกใช้ยืนยันการชำระเงินไปแล้ว กรุณาใช้สลิปการโอนใหม่',
        };
      }

      return {
        success: true as const,
        transRef: data.transRef,
        amount: data.amount,
        receiverName: data.receiver?.displayName ?? data.receiver?.name,
      };
    }),
});

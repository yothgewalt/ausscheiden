import { z } from 'zod';
import { eq, and, desc, sql } from 'drizzle-orm';
import { router, adminProcedure } from '../trpc';
import { tables, bookings } from '../../db/schema';
import { individualCapacity } from './tables';
import * as locks from '../../redis';
import { uploadSlip } from '../../storage';
import { traced, event } from '../../otel';

// Walk-in rows the organisers key in by hand. Written to the otherwise-inert
// `bookings.status` column so a manual sale is distinguishable from an in-app
// one in the DB and in the CSV export (their trans_ref is also NULL — no bank
// slip was ever machine-verified).
const MANUAL_STATUS = 'manual';

const createInput = z
  .object({
    tableId: z.string().regex(/^T\d{2}$/).optional(),
    buyerName: z.string().min(1).max(200),
    phone: z.string().min(1).max(50),
    email: z.string().min(1).max(200),
    major: z.string().min(1).max(50),
    batch: z.string().min(1).max(50),
    bookingType: z.enum(['whole_table', 'individual_seats', 'individual']),
    // Unlike confirmBooking — which takes the amount from a server-minted
    // payment token so a buyer can't set their own price — the organiser IS the
    // authority here. They saw the money arrive.
    finalAmount: z.number().int().positive().max(1_000_000),
    slipImage: z.string().optional(), // data:image/…;base64
  })
  .refine((v) => (v.bookingType === 'individual' ? !v.tableId : !!v.tableId), {
    message: 'individual tickets carry no table; table bookings require one',
    path: ['tableId'],
  });

export const adminRouter = router({
  /**
   * Every booking, newest first, with the zone joined in. ~90 rows at full
   * capacity, so this single query backs both the dashboard and the whole
   * checklist page — no pagination, no separate "latest buyers" endpoint.
   */
  bookings: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ b: bookings, zone: tables.zone })
      .from(bookings)
      .leftJoin(tables, eq(bookings.tableId, tables.id))
      .orderBy(desc(bookings.createdAt));

    return rows.map(({ b, zone }) => ({
      ...b,
      zone,
      // Tables are "T01".."T70"; the humans running the event say "โต๊ะ 7".
      tableNumber: b.tableId ? Number(b.tableId.slice(1)) : null,
    }));
  }),

  /** Tick/untick "confirmation email sent" on the checklist. */
  setEmailSent: adminProcedure
    .input(z.object({ id: z.string().uuid(), sent: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(bookings)
        .set({ emailSentAt: input.sent ? new Date() : null })
        .where(eq(bookings.id, input.id));
      return { ok: true as const };
    }),

  /**
   * Record a sale that happened outside the app (cash, direct transfer) and
   * take the table off the market.
   *
   * Deliberately NOT a variant of tables.confirmBooking: that path exists to
   * stop a buyer paying the wrong amount or reusing a slip, and every one of
   * its gates (payment token, lock ownership, transRef dedup) is meaningless
   * when a trusted organiser is typing the row in. What it DOES share is the
   * part that protects data integrity rather than the buyer: the advisory-lock
   * capacity check and the status-scoped table update.
   */
  createBooking: adminProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    // A live lock means a buyer is mid-flow on this table right now. Their lock
    // isn't visible in tables.status (still 'available'), so without this check
    // the organiser would silently book out from under someone who is on the
    // payment screen.
    if (input.tableId) {
      const held = await locks.readLock(input.tableId);
      if (held) return { ok: false as const, reason: 'locked' as const };
    }

    const ref = `BK-2026-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;

    const result = await traced(
      'db.transaction.adminCreateBooking',
      { 'booking.type': input.bookingType, 'db.advisory_lock': input.bookingType === 'individual' },
      async (txSpan) => {
        const r = await ctx.db.transaction(async (tx) => {
          if (input.bookingType === 'individual') {
            // Same critical section as the buyer path (tables.ts) and the same
            // key, so a manual sale and a live confirm can't both take the last
            // seat in the 16-seat pool.
            await tx.execute(sql`SELECT pg_advisory_xact_lock(423042)`);
            const cap = await individualCapacity(tx);
            const count = await tx.$count(bookings, eq(bookings.bookingType, 'individual'));
            if (count >= cap) return { ok: false as const, reason: 'sold_out' as const };
          }

          if (input.tableId) {
            // Scoped to an available row: if a buyer's confirm committed between
            // the lock check above and here, this affects 0 rows and we bail
            // instead of double-selling the table.
            const claimed = await tx
              .update(tables)
              .set({ status: 'booked' })
              .where(and(eq(tables.id, input.tableId), eq(tables.status, 'available')))
              .returning({ id: tables.id });
            if (claimed.length === 0) return { ok: false as const, reason: 'unavailable' as const };
          }

          const [row] = await tx
            .insert(bookings)
            .values({
              ref,
              tableId: input.tableId,
              buyerName: input.buyerName,
              phone: input.phone,
              email: input.email,
              major: input.major,
              batch: input.batch,
              bookingType: input.bookingType,
              // No sessionId: this row belongs to no browser session, so the
              // idempotent-re-confirm path can never match it.
              finalAmount: input.finalAmount,
              status: MANUAL_STATUS,
            })
            .returning({ id: bookings.id });

          return { ok: true as const, id: row.id, ref };
        });
        txSpan.setAttribute('booking.outcome', r.ok ? 'committed' : r.reason);
        return r;
      }
    );

    if (!result.ok) {
      event('admin.create_rejected', { 'booking.reason': result.reason });
      return result;
    }

    // Repaint every open buyer seat map. Redis, not Postgres — kept out of the
    // transaction so a rollback can't announce a booking that never landed.
    if (input.tableId) await locks.notifyTableChanged(input.tableId);

    // Best-effort archive, exactly like the buyer path: an upload failure leaves
    // slip_path NULL and never undoes a recorded sale.
    if (input.slipImage) {
      const key = await uploadSlip(input.tableId ?? 'individual', ref, input.slipImage);
      if (key) {
        await ctx.db.update(bookings).set({ slipPath: key }).where(eq(bookings.id, result.id));
      }
    }

    return result;
  }),
});

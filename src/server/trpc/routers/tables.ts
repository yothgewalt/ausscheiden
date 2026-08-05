import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { router, publicProcedure } from '../trpc';
import { tables, bookings } from '../../db/schema';
import { INDIVIDUAL_CAPACITY } from '../../../data/mockData';
import * as locks from '../../redis';
import type { LockEvent } from '../../redis';

const tableIdInput = z.object({ tableId: z.string().regex(/^T\d{2}$/) });

// Full purchase payload persisted on confirm. tableId optional — individual tickets
// carry no table. ref is the client "BK-2026-xxxx" code (unique → idempotent re-confirm).
const confirmInput = z.object({
  ref: z.string().min(1),
  tableId: z.string().regex(/^T\d{2}$/).optional(),
  buyerName: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().min(1),
  lineId: z.string().optional(),
  bookingType: z.enum(['whole_table', 'individual_seats', 'individual']),
  finalAmount: z.number().int().positive(),
});

/** Effective per-table state seen by clients. */
export type EffectiveStatus = 'available' | 'booked' | 'selecting' | 'pending_payment' | 'closed';

export const tablesRouter = router({
  // Postgres booked/available merged with live Redis locks.
  list: publicProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.select().from(tables);
    const live = await locks.list();
    const lockById = new Map(live.map((l) => [l.id, l]));
    return rows.map((r) => {
      const lock = lockById.get(r.id);
      const status: EffectiveStatus =
        r.status === 'booked' || r.status === 'closed'
          ? (r.status as EffectiveStatus)
          : lock
            ? lock.phase
            : 'available';
      return {
        id: r.id,
        zone: r.zone,
        status,
        lockedByMe: lock?.sessionId === ctx.sessionId,
      };
    });
  }),

  // Per-zone availability for the registration badge.
  zoneAvailability: publicProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.select().from(tables);
    const live = await locks.list();
    const lockById = new Map(live.map((l) => [l.id, l]));
    const byZone: Record<string, { total: number; available: number }> = {};
    for (const r of rows) {
      const z = (byZone[r.zone] ??= { total: 0, available: 0 });
      z.total += 1;
      const taken = r.status === 'booked' || r.status === 'closed' || lockById.has(r.id);
      if (!taken) z.available += 1;
    }
    // Individual tier isn't table-backed — availability = 16 minus confirmed individual bookings.
    // ponytail: count all individual rows (~≤16, one event); no aggregate needed.
    const individualCount = (
      await ctx.db.select().from(bookings).where(eq(bookings.bookingType, 'individual'))
    ).length;
    byZone.individual = {
      total: INDIVIDUAL_CAPACITY,
      available: Math.max(0, INDIVIDUAL_CAPACITY - individualCount),
    };
    return byZone;
  }),

  acquireLock: publicProcedure.input(tableIdInput).mutation(async ({ ctx, input }) => {
    // Guard against locking a table Postgres already marks booked.
    const [row] = await ctx.db.select().from(tables).where(eq(tables.id, input.tableId));
    if (!row || row.status !== 'available') return { ok: false as const, reason: 'unavailable' as const };
    const lock = await locks.acquire(input.tableId, ctx.sessionId);
    return lock
      ? { ok: true as const, expiresAt: lock.expiresAt }
      : { ok: false as const, reason: 'held' as const };
  }),

  promoteToPayment: publicProcedure.input(tableIdInput).mutation(async ({ ctx, input }) => {
    const lock = await locks.promote(input.tableId, ctx.sessionId);
    return lock ? { ok: true as const, expiresAt: lock.expiresAt } : { ok: false as const };
  }),

  releaseLock: publicProcedure.input(tableIdInput).mutation(async ({ ctx, input }) => {
    const ok = await locks.release(input.tableId, ctx.sessionId);
    return { ok };
  }),

  confirmBooking: publicProcedure.input(confirmInput).mutation(async ({ ctx, input }) => {
    // Ledger invariant: individual tickets cap at 16. Count existing individuals and
    // reject the 17th — but only for a NEW ref, so an idempotent re-confirm of an
    // already-counted booking still succeeds.
    if (input.bookingType === 'individual') {
      const already = await ctx.db.select().from(bookings).where(eq(bookings.ref, input.ref));
      if (already.length === 0) {
        const count = (
          await ctx.db.select().from(bookings).where(eq(bookings.bookingType, 'individual'))
        ).length;
        if (count >= INDIVIDUAL_CAPACITY) return { ok: false as const, reason: 'sold_out' as const };
      }
    }

    // Persist the purchase. onConflictDoNothing(ref): a re-confirm of the same slip
    // is a no-op, never a duplicate row. Returns the row so the client gets the UUID.
    const [row] = await ctx.db
      .insert(bookings)
      .values({
        ref: input.ref,
        tableId: input.tableId,
        buyerName: input.buyerName,
        phone: input.phone,
        email: input.email,
        lineId: input.lineId,
        bookingType: input.bookingType,
        finalAmount: input.finalAmount,
      })
      .onConflictDoNothing({ target: bookings.ref })
      .returning({ id: bookings.id });

    // Table-bound booking: mark it booked and drop the Redis lock. Individual
    // tickets have no table, so skip both.
    if (input.tableId) {
      await ctx.db.update(tables).set({ status: 'booked' }).where(eq(tables.id, input.tableId));
      await locks.release(input.tableId, ctx.sessionId);
    }

    return { ok: true as const, id: row?.id ?? null };
  }),

  // Live lock changes for every client. Bridges Redis pub/sub -> async generator.
  onLockChange: publicProcedure.subscription(async function* () {
    const queue: LockEvent[] = [];
    let resolve: (() => void) | null = null;
    const unsub = locks.onLockEvent((evt) => {
      queue.push(evt);
      resolve?.();
      resolve = null;
    });
    try {
      while (true) {
        if (queue.length === 0) {
          await new Promise<void>((r) => (resolve = r));
        }
        while (queue.length > 0) yield queue.shift()!;
      }
    } finally {
      unsub();
    }
  }),
});

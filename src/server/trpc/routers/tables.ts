import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { tables, bookings, settings } from '../../db/schema';
import { INDIVIDUAL_CAPACITY } from '../../../data/mockData';
import * as locks from '../../redis';
import type { LockEvent } from '../../redis';
import type { DB } from '../../db';

// Live individual cap: read the singleton settings row so a DB edit takes effect
// on the next request. Falls back to the seed default if the row isn't there yet
// (unseeded DB), so nothing breaks before the first db:seed.
async function individualCapacity(db: DB): Promise<number> {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  return row?.individualCapacity ?? INDIVIDUAL_CAPACITY;
}

const tableIdInput = z.object({ tableId: z.string().regex(/^T\d{2}$/) });

// Full purchase payload persisted on confirm. tableId optional — individual tickets
// carry no table. ref is the client "BK-2026-xxxx" code (unique → idempotent re-confirm).
// NOTE: no finalAmount here — the amount is taken from the server-minted payment
// token (see slips.verify), never from the client, so a caller can't book at a
// price it didn't actually pay.
const confirmInput = z.object({
  ref: z.string().min(1),
  tableId: z.string().regex(/^T\d{2}$/).optional(),
  buyerName: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().min(1),
  lineId: z.string().optional(),
  bookingType: z.enum(['whole_table', 'individual_seats', 'individual']),
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
    // Individual tier isn't table-backed — availability = cap minus confirmed individual bookings.
    const cap = await individualCapacity(ctx.db);
    const individualCount = await ctx.db.$count(bookings, eq(bookings.bookingType, 'individual'));
    byZone.individual = {
      total: cap,
      available: Math.max(0, cap - individualCount),
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
    // AUTHORIZATION: a booking is only allowed against a payment token that
    // slips.verify minted for THIS session, for THIS table (or this session's
    // individual ticket). No token ⇒ the caller never proved a correct payment,
    // so reject. The token also carries the server-derived amount — we persist
    // THAT, never a client-supplied price.
    const tokenKey = input.tableId ?? `individual:${ctx.sessionId}`;

    // Idempotent re-confirm: if this ref already booked, the token is long gone.
    // Return the existing row instead of demanding a fresh (already-consumed) token.
    const already = await ctx.db.select().from(bookings).where(eq(bookings.ref, input.ref));
    if (already.length > 0) {
      return { ok: true as const, id: already[0].id };
    }

    const token = await locks.consumePaymentToken(tokenKey, ctx.sessionId);
    if (!token) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'ยังไม่ได้ยืนยันการชำระเงิน หรือเซสชันไม่ตรงกัน กรุณาชำระเงินและอัปโหลดสลิปก่อน',
      });
    }

    // For a table booking, the caller must also currently OWN the lock in the
    // pending_payment phase — the token alone isn't enough if someone else now
    // holds the table.
    if (input.tableId) {
      const lock = await locks.readLock(input.tableId);
      if (!lock || lock.sessionId !== ctx.sessionId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'สิทธิ์การจองโต๊ะนี้หมดอายุแล้ว กรุณาเริ่มใหม่' });
      }
    }

    // Ledger invariant: individual tickets cap at 16. Count existing individuals
    // and reject the 17th. (ref-already-booked was handled above.)
    if (input.bookingType === 'individual') {
      const cap = await individualCapacity(ctx.db);
      const count = await ctx.db.$count(bookings, eq(bookings.bookingType, 'individual'));
      if (count >= cap) return { ok: false as const, reason: 'sold_out' as const };
    }

    // Persist the purchase with the server-derived amount from the token.
    // onConflictDoNothing(ref): a racing duplicate is a no-op, never a second row.
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
        finalAmount: token.amount,
      })
      .onConflictDoNothing({ target: bookings.ref })
      .returning({ id: bookings.id });

    // Table-bound booking: mark it booked and drop the Redis lock. Scope the
    // update to an available row so we never flip a table someone else already
    // booked. Individual tickets have no table, so skip both.
    if (input.tableId) {
      await ctx.db
        .update(tables)
        .set({ status: 'booked' })
        .where(and(eq(tables.id, input.tableId), eq(tables.status, 'available')));
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

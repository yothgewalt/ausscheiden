import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { tables, bookings, settings } from '../../db/schema';
import { INDIVIDUAL_CAPACITY } from '../../../data/mockData';
import * as locks from '../../redis';
import type { LockEvent } from '../../redis';
import type { DB } from '../../db';
import { uploadSlip } from '../../storage';
import { traced, event } from '../../otel';

// The tx handle drizzle hands the transaction callback — same query API as DB but
// no `$client`. Derived from DB so it tracks the schema automatically.
type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

// Live individual cap: read the singleton settings row so a DB edit takes effect
// on the next request. Falls back to the seed default if the row isn't there yet
// (unseeded DB), so nothing breaks before the first db:seed. Accepts a tx too, so
// the confirm path can read the cap inside its atomic section.
export async function individualCapacity(db: DB | Tx): Promise<number> {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  return row?.individualCapacity ?? INDIVIDUAL_CAPACITY;
}

const tableIdInput = z.object({ tableId: z.string().regex(/^T\d{2}$/) });

// acquireLock abuse gates. The client locks one table at a time, so these are
// generous for real buyers and only bite an automated map-locker.
const ACQUIRE_IP_LIMIT = 30; // locks per IP per window
const ACQUIRE_WINDOW_SEC = 60;
const SESSION_LOCK_CAP = 3; // distinct tables one session may hold at once

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
  major: z.string().min(1),
  batch: z.string().min(1),
  bookingType: z.enum(['whole_table', 'individual_seats', 'individual']),
  slipImage: z.string().min(1), // data:image/…;base64 — archived to MinIO after commit
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
    // Abuse gates. acquireLock is unauthenticated and holds a table for the full
    // 10-min TTL; an HTTP-only caller (never opens the WS) is never in
    // SessionPresence, so its locks aren't freed on disconnect. Without a limit,
    // one client can lock the whole map (availability DoS). Two cheap gates:
    //   • per-IP rate limit (rightmost XFF — forge-proof; see clientIpFromXff)
    //   • per-session cap on distinct held tables (real buyers lock one at a time)
    // Re-locking a table THIS session already holds is a refresh, not a new lock,
    // so it bypasses the cap (checked below against the session's live lock set).
    if (!(await locks.rateLimitHit('acquire', ctx.ip, ACQUIRE_IP_LIMIT, ACQUIRE_WINDOW_SEC))) {
      return { ok: false as const, reason: 'rate_limited' as const };
    }

    // Guard against locking a table Postgres already marks booked.
    const [row] = await ctx.db.select().from(tables).where(eq(tables.id, input.tableId));
    if (!row || row.status !== 'available') return { ok: false as const, reason: 'unavailable' as const };

    // Per-session cap: count distinct tables this session already holds. A refresh
    // of an already-held table is fine; a NEW table past the cap is refused.
    const mine = (await locks.list()).filter((l) => l.sessionId === ctx.sessionId);
    const alreadyHeld = mine.some((l) => l.id === input.tableId);
    if (!alreadyHeld && mine.length >= SESSION_LOCK_CAP) {
      return { ok: false as const, reason: 'too_many' as const };
    }

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

    // Idempotent re-confirm, scoped to the OWNER session. A network retry from the
    // buyer returns their existing row (its token is already consumed and gone).
    // A ref that is NOT this session's — foreign or nonexistent — falls through to
    // the token gate below and is rejected identically, so this can't be used to
    // probe whether an arbitrary ref exists (no id/existence oracle), and a ref
    // collision can't route a paying buyer into someone else's confirmed booking.
    const already = await ctx.db.select().from(bookings).where(eq(bookings.ref, input.ref));
    const mine = already.find((b) => b.sessionId === ctx.sessionId);
    if (mine) return { ok: true as const, id: mine.id };

    // PEEK first, consume last. consumePaymentToken is single-use and
    // irreversible, so consuming here — before the two checks below — meant a
    // bookingType or lock mismatch permanently destroyed a token the buyer had
    // ALREADY PAID for, leaving them to re-verify behind a 5-per-10-min gate on a
    // ~115-call lifetime quota. Peek → validate → consume costs one extra GET and
    // keeps the atomic consume as the concurrency guard, since it still lands
    // before any write.
    const peeked = await locks.readPaymentToken(tokenKey);
    if (!peeked || peeked.sessionId !== ctx.sessionId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'ยังไม่ได้ยืนยันการชำระเงิน หรือเซสชันไม่ตรงกัน กรุณาชำระเงินและอัปโหลดสลิปก่อน',
      });
    }

    // The tier is fixed by the slip that was verified — the client can't swap it
    // at confirm time. Without this, an `individual` token (799, minted at
    // individual:<sid>) could confirm as `whole_table` with no tableId, storing a
    // row that skips the individual-pool cap check below and oversells the pool.
    if (peeked.bookingType !== input.bookingType) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'ประเภทการจองไม่ตรงกับการชำระเงินที่ยืนยันไว้ กรุณาเริ่มใหม่',
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

    // Every check passed — now burn it. Persist the CONSUMED token's values, not
    // the peeked ones: if the buyer verified a second slip in the gap, the consume
    // returns that newer token and its transRef/amount are the ones that count.
    const token = await locks.consumePaymentToken(tokenKey, ctx.sessionId);
    if (!token) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'ยังไม่ได้ยืนยันการชำระเงิน หรือเซสชันไม่ตรงกัน กรุณาชำระเงินและอัปโหลดสลิปก่อน',
      });
    }

    // Atomic booking. The individual-tier cap check + insert MUST be serialized
    // against concurrent individual confirms — otherwise two callers each read
    // count < cap and both insert, overselling past the cap (the count and the
    // insert were a check-then-act TOCTOU). A transaction-scoped Postgres advisory
    // lock makes count→insert one critical section; it auto-releases on commit or
    // rollback. onConflictDoNothing(ref) + the unique ref index is the final
    // backstop against any duplicate row.
    let result:
      | { ok: true; id: string }
      | { ok: false; reason: 'sold_out' | 'slip_used' | 'ref_conflict' };
    try {
      // Its own span: this is the atomic section, and for individual tickets it
      // BLOCKS on a Postgres advisory lock. If confirms ever queue up, the wait
      // shows here and nowhere else.
      result = await traced(
        'db.transaction.confirmBooking',
        { 'booking.type': input.bookingType, 'db.advisory_lock': input.bookingType === 'individual' },
        async (txSpan) => {
          const r = await ctx.db.transaction(async (tx) => {
      if (input.bookingType === 'individual') {
        // ponytail: one fixed key for the sole capped pool. Per-pool keys if a
        // second capped tier is ever added.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(423042)`);
        const cap = await individualCapacity(tx);
        const count = await tx.$count(bookings, eq(bookings.bookingType, 'individual'));
        if (count >= cap) return { ok: false as const, reason: 'sold_out' as const };
      }

      // Slip reuse guard. The same-session retry is already short-circuited by the
      // idempotent-by-ref check above; this catches two DIFFERENT sessions confirming
      // the identical slip. Read here for a clean reason; the unique trans_ref index
      // is the atomic backstop if two confirms still race past this read.
      const [dupSlip] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(eq(bookings.transRef, token.transRef));
      if (dupSlip) return { ok: false as const, reason: 'slip_used' as const };

      const [row] = await tx
        .insert(bookings)
        .values({
          ref: input.ref,
          tableId: input.tableId,
          buyerName: input.buyerName,
          phone: input.phone,
          email: input.email,
          major: input.major,
          batch: input.batch,
          bookingType: input.bookingType,
          sessionId: ctx.sessionId,
          finalAmount: token.amount,
          transRef: token.transRef,
        })
        .onConflictDoNothing({ target: bookings.ref })
        .returning({ id: bookings.id });

      // No row ⇒ the conflict swallowed the insert, and the existing row is NOT
      // ours (a same-session retry already returned early above). Reporting
      // ok:true here took the payment, wrote nothing, and then stamped slip_path
      // onto the other session's booking. Fail loudly instead.
      if (!row) return { ok: false as const, reason: 'ref_conflict' as const };

      // Table-bound booking: mark it booked. Scope the update to an available row
      // so we never flip a table someone else already booked.
      if (input.tableId) {
        await tx
          .update(tables)
          .set({ status: 'booked' })
          .where(and(eq(tables.id, input.tableId), eq(tables.status, 'available')));
      }

      return { ok: true as const, id: row.id };
          });
          // committed | sold_out | slip_used | ref_conflict — the one field that
          // says whether a paying buyer actually got a booking row.
          txSpan.setAttribute('booking.outcome', r.ok ? 'committed' : r.reason);
          return r;
        }
      );
    } catch (err) {
      // The unique trans_ref index is the atomic backstop: if two sessions race
      // past the read-check above, one insert throws 23505 (unique_violation).
      // Map it to the same clean reason instead of a raw 500.
      if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === '23505') {
        return { ok: false as const, reason: 'slip_used' as const };
      }
      throw err;
    }

    // Drop the Redis lock only AFTER the DB commit. It's Redis (not part of the
    // Postgres tx): a table that stays locked a moment longer is harmless, a lock
    // released before an uncommitted booking is not.
    if (input.tableId && result.ok) {
      await locks.release(input.tableId, ctx.sessionId);
    }

    // Archive the slip to MinIO AFTER commit — keeps the network call out of the
    // advisory-lock critical section, and a sold-out rollback never orphans an
    // object. Best-effort: a null (parse/outage) leaves slip_path NULL, never
    // undoing a paid booking. The idempotent re-confirm above returns early, so a
    // retry uploads once. ponytail: slipImage rides the wire twice (verify+confirm)
    // — cheaper than stashing base64 in Redis between the two calls.
    if (result.ok) {
      const prefix = input.tableId ?? 'individual';
      const key = await uploadSlip(prefix, input.ref, input.slipImage);
      if (key) {
        // Key on the id we just inserted, not the client-supplied ref — a ref we
        // don't own can never be the target of this write.
        await ctx.db
          .update(bookings)
          .set({ slipPath: key })
          .where(eq(bookings.id, result.id));
      }
    } else {
      // A rejection here means the buyer paid and got nothing — the single most
      // important event in this file.
      event('confirm.rejected', { 'booking.reason': result.reason, 'token.key': tokenKey });
      console.warn(`[confirmBooking] reject ${result.reason} ref=${input.ref} key=${tokenKey}`);
    }

    return result;
  }),

  // Live lock changes for every client. Bridges Redis pub/sub -> async generator.
  // Yields a session-scoped view {id, phase, mine} — NEVER the raw sessionId.
  // The old event leaked every other client's session id to every subscriber
  // (any listener could harvest ids and impersonate a session on the unsigned
  // cookie). `mine` is computed here against THIS subscriber's ctx.sessionId, so
  // a client learns "this lock is mine" without ever seeing a foreign id.
  onLockChange: publicProcedure.subscription(async function* ({ ctx }) {
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
        while (queue.length > 0) {
          const evt = queue.shift()!;
          yield { id: evt.id, phase: evt.phase, mine: evt.sessionId === ctx.sessionId };
        }
      }
    } finally {
      unsub();
    }
  }),
});

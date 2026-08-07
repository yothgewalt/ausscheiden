import Redis from 'ioredis';

export type LockPhase = 'selecting' | 'pending_payment';
export interface Lock {
  id: string; // tableId
  phase: LockPhase;
  sessionId: string;
  expiresAt: number; // epoch ms
}

export const LOCK_TTL_SEC = 600; // 10 min — matches lockTimeoutMinutes
const CHANNEL = 'table-locks';
const keyOf = (id: string) => `lock:table:${id}`;

const url = process.env.REDIS_URL || 'redis://localhost:6379';
// ioredis needs a dedicated connection for subscribe; keep commands/publish separate.
const pub = new Redis(url);
const sub = new Redis(url);

// Without an 'error' listener, ioredis logs every failed reconnect as an unhandled
// "[ioredis] Unhandled error event" with an empty AggregateError — a flood when Redis is
// down. Collapse it to one throttled line so a transient blip is survivable, not noise.
let lastRedisErr = 0;
const onRedisError = (which: string) => (err: Error) => {
  const now = Date.now();
  if (now - lastRedisErr > 5000) { // ponytail: 5s throttle; enough to see it's down without spamming
    lastRedisErr = now;
    console.error(`[redis] ${which} connection error (retrying): ${err.message || err.name}`);
  }
};
pub.on('error', onRedisError('pub'));
sub.on('error', onRedisError('sub'));

export interface LockEvent {
  id: string;
  phase: LockPhase | null; // null = released/expired
  sessionId: string;
}

async function publish(evt: LockEvent) {
  await pub.publish(CHANNEL, JSON.stringify(evt));
}

export async function readLock(id: string): Promise<Lock | null> {
  const raw = await pub.get(keyOf(id));
  return raw ? (JSON.parse(raw) as Lock) : null;
}

function makeLock(id: string, phase: LockPhase, sessionId: string): Lock {
  return { id, phase, sessionId, expiresAt: Date.now() + LOCK_TTL_SEC * 1000 };
}

/** Claim a table for 'selecting'. Idempotent for the owner; false if another session holds it. */
export async function acquire(id: string, sessionId: string): Promise<Lock | null> {
  const lock = makeLock(id, 'selecting', sessionId);
  const ok = await pub.set(keyOf(id), JSON.stringify(lock), 'EX', LOCK_TTL_SEC, 'NX');
  if (ok === 'OK') {
    await publish({ id, phase: 'selecting', sessionId });
    return lock;
  }
  // Already locked — allow the owner to refresh, reject everyone else.
  const existing = await readLock(id);
  if (existing && existing.sessionId === sessionId) {
    await pub.set(keyOf(id), JSON.stringify(lock), 'EX', LOCK_TTL_SEC);
    await publish({ id, phase: 'selecting', sessionId });
    return lock;
  }
  return null;
}

/** Move an owned lock to 'pending_payment' and reset the TTL. Null if not owner. */
export async function promote(id: string, sessionId: string): Promise<Lock | null> {
  const existing = await readLock(id);
  if (!existing || existing.sessionId !== sessionId) return null;
  const lock = makeLock(id, 'pending_payment', sessionId);
  await pub.set(keyOf(id), JSON.stringify(lock), 'EX', LOCK_TTL_SEC);
  await publish({ id, phase: 'pending_payment', sessionId });
  return lock;
}

/** Release an owned lock. No-op (returns false) if not owner or already gone. */
export async function release(id: string, sessionId: string): Promise<boolean> {
  const existing = await readLock(id);
  if (!existing || existing.sessionId !== sessionId) return false;
  await pub.del(keyOf(id));
  await publish({ id, phase: null, sessionId });
  return true;
}

/**
 * Free every pre-payment 'selecting' lock a session holds. Called when the
 * session's last WS socket drops (browser quit) so a table doesn't sit greyed-
 * out for the full TTL. Skips 'pending_payment' — that's a real in-flight
 * payment and must survive a disconnect until it expires or confirms.
 */
export async function releaseSelectingForSession(sessionId: string): Promise<number> {
  const all = await list();
  let freed = 0;
  for (const lock of all) {
    if (lock.sessionId === sessionId && lock.phase === 'selecting') {
      if (await release(lock.id, sessionId)) freed++;
    }
  }
  return freed;
}

/** All live locks, for merging into availability. */
export async function list(): Promise<Lock[]> {
  const keys = await pub.keys(keyOf('*'));
  if (keys.length === 0) return [];
  const raws = await pub.mget(keys);
  return raws.filter((r): r is string => r !== null).map((r) => JSON.parse(r) as Lock);
  // ponytail: keys() scans the whole keyspace — fine for one event's ~72 locks.
  // Switch to a SCAN cursor or a tracking set if this grows to thousands of keys.
}

/**
 * Payment token — server-minted proof that a slip was verified for a specific
 * (key, sessionId, amount). confirmBooking consumes it so the client can't book
 * something it never paid the right amount for. `key` is the tableId for a table
 * booking, or `individual:<sessionId>` for a table-less individual ticket.
 * ponytail: 10-min TTL matches the payment lock; a stale token just expires.
 */
export interface PaymentToken {
  transRef: string;
  key: string;
  sessionId: string;
  amount: number;
  // The tier the slip was verified against. Bound here so confirmBooking can't
  // consume an individual-ticket token to book a different type and dodge the
  // per-tier cap (the individual pool is physically capped; see confirmBooking).
  bookingType: string;
}
const PAYTOKEN_TTL_SEC = LOCK_TTL_SEC;
const payKey = (key: string) => `slip:paytoken:${key}`;

export async function mintPaymentToken(tok: PaymentToken): Promise<void> {
  await pub.set(payKey(tok.key), JSON.stringify(tok), 'EX', PAYTOKEN_TTL_SEC);
}

/**
 * Read the token for `key`, delete it, and return it — but only if it belongs
 * to `sessionId` (otherwise null, token left for the rightful owner).
 *
 * Atomic GETDEL-with-session-guard in one Lua eval: GET, decode, compare
 * sessionId, DEL only on match — Redis runs the whole script single-threaded so
 * two concurrent confirms can never both observe the token before it's deleted.
 * Returns nil (→ null) on miss OR session mismatch; only the rightful owner both
 * gets the token AND removes it, making it strictly single-use.
 */
const CONSUME_TOKEN_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
if not string.find(raw, ARGV[1], 1, true) then return nil end
local tok = cjson.decode(raw)
if tok.sessionId ~= ARGV[2] then return nil end
redis.call('DEL', KEYS[1])
return raw
`;
export async function consumePaymentToken(
  key: string,
  sessionId: string
): Promise<PaymentToken | null> {
  // Pre-filter with a literal substring match on the encoded sessionId before
  // cjson.decode so a mismatch skips the parse; the authoritative check is the
  // decoded tok.sessionId compare. Session ids are crypto.randomUUID, so the
  // JSON-encoded form is unambiguous.
  const raw = (await pub.eval(
    CONSUME_TOKEN_LUA,
    1,
    payKey(key),
    JSON.stringify(sessionId).slice(1, -1),
    sessionId
  )) as string | null;
  return raw ? (JSON.parse(raw) as PaymentToken) : null;
}

/**
 * Abuse gates for the paid RDCW slip API. RDCW has a tiny hard ceiling (~115
 * calls), so we spend it last — behind these Redis checks — to stop an abuser
 * (or a friendly user re-uploading the same wrong slip) from draining it.
 */

// Negative cache: an image whose *intrinsic* check failed (not a slip, wrong
// payee/bank/proxy) will fail identically forever, so remember the verdict and
// never re-spend an API call on the same bytes. Keyed by sha256(image).
const NEGCACHE_TTL_SEC = 60 * 60 * 24; // 24h — outlives one buying session
export async function negCacheGet(hash: string): Promise<string | null> {
  return pub.get(`slip:negcache:${hash}`);
}
export async function negCacheSet(hash: string, reason: string): Promise<void> {
  await pub.set(`slip:negcache:${hash}`, reason, 'EX', NEGCACHE_TTL_SEC);
}

/**
 * Fixed-window rate limit. INCR the counter; on the first hit of a new window
 * stamp its TTL. Returns true while count <= limit, false once exceeded.
 * ponytail: fixed window, not sliding — a burst on the window boundary can pass
 * up to 2×limit. Fine at this scale (limit 5); swap for a sorted-set sliding
 * window only if boundary bursts ever matter.
 */
export async function rateLimitHit(
  bucket: string,
  id: string,
  limit: number,
  windowSec: number
): Promise<boolean> {
  const k = `slip:rl:${bucket}:${id}`;
  const count = await pub.incr(k);
  if (count === 1) await pub.expire(k, windowSec);
  return count <= limit;
}

// Global quota breaker: persist the usage/limit RDCW reports so we can refuse to
// call when near the ceiling even across process restarts. No TTL — always
// reflects the last known state.
export async function quotaCacheRead(): Promise<{ usage: number; limit: number } | null> {
  const raw = await pub.get('slip:quota');
  return raw ? (JSON.parse(raw) as { usage: number; limit: number }) : null;
}
export async function quotaCacheWrite(usage: number, limit: number): Promise<void> {
  await pub.set('slip:quota', JSON.stringify({ usage, limit }));
}

// One 'message' listener for the whole process, fanning out to a Set of
// callbacks. Registering a listener per subscriber leaked them onto the shared
// `sub` connection and tripped MaxListenersExceededWarning past 10 clients.
const lockListeners = new Set<(evt: LockEvent) => void>();
let subscribed = false;

sub.on('message', (chan: string, msg: string) => {
  if (chan !== CHANNEL) return;
  const evt = JSON.parse(msg) as LockEvent;
  for (const cb of lockListeners) cb(evt);
});

/** Subscribe to lock changes. Returns an unsubscribe fn. */
export function onLockEvent(cb: (evt: LockEvent) => void): () => void {
  if (!subscribed) {
    sub.subscribe(CHANNEL);
    subscribed = true;
  }
  lockListeners.add(cb);
  return () => {
    lockListeners.delete(cb);
  };
}

// ponytail: TTL is the whole lock lifecycle. On expiry Redis drops the key and clients
// stop seeing it on the next list(); no explicit expiry broadcast. Add a keyspace-
// notification listener only if instant expiry fan-out becomes necessary.

// Runnable self-check: `bun src/server/redis.ts` (needs docker redis up).
async function _demo() {
  const t = 'T99';
  await pub.del(keyOf(t));
  const a = await acquire(t, 'sessionA');
  console.assert(a !== null && a.phase === 'selecting', 'owner acquires');
  const b = await acquire(t, 'sessionB');
  console.assert(b === null, 'other session cannot acquire held table');
  const p = await promote(t, 'sessionB');
  console.assert(p === null, 'non-owner cannot promote');
  const p2 = await promote(t, 'sessionA');
  console.assert(p2 !== null && p2.phase === 'pending_payment', 'owner promotes');
  const relB = await release(t, 'sessionB');
  console.assert(relB === false, 'non-owner cannot release');
  const relA = await release(t, 'sessionA');
  console.assert(relA === true, 'owner releases');
  const gone = await readLock(t);
  console.assert(gone === null, 'released lock is gone');

  // payment-token mint/consume: single-use, bound to the verified slip.
  const tok = { transRef: 'TR-demo', key: t, sessionId: 'sessionA', amount: 5999, bookingType: 'whole_table' };
  await mintPaymentToken(tok);
  const wrongSession = await consumePaymentToken(t, 'sessionB');
  console.assert(wrongSession === null, 'other session cannot consume token');
  const consumed = await consumePaymentToken(t, 'sessionA');
  console.assert(
    consumed?.transRef === 'TR-demo' && consumed?.amount === 5999 && consumed?.bookingType === 'whole_table',
    'owner consumes token (bookingType round-trips)'
  );
  const again = await consumePaymentToken(t, 'sessionA');
  console.assert(again === null, 'token is single-use');

  // abuse gates: negative cache round-trips and expires the verdict per-image
  const h = 'demohash';
  await pub.del(`slip:negcache:${h}`);
  console.assert((await negCacheGet(h)) === null, 'negcache empty before set');
  await negCacheSet(h, 'wrong-bank');
  console.assert((await negCacheGet(h)) === 'wrong-bank', 'negcache returns cached reason');

  // rate limit: allows exactly `limit` hits in the window, blocks the next
  await pub.del('slip:rl:demo:x');
  const hits = [];
  for (let i = 0; i < 6; i++) hits.push(await rateLimitHit('demo', 'x', 5, 60));
  console.assert(hits.slice(0, 5).every(Boolean), 'first 5 hits allowed');
  console.assert(hits[5] === false, '6th hit blocked');

  // quota cache round-trips
  await quotaCacheWrite(100, 115);
  const q = await quotaCacheRead();
  console.assert(q?.usage === 100 && q?.limit === 115, 'quota cache round-trips');

  console.log('redis lock self-check passed');
  process.exit(0);
}

if (import.meta.main) {
  _demo().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

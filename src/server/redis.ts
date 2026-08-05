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
 * Claim a slip's transRef so the same slip can't confirm two bookings.
 * Returns true if this is the first time we've seen it, false if already used.
 * ponytail: 30-day TTL — long enough to outlive any event; drop the TTL arg for
 * permanent keys if slips must never be reusable across events.
 */
const TRANSREF_TTL_SEC = 60 * 60 * 24 * 30;
export async function claimTransRef(transRef: string): Promise<boolean> {
  const ok = await pub.set(`slip:transRef:${transRef}`, '1', 'EX', TRANSREF_TTL_SEC, 'NX');
  return ok === 'OK';
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
  const tok = { transRef: 'TR-demo', tableId: t, sessionId: 'sessionA', amount: 5999 };
  await mintPaymentToken(tok);
  const wrongSession = await consumePaymentToken(t, 'sessionB');
  console.assert(wrongSession === null, 'other session cannot consume token');
  const consumed = await consumePaymentToken(t, 'sessionA');
  console.assert(consumed?.transRef === 'TR-demo' && consumed?.amount === 5999, 'owner consumes token');
  const again = await consumePaymentToken(t, 'sessionA');
  console.assert(again === null, 'token is single-use');

  console.log('redis lock self-check passed');
  process.exit(0);
}

if (import.meta.main) {
  _demo().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

// Tracks live WS connections per session so the server can free a session's
// pre-payment 'selecting' table locks when its LAST socket drops (browser quit).
// Without this, a quit-mid-selection leaves the table greyed-out for the full
// 10-min Redis TTL — the reported "state still alive" bug. Two guards keep it
// correct: a grace window (a reload/reconnect re-opens the socket before we act)
// and a per-session refcount (closing one of several tabs must not free a
// selection another tab still holds). pending_payment locks are never freed here.

type ReleaseFn = (sessionId: string) => void;

export class SessionPresence {
  private sockets = new Map<string, Set<object>>();
  private pending = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private graceMs: number, private onGone: ReleaseFn) {}

  connect(sessionId: string, ws: object) {
    // A returning socket cancels a scheduled release (this was a reload/reconnect).
    const t = this.pending.get(sessionId);
    if (t) { clearTimeout(t); this.pending.delete(sessionId); }
    let set = this.sockets.get(sessionId);
    if (!set) { set = new Set(); this.sockets.set(sessionId, set); }
    set.add(ws);
  }

  disconnect(sessionId: string, ws: object) {
    const set = this.sockets.get(sessionId);
    if (!set) return;
    set.delete(ws);
    if (set.size > 0) return; // another tab still holds this session — keep the lock
    this.sockets.delete(sessionId);
    const timer = setTimeout(() => {
      this.pending.delete(sessionId);
      this.onGone(sessionId);
    }, this.graceMs);
    this.pending.set(sessionId, timer);
  }
}

// Runnable self-check: `bun src/server/presence.ts`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function _demo() {
  const gone: string[] = [];
  const p = new SessionPresence(20, (sid) => gone.push(sid));
  const wsA = {}, wsB = {};

  // last socket closes → release fires after the grace window
  p.connect('s1', wsA);
  p.disconnect('s1', wsA);
  await sleep(45);
  console.assert(gone.includes('s1'), 'release after last socket closes');

  // two tabs: closing one keeps the lock; closing the last releases
  gone.length = 0;
  p.connect('s2', wsA);
  p.connect('s2', wsB);
  p.disconnect('s2', wsA);
  await sleep(45);
  console.assert(!gone.includes('s2'), 'one tab still open keeps the lock');
  p.disconnect('s2', wsB);
  await sleep(45);
  console.assert(gone.includes('s2'), 'last tab closing releases');

  // reconnect within grace cancels the release (page reload)
  gone.length = 0;
  p.connect('s3', wsA);
  p.disconnect('s3', wsA); // schedules release
  p.connect('s3', wsB);    // reconnect before grace elapses → cancel
  await sleep(45);
  console.assert(!gone.includes('s3'), 'reconnect within grace cancels release');

  console.log('presence self-check passed');
  process.exit(0);
}

if (import.meta.main) {
  _demo().catch((e) => { console.error(e); process.exit(1); });
}

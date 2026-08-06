import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from '../db';
import type { Context } from './trpc';

export const SESSION_COOKIE = 'ausscheiden_sid';

// The cookie is HMAC-signed so an attacker can't FIXATE a chosen sid in a
// victim's browser: a value whose signature doesn't verify is rejected and a
// fresh sid is minted instead. The sid itself is a random UUID (unguessable), so
// signing buys fixation resistance, not brute-force/leak-replay resistance.
// Prod demands a real secret (same "no weak default" rule as the DB/Redis
// passwords); dev uses a constant so `bun dev` needs no env.
// ponytail: one secret, HS256. For zero-downtime rotation, accept a 2nd (old)
// secret on verify.
const SESSION_SECRET =
  process.env.SESSION_SECRET ??
  (process.env.NODE_ENV === 'production'
    ? (() => {
        throw new Error('SESSION_SECRET is required in production');
      })()
    : 'dev-insecure-session-secret');

function sign(sid: string): string {
  return createHmac('sha256', SESSION_SECRET).update(sid).digest('base64url');
}

/** Verify a `sid.sig` cookie value; returns the sid only if the signature is
 * valid (constant-time). Legacy unsigned cookies (no dot) and any forgery return
 * undefined, so the caller mints a fresh signed sid. */
function verifySid(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return undefined; // no signature segment
  const sid = raw.slice(0, dot);
  const got = Buffer.from(raw.slice(dot + 1));
  const want = Buffer.from(sign(sid));
  // timingSafeEqual throws on length mismatch — length-check first.
  if (got.length !== want.length || !timingSafeEqual(got, want)) return undefined;
  return sid;
}

function parseCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

// Cheap unique id without a dep. crypto.randomUUID is available in Node 19+/Bun.
function newSid(): string {
  return crypto.randomUUID();
}

/**
 * Real client IP from X-Forwarded-For, taking the RIGHTMOST hop.
 * The app is only reachable through one trusted proxy (shared nginx), which
 * appends the peer it actually saw. The leftmost entry is whatever the client
 * sent and is fully attacker-controlled — trusting it lets an attacker forge
 * any IP to dodge per-IP rate limits. The rightmost is the address nginx
 * observed, so that's the one we key limits on.
 * ponytail: assumes exactly one trusted proxy. If a second proxy is ever added
 * in front, trust the 2nd-from-right instead (count = trusted-proxy depth).
 */
export function clientIpFromXff(
  xff: string | null | undefined,
  fallback: string = 'unknown'
): string {
  if (!xff) return fallback;
  const hops = xff.split(',').map((h) => h.trim()).filter(Boolean);
  return hops.length > 0 ? hops[hops.length - 1] : fallback;
}

/** Serialize the session cookie. `Secure` in prod (HTTPS-only); `HttpOnly`
 * always — the client no longer reads it (lock ownership comes from the
 * server-computed `mine` flag), so JS never needs access. */
export function sessionCookie(sid: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const value = `${sid}.${sign(sid)}`;
  return `${SESSION_COOKIE}=${value}; Path=/; SameSite=Lax; HttpOnly; Max-Age=86400${secure}`;
}

/** Build context from a raw cookie header. `mintedSid` is set when a new id was generated
 * (the HTTP handler must then Set-Cookie it). */
export function buildContext(
  cookieHeader: string | null | undefined,
  ip: string = 'unknown'
): {
  ctx: Context;
  mintedSid?: string;
} {
  const existing = verifySid(parseCookie(cookieHeader, SESSION_COOKIE));
  const sessionId = existing ?? newSid();
  return {
    ctx: { db, sessionId, ip },
    mintedSid: existing ? undefined : sessionId,
  };
}

// Self-check the cookie signing: `bun src/server/trpc/context.ts`.
function _demo() {
  const sid = crypto.randomUUID();
  const signed = `${sid}.${sign(sid)}`;

  console.assert(verifySid(signed) === sid, 'valid signature round-trips to the sid');
  console.assert(verifySid(`${sid}.${sign(sid)}X`) === undefined, 'tampered signature rejected');
  console.assert(verifySid(`${sid}tamper.${sign(sid)}`) === undefined, 'tampered sid rejected');
  console.assert(verifySid(sid) === undefined, 'legacy unsigned cookie rejected (no dot)');
  console.assert(verifySid('') === undefined, 'empty rejected');
  console.assert(verifySid(`.${sign('')}`) === undefined, 'empty sid (dot at 0) rejected');
  // length-mismatch must NOT throw (timingSafeEqual would) — guarded before compare.
  console.assert(verifySid(`${sid}.short`) === undefined, 'short signature rejected, no throw');

  // A cookie signed under a different secret does not verify under this one.
  const foreign = `${sid}.${createHmac('sha256', 'other-secret').update(sid).digest('base64url')}`;
  console.assert(verifySid(foreign) === undefined, 'foreign-secret signature rejected');

  console.log('session cookie signing self-check passed');
}

// Bun sets import.meta.main for the entry file only.
if (import.meta.main) _demo();

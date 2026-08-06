import { db } from '../db';
import type { Context } from './trpc';

export const SESSION_COOKIE = 'ausscheiden_sid';

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
  return `${SESSION_COOKIE}=${sid}; Path=/; SameSite=Lax; HttpOnly; Max-Age=86400${secure}`;
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
  const existing = parseCookie(cookieHeader, SESSION_COOKIE);
  const sessionId = existing ?? newSid();
  return {
    ctx: { db, sessionId, ip },
    mintedSid: existing ? undefined : sessionId,
  };
}

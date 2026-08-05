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

/** Build context from a raw cookie header. `mintedSid` is set when a new id was generated
 * (the HTTP handler must then Set-Cookie it). */
export function buildContext(cookieHeader: string | null | undefined): {
  ctx: Context;
  mintedSid?: string;
} {
  const existing = parseCookie(cookieHeader, SESSION_COOKIE);
  const sessionId = existing ?? newSid();
  return {
    ctx: { db, sessionId },
    mintedSid: existing ? undefined : sessionId,
  };
}

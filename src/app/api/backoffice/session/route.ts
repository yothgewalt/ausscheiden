import type { NextRequest } from 'next/server';
import { adminCookie, clearAdminCookie, isAdminToken } from '../../../../server/admin';
import { clientIpFromXff } from '../../../../server/trpc/context';
import { rateLimitHit } from '../../../../server/redis';

// A route handler rather than a tRPC procedure: this is the one call that has to
// write a Set-Cookie, and superjson/batching buy nothing for a single string.

// Every attempt counts, not just failures — the counter has to be checked before
// the token compare, and a real organiser logs in about once a day. 10 per 15
// minutes per IP is invisible to them and stops brute-force log spam cold.
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_SEC = 900;

export async function POST(req: NextRequest) {
  const ip = clientIpFromXff(req.headers.get('x-forwarded-for'));
  if (!(await rateLimitHit('admin', ip, LOGIN_LIMIT, LOGIN_WINDOW_SEC))) {
    return Response.json(
      { error: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  // Trimmed: `openssl rand -base64 32` output is usually pasted with a trailing
  // newline, and a token that fails only because of whitespace is a bad hour.
  const token = typeof body?.token === 'string' ? body.token.trim() : '';

  if (!isAdminToken(token)) {
    return Response.json({ error: 'โทเคนไม่ถูกต้อง' }, { status: 401 });
  }

  return new Response(null, { status: 204, headers: { 'Set-Cookie': adminCookie(token) } });
}

export async function DELETE() {
  return new Response(null, { status: 204, headers: { 'Set-Cookie': clearAdminCookie() } });
}

import { createHash, timingSafeEqual } from 'node:crypto';

export const ADMIN_COOKIE = 'ausscheiden_admin';

// 12h — long enough for a full event day, short enough that a forgotten open
// laptop stops showing buyer names/phones/emails by the next morning.
const MAX_AGE_SEC = 12 * 60 * 60;

/**
 * The shared organiser token, from `ADMIN_TOKEN` (generate with
 * `openssl rand -base64 32`).
 *
 * Read lazily, not at module load: `next build` imports this file to collect
 * page data with no runtime env present.
 *
 * ponytail: one shared token, and the cookie stores the token itself rather
 * than a derived session id. That buys a real property — rotating ADMIN_TOKEN
 * logs everyone out instantly, no session store to purge. Upgrade path if
 * per-person audit trails are ever needed: a signed `user.exp` cookie keyed by
 * the same secret, exactly like sessionCookie() in trpc/context.ts.
 */
function adminToken(): string | undefined {
  const t = process.env.ADMIN_TOKEN;
  return t && t.length > 0 ? t : undefined;
}

/**
 * Constant-time compare of a candidate token (from the login form or the
 * cookie) against ADMIN_TOKEN.
 *
 * Fails CLOSED: an unset or empty ADMIN_TOKEN rejects everything, so a deploy
 * that forgot the env var serves a locked door rather than an open backoffice.
 * Hashing both sides first keeps the compare constant-length, so a wrong guess
 * leaks neither the token's length nor its prefix.
 */
export function isAdminToken(candidate: string | undefined | null): boolean {
  const want = adminToken();
  if (!want || !candidate) return false;
  const a = createHash('sha256').update(candidate).digest();
  const b = createHash('sha256').update(want).digest();
  return timingSafeEqual(a, b);
}

function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/** Is this request carrying a valid backoffice cookie? Pass the raw `Cookie` header. */
export function isAdminRequest(cookieHeader: string | null | undefined): boolean {
  return isAdminToken(readCookie(cookieHeader, ADMIN_COOKIE));
}

/**
 * Set-Cookie value for a successful login. `Secure` in prod (HTTPS only).
 * The token is stored raw: base64's `+`, `/` and `=` are all legal cookie
 * octets, and skipping the encode keeps this byte-identical to what
 * `next/headers` cookies() hands the server components.
 */
export function adminCookie(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${ADMIN_COOKIE}=${token}; Path=/; SameSite=Lax; HttpOnly; Max-Age=${MAX_AGE_SEC}${secure}`;
}

/** Set-Cookie value that expires the session immediately. */
export function clearAdminCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${ADMIN_COOKIE}=; Path=/; SameSite=Lax; HttpOnly; Max-Age=0${secure}`;
}

// ── self-check: bun src/server/admin.ts ────────────────────────────────────
function _demo() {
  const saved = process.env.ADMIN_TOKEN;

  process.env.ADMIN_TOKEN = '';
  console.assert(!isAdminToken(''), 'unset ADMIN_TOKEN rejects the empty token');
  console.assert(!isAdminToken('anything'), 'unset ADMIN_TOKEN fails closed');

  process.env.ADMIN_TOKEN = 'sVQ0/9wq+bYh8Zk=';
  console.assert(isAdminToken('sVQ0/9wq+bYh8Zk='), 'exact token accepted');
  console.assert(!isAdminToken('sVQ0/9wq+bYh8Zk'), 'truncated token rejected');
  console.assert(!isAdminToken('sVQ0/9wq+bYh8Zk=X'), 'extended token rejected');
  console.assert(!isAdminToken(''), 'empty candidate rejected');
  console.assert(!isAdminToken(undefined), 'missing cookie rejected');
  // Differing lengths must not throw — timingSafeEqual would on raw buffers.
  console.assert(!isAdminToken('x'), 'short candidate rejected, no throw');

  // base64 tokens contain +/= — they must survive the cookie round-trip.
  const cookie = adminCookie('sVQ0/9wq+bYh8Zk=');
  const header = cookie.slice(0, cookie.indexOf(';'));
  console.assert(isAdminRequest(header), 'base64 token round-trips through the cookie');
  console.assert(isAdminRequest(`other=1; ${header}; another=2`), 'found among other cookies');
  console.assert(!isAdminRequest('ausscheiden_sid=abc.def'), 'unrelated cookie is not admin');
  console.assert(!isAdminRequest(undefined), 'no cookie header is not admin');
  console.assert(!isAdminRequest(`${ADMIN_COOKIE}=wrong`), 'wrong token in cookie rejected');
  console.assert(cookie.includes('HttpOnly'), 'cookie is HttpOnly');
  console.assert(cookie.includes('Max-Age=43200'), 'cookie lives 12h');
  console.assert(clearAdminCookie().includes('Max-Age=0'), 'logout expires the cookie');

  if (saved === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = saved;
  console.log('admin token self-check passed');
}

if (import.meta.main) _demo();

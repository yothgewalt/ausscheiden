// RDCW Slip Verify API client — server-only (holds the client secret).
// Docs: https://slip.rdcw.co.th/docs  •  POST https://suba.rdcw.co.th/v2/inquiry
// Auth: HTTP Basic base64(clientId:clientSecret). Accepts raw image bytes.

import { createHash } from 'node:crypto';

const ENDPOINT = 'https://suba.rdcw.co.th/v2/inquiry';

// Hard ceiling on the outbound inquiry. MUST stay below nginx's proxy_read_timeout
// (75s on prod) so a hung RDCW is answered by US with a real Thai message — an
// un-timed-out fetch let nginx win the race and reply with its HTML 504 page,
// which the tRPC client then JSON.parse'd into
// `Unexpected token '<', "<html> <h"... is not valid JSON` in the buyer's face.
const TIMEOUT_MS = 20_000;

/**
 * Stable content hash of a slip image data-URL — sha256 of the base64 body
 * (falls back to the whole string if it isn't a data-URL). Used to key the
 * negative cache so an identical image never re-spends an RDCW API call.
 */
export function hashSlipImage(dataUrl: string): string {
  const body = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
  return createHash('sha256').update(body).digest('hex');
}

// Expected payee — pinned server-side, mirrors eventDetails.promptpayAccountName
// (src/data/mockData.ts). The API masks names (e.g. "น.ส. ณัฏฐา ส"), so we match partially.
export const EXPECTED_RECEIVER = 'ณัฏฐา สงวนศักดิ์';

// Expected receiving bank code — pinned server-side. "004" = KBANK (Kasikornbank),
// the bank behind the PromptPay account. The slip must credit this bank.
export const EXPECTED_RECEIVING_BANK = '004';

// Last 4 of the PromptPay e-Wallet ID (004-64900071-0988). RDCW masks the proxy
// value to "XXXXXXXXXXX0988"; we match on the visible tail.
export const EXPECTED_RECEIVER_PROXY_LAST4 = '0988';

/**
 * Proxy-value match. The API masks the receiver proxy to its last 4 digits
 * (e.g. "XXXXXXXXXXX0988"). Absent proxy (direct bank transfer) ⇒ null = "can't
 * check", caller decides. Present ⇒ its last 4 digits must equal the expected.
 */
export function proxyMatches(proxyValue: string | null | undefined): boolean | null {
  if (!proxyValue) return null;
  const last4 = proxyValue.replace(/\D/g, '').slice(-4);
  if (last4.length < 4) return null; // fully masked / no digits → can't check
  return last4 === EXPECTED_RECEIVER_PROXY_LAST4;
}

// Honorifics to drop before comparing (dots removed, upper-cased).
const HONORIFICS = new Set([
  'นาย', 'นาง', 'นางสาว', 'นส', 'ดช', 'ดญ', 'ดร',
  'MR', 'MRS', 'MS', 'MISS', 'DR',
]);

const normToken = (t: string) => t.replace(/\./g, '').toUpperCase();

const nameTokens = (name: string): string[] =>
  name
    .trim()
    .split(/\s+/)
    .filter((t) => t && !HONORIFICS.has(normToken(t)));

/**
 * Partial receiver match: every token the API returned must be a prefix of some
 * expected token (or vice-versa — the API truncates surnames to one char).
 * "ณัฏฐา ส" ⊂ "ณัฏฐา สงวนศักดิ์" → true.  "สมชาย ใจดี" → false.
 */
export function receiverMatches(apiName: string | null | undefined): boolean {
  if (!apiName) return false;
  const expected = nameTokens(EXPECTED_RECEIVER);
  const got = nameTokens(apiName);
  if (got.length === 0) return false;
  return got.every((g) =>
    expected.some((e) => e.startsWith(g) || g.startsWith(e))
  );
}

export interface RdcwSlipData {
  amount: number;
  transRef: string;
  transDate?: string;
  transTime?: string;
  receivingBank?: string; // bank code crediting the money, e.g. "004" = KBANK
  sendingBank?: string;
  sender?: { name?: string; displayName?: string };
  receiver: {
    name?: string;
    displayName?: string;
    proxy?: { type?: string | null; value?: string | null };
  };
}

// Slip-verify quota for the account — sibling of `data` in the response envelope.
export interface RdcwQuota {
  usage: number;
  limit: number;
}

export interface RdcwInquiry {
  data: RdcwSlipData;
  quota?: RdcwQuota;
}

// HTTP-400 error codes → Thai message. Docs table.
const ERROR_TH: Record<number, string> = {
  1000: 'คำขอไม่ถูกต้อง (missing headers)',
  1001: 'การยืนยันตัวตนกับระบบตรวจสลิปไม่ถูกต้อง',
  1002: 'การยืนยันตัวตนกับระบบตรวจสลิปไม่ถูกต้อง',
  1003: 'IP ไม่ได้รับอนุญาตให้เรียกใช้ระบบตรวจสลิป',
  1004: 'สลิปไม่ถูกต้อง หรืออ่านค่าไม่ได้',
  1005: 'สลิปไม่ถูกต้อง หรืออ่านค่าไม่ได้',
  1006: 'สลิปไม่ถูกต้อง หรืออ่านค่าไม่ได้',
  1007: 'โควตาการตรวจสลิปถูกใช้จนหมด กรุณาติดต่อผู้จัดงาน',
  1008: 'แพ็กเกจตรวจสลิปหมดอายุ กรุณาติดต่อผู้จัดงาน',
  2006: 'ธนาคารไม่พบข้อมูลของสลิปนี้ กรุณาตรวจสอบสลิปอีกครั้ง',
};

/**
 * Thai message for a fetch that never produced a response. Split out from the
 * call site so the timeout branch is assertable without a network (see the
 * self-check below). A timeout is retryable and the retry is free — the caller
 * caches a successful verdict by image hash — so the copy says "try again".
 */
export function transportErrorMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  return name === 'TimeoutError' || name === 'AbortError'
    ? 'ระบบตรวจสลิปใช้เวลานานเกินไป กรุณากดยืนยันการชำระเงินอีกครั้ง'
    : 'เชื่อมต่อระบบตรวจสลิปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
}

/**
 * Send the uploaded slip image (a `data:image/…;base64,…` URL from the browser)
 * to RDCW and return the parsed transaction data. Throws a Thai-message Error on
 * missing creds, a bad data URL, a timeout/network failure, or any non-OK API
 * response — every throw here is already user-facing copy.
 */
export async function verifySlipImage(dataUrl: string): Promise<RdcwInquiry> {
  const clientId = process.env.RDCW_CLIENT_ID;
  const clientSecret = process.env.RDCW_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('ระบบตรวจสลิปยังไม่ได้ตั้งค่า (RDCW credentials missing)');
  }

  const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error('ไฟล์สลิปไม่ถูกต้อง กรุณาอัปโหลดรูปภาพสลิป (JPG/PNG)');
  const [, mime, b64] = m;
  const bytes = Buffer.from(b64, 'base64');

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': mime },
      body: bytes,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // The only observability this path ever had was nginx's access log — the app
    // logged nothing at all for the 504 that stranded a buyer. Log both branches.
    console.error(
      `[rdcw] inquiry failed after ${Date.now() - started}ms (${bytes.length}B ${mime}):`,
      err instanceof Error ? `${err.name}: ${err.message}` : err
    );
    throw new Error(transportErrorMessage(err));
  }

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const code = json?.code as number | undefined;
    console.error(
      `[rdcw] inquiry HTTP ${res.status} after ${Date.now() - started}ms (code=${code ?? '-'})`
    );
    throw new Error(
      (code && ERROR_TH[code]) ||
        json?.message ||
        `ตรวจสอบสลิปไม่สำเร็จ (HTTP ${res.status})`
    );
  }

  if (!json?.valid || !json?.data) {
    throw new Error('ไม่พบข้อมูลการโอนในสลิปนี้ กรุณาตรวจสอบสลิปอีกครั้ง');
  }

  return { data: json.data as RdcwSlipData, quota: json.quota as RdcwQuota | undefined };
}

// ── ponytail self-check: money/security matcher gets one runnable assert. ──
// Run: `bun src/server/rdcw.ts`
if ((import.meta as { main?: boolean }).main) {
  const ok = (c: boolean, msg: string) => {
    if (!c) throw new Error(`FAIL: ${msg}`);
    console.log(`ok: ${msg}`);
  };
  ok(receiverMatches('น.ส. ณัฏฐา ส'), 'masked payee matches (น.ส. ณัฏฐา ส)');
  ok(receiverMatches('MS. NATTHA S') === false, 'latin masked name does not false-positive');
  ok(receiverMatches('ณัฏฐา สงวนศักดิ์'), 'full payee matches');
  ok(receiverMatches('นาย สมชาย ใจดี') === false, 'wrong payee rejected');
  ok(receiverMatches('') === false, 'empty rejected');
  ok(receiverMatches(null) === false, 'null rejected');
  ok(proxyMatches('XXXXXXXXXXX0988') === true, 'masked proxy tail matches');
  ok(proxyMatches('XXXXXXXXXXX1234') === false, 'wrong proxy tail rejected');
  ok(proxyMatches(null) === null, 'absent proxy → null (uncheckable)');
  ok(proxyMatches('XXXXXXXXXXX') === null, 'fully-masked proxy → null');
  ok(
    hashSlipImage('data:image/png;base64,AAAA') === hashSlipImage('data:image/jpeg;base64,AAAA'),
    'hash ignores mime, keys on body'
  );
  ok(
    hashSlipImage('data:image/png;base64,AAAA') !== hashSlipImage('data:image/png;base64,BBBB'),
    'different image body → different hash'
  );

  // The 504 regression: a hung upstream must reject on OUR clock, and the
  // rejection must map to the retryable Thai copy — never leak to the proxy.
  ok(
    transportErrorMessage(Object.assign(new Error('x'), { name: 'TimeoutError' })).includes('นานเกินไป'),
    'TimeoutError → "took too long" copy'
  );
  ok(
    transportErrorMessage(new TypeError('fetch failed')).includes('เชื่อมต่อ'),
    'network error → "could not connect" copy'
  );
  const hung = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) });
  const caught = await fetch(hung.url, { signal: AbortSignal.timeout(150) }).then(
    () => null,
    (e) => e as Error
  );
  hung.stop(true);
  ok(caught?.name === 'TimeoutError', `AbortSignal.timeout aborts a hung fetch (got ${caught?.name})`);
  ok(
    transportErrorMessage(caught).includes('นานเกินไป'),
    'a real aborted fetch maps to the timeout copy'
  );

  console.log('all rdcw self-checks passed');
}

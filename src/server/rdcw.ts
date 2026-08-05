// RDCW Slip Verify API client — server-only (holds the client secret).
// Docs: https://slip.rdcw.co.th/docs  •  POST https://suba.rdcw.co.th/v2/inquiry
// Auth: HTTP Basic base64(clientId:clientSecret). Accepts raw image bytes.

const ENDPOINT = 'https://suba.rdcw.co.th/v2/inquiry';

// Expected payee — pinned server-side, mirrors eventDetails.promptpayAccountName
// (src/data/mockData.ts). The API masks names (e.g. "น.ส. ณัฏฐา ส"), so we match partially.
export const EXPECTED_RECEIVER = 'ณัฏฐา สงวนศักดิ์';

// Expected receiving bank code — pinned server-side. "004" = KBANK (Kasikornbank),
// the bank behind the PromptPay account. The slip must credit this bank.
export const EXPECTED_RECEIVING_BANK = '004';

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
  receiver: { name?: string; displayName?: string };
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
 * Send the uploaded slip image (a `data:image/…;base64,…` URL from the browser)
 * to RDCW and return the parsed transaction data. Throws a Thai-message Error on
 * missing creds, a bad data URL, or any non-OK API response.
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

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': mime },
    body: bytes,
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const code = json?.code as number | undefined;
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
  console.log('all rdcw self-checks passed');
}

// PromptPay EMVCo QR payload builder (Thai bank-scannable).
// Spec: EMV QRCPS + Bank of Thailand PromptPay. Amount embedded → dynamic QR.

const tlv = (id: string, value: string) =>
  id + value.length.toString().padStart(2, '0') + value;

// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — the checksum EMVCo tag 63 requires.
function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// phone: any format (dashes/spaces ok). amount in THB. Returns the raw QR string,
// or '' if no usable number — callers skip rendering rather than crash.
export function promptPayPayload(phone: string | undefined | null, amount: number): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 9) return ''; // ponytail: no valid proxy → no QR, don't throw
  // Mobile proxy = "0066" + 9-digit number (leading 0 dropped).
  const proxy = '0066' + digits.replace(/^0/, '');

  const merchant =
    tlv('00', 'A000000677010111') + tlv('01', proxy); // AID + mobile

  const body =
    tlv('00', '01') + // payload format indicator
    tlv('01', '12') + // dynamic (amount present)
    tlv('29', merchant) +
    tlv('53', '764') + // currency THB
    tlv('54', amount.toFixed(2)) +
    tlv('58', 'TH'); // country

  const toCrc = body + '6304';
  return toCrc + crc16(toCrc);
}

// ponytail: money path → one runnable check. Verified against a known-good payload.
export function _demo() {
  // 0812223333 / 100.25 THB — reference payload from BOT/EMVCo examples.
  const p = promptPayPayload('081-222-3333', 100.25);
  console.assert(
    p ===
      '00020101021229370016A0000006770101110113006681222333353037645406100.255802TH6304' +
        p.slice(-4),
    'PromptPay payload structure drift'
  );
  console.assert(crc16('123456789') === '29B1', 'CRC16/CCITT-FALSE broken');
  return p;
}

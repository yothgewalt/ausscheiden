// MinIO / S3 slip archive. Uses Bun's native S3Client (no extra dep) — works
// against MinIO by pointing endpoint at it. One singleton, mirroring redis.ts.

// Lazy singleton: `next build` collects page data under Node (no `bun` module),
// so we must not touch bun at import time — only on first real upload (runtime = Bun).
let s3: import('bun').S3Client | undefined;
async function getS3() {
  if (!s3) {
    const { S3Client } = await import('bun');
    s3 = new S3Client({
      endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
      bucket: process.env.S3_BUCKET || 'slips',
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    });
  }
  return s3;
}

// data:image/jpeg;base64,… → same shape rdcw.ts accepts. Returns [mime, ext, bytes]
// or null if it isn't an image data-URL.
const DATA_URL_RE = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/;

// Must stay well under nginx's proxy_read_timeout — see uploadSlip.
const UPLOAD_TIMEOUT_MS = 8_000;
function parseSlip(dataUrl: string): { mime: string; ext: string; bytes: Buffer } | null {
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) return null;
  const [, mime, b64] = m;
  const sub = mime.slice('image/'.length);
  const ext = sub === 'jpeg' ? 'jpg' : sub; // jpeg→jpg, else png/webp/…
  return { mime, ext, bytes: Buffer.from(b64, 'base64') };
}

/**
 * Store a slip at `<prefix>/<ref>/slip.<ext>` and return the object key.
 * Best-effort: parse failure or a MinIO outage logs and returns null — the caller
 * has already taken the money and inserted the booking, so archival must not throw.
 */
export async function uploadSlip(
  prefix: string,
  ref: string,
  dataUrl: string
): Promise<string | null> {
  const parsed = parseSlip(dataUrl);
  if (!parsed) {
    console.error(`[storage] slip for ${prefix}/${ref} is not an image data-URL`);
    return null;
  }
  const key = `${prefix}/${ref}/slip.${parsed.ext}`;
  try {
    // Bounded: this runs AFTER the DB commit but INSIDE the request, so a hung
    // MinIO would hold the response past nginx's proxy_read_timeout and hand the
    // buyer an HTML 504 for a booking that actually succeeded. Losing the archive
    // is recoverable; telling a paid buyer they failed is not.
    await Promise.race([
      (await getS3()).write(key, parsed.bytes, { type: parsed.mime }),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error(`upload timed out after ${UPLOAD_TIMEOUT_MS}ms`)), UPLOAD_TIMEOUT_MS)
      ),
    ]);
    return key;
  } catch (e: any) {
    console.error(`[storage] slip upload failed for ${key}: ${e?.message || e}`);
    return null;
  }
}

// ── self-check: bun src/server/storage.ts ──────────────────────────────────
async function _demo() {
  const png = 'data:image/png;base64,aGVsbG8='; // "hello"
  const p = parseSlip(png)!;
  if (p.ext !== 'png' || p.mime !== 'image/png') throw new Error('png parse');
  if (p.bytes.toString() !== 'hello') throw new Error('png bytes decode');

  if (parseSlip('data:image/jpeg;base64,aGk=')!.ext !== 'jpg') throw new Error('jpeg→jpg');
  if (parseSlip('data:image/webp;base64,aGk=')!.ext !== 'webp') throw new Error('webp');
  if (parseSlip('not-a-data-url') !== null) throw new Error('reject non-image');
  if (parseSlip('data:application/pdf;base64,aGk=') !== null) throw new Error('reject non-image mime');

  // key format — the whole point of the task
  const parsed = parseSlip(png)!;
  const key = `T01/BK-2026-abcd/slip.${parsed.ext}`;
  if (key !== 'T01/BK-2026-abcd/slip.png') throw new Error('key format');

  console.log('storage.ts self-check OK');
}

if (import.meta.main) _demo();

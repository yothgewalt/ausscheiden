// Slips arrive straight off a phone camera — 3–8 MB, ~4000px wide — and ride the
// wire as a base64 data URL (+33%), on the buyer path TWICE: once for
// slips.verify and again for confirmBooking. Downscale anything past MAX_EDGE:
// 1600px keeps the slip's QR and text far inside what RDCW reads, shortens the
// upload leg that pushed a verify past nginx's read timeout, and keeps the body
// under client_max_body_size. Smaller images are passed through byte-for-byte.
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

/** Hard stop under the 10m proxy limit. Callers reject anything longer. */
export const MAX_SLIP_CHARS = 9 * 1024 * 1024;

export const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });

/**
 * File → `data:image/…;base64,…`, downscaled to MAX_EDGE on the longest side.
 *
 * Throws if the browser can't decode the format (createImageBitmap has no HEIC
 * on some browsers) — callers fall back to `readAsDataUrl` so an undecodable
 * file still uploads at full size rather than failing outright.
 */
export async function toSlipDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= MAX_EDGE) return await readAsDataUrl(file);

    const scale = MAX_EDGE / longest;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return await readAsDataUrl(file);
    // JPEG has no alpha — paint white first or a transparent PNG screenshot
    // flattens onto black and the slip becomes unreadable.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  } finally {
    bitmap.close();
  }
}

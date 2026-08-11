import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '../../../../server/db';
import { bookings } from '../../../../server/db/schema';
import { isAdminRequest, slipFilename } from '../../../../server/admin';
import { readSlip } from '../../../../server/storage';

/**
 * `GET /api/backoffice/slip?id=<booking uuid>` → the archived payment slip.
 *
 * Proxied through Next rather than handed out as a presigned MinIO URL because
 * MinIO binds to 127.0.0.1 in both compose files — the browser cannot reach it.
 * The object key comes from the booking row, never from the query string, so
 * there is no path to traverse.
 */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req.headers.get('cookie'))) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Shape-check before it reaches Postgres: `bookings.id` is a uuid column, and
  // a non-uuid string makes the driver throw 22P02 instead of returning no rows.
  const id = req.nextUrl.searchParams.get('id');
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return Response.json({ error: 'missing or malformed id' }, { status: 400 });
  }

  const [row] = await db
    .select({ ref: bookings.ref, slipPath: bookings.slipPath })
    .from(bookings)
    .where(eq(bookings.id, id));

  if (!row?.slipPath) return Response.json({ error: 'no slip for this booking' }, { status: 404 });

  const slip = await readSlip(row.slipPath);
  if (!slip) return Response.json({ error: 'slip unavailable' }, { status: 404 });

  return new Response(new Uint8Array(slip.bytes), {
    headers: {
      'Content-Type': slip.mime,
      // slipFilename() sanitises the client-supplied `ref` — see its contract.
      'Content-Disposition': `attachment; filename="${slipFilename(row.ref, row.slipPath)}"`,
      // The mime label is buyer-declared, so stop the browser from sniffing its
      // way to something scriptable.
      'X-Content-Type-Options': 'nosniff',
      // Buyer payment slips: never let a proxy or the browser keep a copy.
      'Cache-Control': 'no-store',
    },
  });
}

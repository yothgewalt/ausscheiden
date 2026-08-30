// Public sales cutoff. Unset BOOKING_CLOSES_AT ⇒ booking never closes (today's
// behaviour, so an un-plumbed deploy stays open rather than dying shut).
//
// Set it to an ISO-8601 string WITH the UTC offset — `2026-09-01T00:00:00+07:00`
// for midnight Bangkok. The offset is what makes this timezone-correct: Date
// resolves the string to an absolute instant, so the container's TZ is
// irrelevant. A bare `2026-09-01T00:00:00` would be read in the server's local
// zone and close at the wrong moment.
const raw = process.env.BOOKING_CLOSES_AT;

export const closesAt = raw ? new Date(raw) : null;

// Fail loud at startup, not silently at midnight: `new Date('nonsense')` is an
// Invalid Date, and every `<` against it is false — sales would simply never
// close, with nothing in the logs to say why.
if (closesAt && Number.isNaN(closesAt.getTime())) {
  throw new Error(
    `BOOKING_CLOSES_AT is not a valid date: ${JSON.stringify(raw)} — expected an ISO-8601 string with offset, e.g. 2026-09-01T00:00:00+07:00`
  );
}

/** Pure core, so the self-check can drive the clock. Boundary is exclusive: at
 *  the cutoff instant itself, sales are closed. */
export function isOpen(now: number, at: Date | null): boolean {
  return !at || now < at.getTime();
}

/** True while public booking is still accepted. Gates acquireLock and
 *  slips.verify; confirmBooking is deliberately NOT gated so a buyer who already
 *  paid can finish (bounded by the 10-min payment-token TTL). */
export const salesOpen = () => isOpen(Date.now(), closesAt);

function _demo() {
  const cutoff = new Date('2026-09-01T00:00:00+07:00');

  // The assertion this whole file exists for: midnight in Bangkok is 17:00Z the
  // previous day. If offset handling ever breaks, it breaks here.
  console.assert(
    cutoff.toISOString() === '2026-08-31T17:00:00.000Z',
    '+07:00 midnight resolves to 17:00Z the day before'
  );

  const t = (s: string) => new Date(s).getTime();
  console.assert(isOpen(t('2026-08-31T23:59:59+07:00'), cutoff), 'one second before the cutoff: open');
  console.assert(!isOpen(t('2026-09-01T00:00:00+07:00'), cutoff), 'at the cutoff: closed (exclusive)');
  console.assert(!isOpen(t('2026-09-01T00:00:01+07:00'), cutoff), 'after the cutoff: closed');

  // Same instant written in UTC must decide identically — proves the comparison
  // is on absolute time, not on wall-clock text.
  console.assert(isOpen(t('2026-08-31T16:59:59Z'), cutoff), 'UTC spelling of "before" agrees');
  console.assert(!isOpen(t('2026-08-31T17:00:00Z'), cutoff), 'UTC spelling of "at cutoff" agrees');

  console.assert(isOpen(t('2099-01-01T00:00:00Z'), null), 'unset cutoff: always open');

  console.assert(Number.isNaN(new Date('not-a-date').getTime()), 'malformed value is caught by the NaN guard');

  console.log('sales.ts self-check done');
}

if (import.meta.main) _demo();

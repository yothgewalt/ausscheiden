import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../server/trpc/root';

/** One row of `admin.bookings`, inferred so the UI can never drift from the router. */
export type AdminBooking = inferRouterOutputs<AppRouter>['admin']['bookings'][number];

export const TYPE_TH: Record<string, string> = {
  whole_table: 'เหมาโต๊ะ',
  individual_seats: 'รายที่นั่ง',
  individual: 'บัตรเดี่ยว',
};

export const ZONE_TH: Record<string, string> = {
  alumni: 'ศิษย์เก่า',
  student: 'รุ่นน้อง',
};

/** 24h Thai-locale stamp, e.g. "11/08/2569 18:42". Gregorian year in the CSV
 *  would be safer for spreadsheets, but the organisers read the screen in BE. */
export function fmtDateTime(d: Date | string | null): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('th-TH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const fmtBaht = (n: number) => `฿${n.toLocaleString()}`;

/** "โต๊ะ 7" or "บัตรเดี่ยว" — how the organisers actually refer to a booking. */
export function tableLabel(b: Pick<AdminBooking, 'tableNumber'>): string {
  return b.tableNumber === null ? 'บัตรเดี่ยว' : `โต๊ะ ${b.tableNumber}`;
}

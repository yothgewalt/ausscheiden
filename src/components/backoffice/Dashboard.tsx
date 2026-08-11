'use client';

import { useMemo, useState } from 'react';
import { Plus, Download, X, FileDown } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { AdminSeatMap } from './AdminSeatMap';
import { CreateBookingModal } from './CreateBookingModal';
import { toCsv, downloadCsv } from './csv';
import { AdminBooking, TYPE_TH, ZONE_TH, fmtBaht, fmtDateTime, tableLabel } from './format';
import { generateInitialTables } from '../../data/mockData';

const META = new Map(generateInitialTables().map((t) => [t.id, t]));

const CSV_HEADERS = [
  'รหัสจอง', 'วันที่จอง', 'ชื่อ-นามสกุล', 'รุ่น', 'สาขา', 'เบอร์โทร', 'อีเมล',
  'ประเภท', 'โต๊ะ', 'โซน', 'ยอดชำระ', 'transRef', 'สลิป', 'ส่งอีเมลแล้ว',
];

function csvRow(b: AdminBooking) {
  return [
    b.ref,
    fmtDateTime(b.createdAt),
    b.buyerName,
    b.batch,
    b.major,
    b.phone,
    b.email,
    TYPE_TH[b.bookingType] ?? b.bookingType,
    b.tableNumber,
    b.zone ? ZONE_TH[b.zone] ?? b.zone : '',
    b.finalAmount,
    b.transRef,
    b.slipPath ? 'มี' : '',
    fmtDateTime(b.emailSentAt),
  ];
}

export function Dashboard() {
  const utils = trpc.useUtils();
  const bookingsQuery = trpc.admin.bookings.useQuery();
  const tablesQuery = trpc.tables.list.useQuery();
  const zonesQuery = trpc.tables.zoneAvailability.useQuery();

  const [openTableId, setOpenTableId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // The real-time requirement. Same subscription the public seat map uses; the
  // organiser view just ignores `mine` (an admin session holds no locks) so it
  // sees every buyer's activity. Any event can also mean a confirm landed, so
  // the booking list is refreshed alongside the map.
  trpc.tables.onLockChange.useSubscription(undefined, {
    onData() {
      utils.tables.list.invalidate();
      utils.tables.zoneAvailability.invalidate();
      utils.admin.bookings.invalidate();
    },
  });

  const bookings = bookingsQuery.data ?? [];
  const tables = tablesQuery.data ?? [];

  const bookingByTable = useMemo(() => {
    const m: Record<string, AdminBooking> = {};
    for (const b of bookings) if (b.tableId) m[b.tableId] = b;
    return m;
  }, [bookings]);

  const buyerByTable = useMemo(() => {
    const m: Record<string, string> = {};
    for (const [id, b] of Object.entries(bookingByTable)) m[id] = b.buyerName;
    return m;
  }, [bookingByTable]);

  const stats = useMemo(() => {
    const revenue = bookings.reduce((sum, b) => sum + b.finalAmount, 0);
    const individual = bookings.filter((b) => b.bookingType === 'individual').length;
    return {
      total: bookings.length,
      tablesSold: tables.filter((t) => t.status === 'booked').length,
      individual,
      individualCap: zonesQuery.data?.individual.total ?? 0,
      revenue,
    };
  }, [bookings, tables, zonesQuery.data]);

  const exportCsv = () => {
    downloadCsv(`bookings-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(CSV_HEADERS, bookings.map(csvRow)));
  };

  const openTable = openTableId ? META.get(openTableId) : undefined;
  const openBooking = openTableId ? bookingByTable[openTableId] : undefined;
  const openStatus = openTableId ? tables.find((t) => t.id === openTableId)?.status : undefined;

  return (
    <div className="max-w-300 mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-xl font-semibold text-primary">แดชบอร์ด</h1>
          <p className="text-xs text-muted mt-0.5">ผังที่นั่งอัปเดตแบบเรียลไทม์</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={exportCsv}
            disabled={bookings.length === 0}
            className="px-5 py-2.5 rounded-lg bg-surface btn-secondary text-primary text-sm font-semibold hover:bg-page transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileDown className="w-4 h-4" />
            <span>ส่งออก CSV</span>
          </button>
          <button
            onClick={() => setCreating(true)}
            className="px-6 py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-white text-sm font-semibold transition-colors cursor-pointer flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>เพิ่มการจอง</span>
          </button>
        </div>
      </div>

      {/* Read-only figures: flat tinted panels, no cards, no shadow. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
        <Stat label="การจองทั้งหมด" value={String(stats.total)} />
        <Stat label="โต๊ะที่ขายแล้ว" value={`${stats.tablesSold}/${tables.length || 70}`} />
        <Stat label="บัตรเดี่ยว" value={`${stats.individual}/${stats.individualCap}`} />
        <Stat label="ยอดรวม" value={fmtBaht(stats.revenue)} />
      </div>

      <section className="space-y-3 mb-10">
        <h2 className="text-sm font-semibold text-primary hairline-b pb-2.5">ผู้จองล่าสุด</h2>
        {bookingsQuery.isLoading ? (
          <p className="text-sm text-muted">กำลังโหลด…</p>
        ) : bookings.length === 0 ? (
          <p className="text-sm text-muted">ยังไม่มีการจอง</p>
        ) : (
          bookings.slice(0, 10).map((b) => (
            <div key={b.id} className="flex items-baseline gap-3.5">
              <span className="font-mono text-xs text-muted shrink-0 min-w-32">
                {fmtDateTime(b.createdAt)}
              </span>
              <span className="text-sm text-primary leading-snug font-medium">{b.buyerName}</span>
              <span className="text-xs text-muted">
                รุ่น {b.batch || '—'} · {b.major || '—'}
              </span>
              <span className="text-xs font-semibold text-primary ml-auto shrink-0">
                {tableLabel(b)}
              </span>
            </div>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-primary hairline-b pb-2.5">ผังที่นั่ง</h2>
        {tablesQuery.isLoading ? (
          <p className="text-sm text-muted">กำลังโหลดผังที่นั่ง…</p>
        ) : (
          <div className="py-4 overflow-x-auto">
            <div className="min-w-150">
              <AdminSeatMap
                tables={tables}
                buyerByTable={buyerByTable}
                onSelectTable={setOpenTableId}
              />
            </div>
          </div>
        )}
      </section>

      {/* Table detail */}
      {openTableId && openTable && (
        <div
          onClick={(e) => e.target === e.currentTarget && setOpenTableId(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-primary/40 backdrop-blur-sm animate-fade-in cursor-pointer"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md bg-surface rounded-lg card-shadow overflow-hidden text-primary cursor-default"
          >
            <div className="p-4 sm:p-5 hairline-b flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-base sm:text-lg font-semibold text-primary">{openTable.name}</h3>
                <p className="text-xs text-muted">
                  {openTable.zoneLabelTh} · {openTable.capacity} ที่นั่ง · {fmtBaht(openTable.pricePerTable)}
                </p>
              </div>
              <button
                onClick={() => setOpenTableId(null)}
                aria-label="ปิด"
                className="p-2 text-muted hover:text-primary transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {openBooking ? (
                <>
                  <dl className="w-full text-sm space-y-2">
                    <Row label="รหัสจอง" value={openBooking.ref} mono />
                    <Row label="ชื่อ-นามสกุล" value={openBooking.buyerName} />
                    <Row label="รุ่น" value={openBooking.batch ?? '—'} />
                    <Row label="สาขา" value={openBooking.major ?? '—'} />
                    <Row label="เบอร์โทร" value={openBooking.phone} mono />
                    <Row label="อีเมล" value={openBooking.email} />
                    <Row label="ประเภท" value={TYPE_TH[openBooking.bookingType] ?? openBooking.bookingType} />
                    <Row label="ยอดที่ชำระ" value={fmtBaht(openBooking.finalAmount)} mono />
                    <Row label="วันที่จอง" value={fmtDateTime(openBooking.createdAt)} mono />
                  </dl>

                  {openBooking.slipPath ? (
                    <a
                      href={`/api/backoffice/slip?id=${openBooking.id}`}
                      className="w-full py-3 rounded-lg bg-primary hover:bg-primary/90 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      <span>ดาวน์โหลดสลิป</span>
                    </a>
                  ) : (
                    <div className="p-3 rounded-lg bg-page text-muted text-xs font-medium text-center">
                      ไม่มีสลิปสำหรับการจองนี้
                    </div>
                  )}
                </>
              ) : (
                <div className="p-4 rounded-lg bg-page text-sm text-muted">
                  {openStatus === 'closed'
                    ? 'โต๊ะสำรองสำหรับบัตรเดี่ยว — ไม่เปิดขายเป็นโต๊ะ'
                    : openStatus === 'selecting'
                      ? 'มีผู้ใช้กำลังเลือกโต๊ะนี้อยู่'
                      : openStatus === 'pending_payment'
                        ? 'มีผู้ใช้กำลังชำระเงินสำหรับโต๊ะนี้'
                        : 'โต๊ะนี้ยังว่าง ยังไม่มีผู้จอง'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <CreateBookingModal
        isOpen={creating}
        onClose={() => setCreating(false)}
        availableTables={tables.filter((t) => t.status === 'available')}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4 rounded-lg bg-page">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-lg font-bold text-primary font-mono mt-0.5">{value}</div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted shrink-0">{label}</dt>
      <dd className={`text-primary text-right ${mono ? 'font-mono font-semibold' : 'font-medium'}`}>
        {value}
      </dd>
    </div>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { Download, Eye, X, Search } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { AdminBooking, TYPE_TH, ZONE_TH, fmtBaht, fmtDateTime, tableLabel } from './format';

export function Checklist() {
  const utils = trpc.useUtils();
  const bookingsQuery = trpc.admin.bookings.useQuery();
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<AdminBooking | null>(null);

  // Optimistic: the checkbox has to feel instant while the organiser works
  // through a list, so paint the change and roll it back only if the write fails.
  const setSent = trpc.admin.setEmailSent.useMutation({
    onMutate: async ({ id, sent }) => {
      await utils.admin.bookings.cancel();
      const prev = utils.admin.bookings.getData();
      utils.admin.bookings.setData(undefined, (old) =>
        old?.map((b) => (b.id === id ? { ...b, emailSentAt: sent ? new Date() : null } : b))
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) utils.admin.bookings.setData(undefined, ctx.prev);
    },
    onSettled: () => {
      utils.admin.bookings.invalidate();
    },
  });

  const bookings = bookingsQuery.data ?? [];

  // Whole dataset is already in memory (~90 rows), so filtering is local.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bookings;
    return bookings.filter((b) =>
      [b.ref, b.buyerName, b.phone, b.email, b.batch, b.major]
        .some((f) => f?.toLowerCase().includes(q))
    );
  }, [bookings, query]);

  const sentCount = bookings.filter((b) => b.emailSentAt).length;

  return (
    <div className="max-w-300 mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-primary">เช็คลิสต์</h1>
          <p className="text-xs text-muted mt-0.5">
            ส่งอีเมลแล้ว {sentCount} จาก {bookings.length} รายการ
          </p>
        </div>
        <div className="relative shrink-0">
          <Search className="w-4 h-4 text-subtle absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            placeholder="ค้นหาชื่อ / รหัส / เบอร์ / อีเมล"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-72 bg-surface rounded-lg pl-9 pr-3.5 py-2.5 text-sm text-primary placeholder:text-subtle border border-[rgba(20,20,20,0.16)] transition-colors focus:outline-none focus:ring-2 focus:border-primary focus:ring-primary/15"
          />
        </div>
      </div>

      {bookingsQuery.isLoading ? (
        <p className="text-sm text-muted">กำลังโหลด…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">{query ? 'ไม่พบรายการที่ค้นหา' : 'ยังไม่มีการจอง'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="hairline-b">
                <Th>รหัสจอง</Th>
                <Th>ชื่อ-นามสกุล</Th>
                <Th>รุ่น</Th>
                <Th>สาขา</Th>
                <Th>โต๊ะ</Th>
                <Th right>ยอด</Th>
                <Th>วันที่จอง</Th>
                <Th center>สลิป</Th>
                <Th center>ข้อมูล</Th>
                <Th center>ส่งอีเมลแล้ว</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="hairline-b">
                  <Td><span className="font-mono text-xs">{b.ref}</span></Td>
                  <Td><span className="font-medium">{b.buyerName}</span></Td>
                  <Td><span className="font-mono text-xs">{b.batch || '—'}</span></Td>
                  <Td>{b.major || '—'}</Td>
                  <Td>{tableLabel(b)}</Td>
                  <Td right><span className="font-mono">{fmtBaht(b.finalAmount)}</span></Td>
                  <Td><span className="font-mono text-xs text-muted">{fmtDateTime(b.createdAt)}</span></Td>
                  <Td center>
                    {b.slipPath ? (
                      <a
                        href={`/api/backoffice/slip?id=${b.id}`}
                        title="ดาวน์โหลดสลิป"
                        className="inline-flex p-1.5 rounded-lg text-muted hover:text-primary transition-colors cursor-pointer"
                      >
                        <Download className="w-4 h-4" />
                      </a>
                    ) : (
                      <span className="text-subtle">—</span>
                    )}
                  </Td>
                  <Td center>
                    <button
                      onClick={() => setDetail(b)}
                      title="ดูข้อมูลที่กรอก"
                      className="inline-flex p-1.5 rounded-lg text-muted hover:text-primary transition-colors cursor-pointer"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </Td>
                  <Td center>
                    <input
                      type="checkbox"
                      checked={!!b.emailSentAt}
                      onChange={(e) => setSent.mutate({ id: b.id, sent: e.target.checked })}
                      title={b.emailSentAt ? `ส่งเมื่อ ${fmtDateTime(b.emailSentAt)}` : 'ยังไม่ได้ส่ง'}
                      className="w-4 h-4 accent-[#141414] cursor-pointer align-middle"
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div
          onClick={(e) => e.target === e.currentTarget && setDetail(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-primary/40 backdrop-blur-sm animate-fade-in cursor-pointer"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md bg-surface rounded-lg card-shadow overflow-hidden text-primary cursor-default"
          >
            <div className="p-4 sm:p-5 hairline-b flex items-center justify-between">
              <div>
                <h3 className="text-base sm:text-lg font-semibold text-primary">ข้อมูลที่ผู้จองกรอก</h3>
                <p className="text-xs text-muted font-mono">{detail.ref}</p>
              </div>
              <button
                onClick={() => setDetail(null)}
                aria-label="ปิด"
                className="p-2 text-muted hover:text-primary transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5">
              <dl className="w-full text-sm space-y-2">
                <Row label="ชื่อ-นามสกุล" value={detail.buyerName} />
                <Row label="รุ่น" value={detail.batch ?? '—'} mono />
                <Row label="สาขา" value={detail.major ?? '—'} />
                <Row label="เบอร์โทร" value={detail.phone} mono />
                <Row label="อีเมล" value={detail.email} />
                <Row label="ประเภท" value={TYPE_TH[detail.bookingType] ?? detail.bookingType} />
                <Row label="โต๊ะ" value={tableLabel(detail)} />
                <Row label="โซน" value={detail.zone ? ZONE_TH[detail.zone] ?? detail.zone : '—'} />
                <Row label="ยอดที่ชำระ" value={fmtBaht(detail.finalAmount)} mono />
                <Row label="วันที่จอง" value={fmtDateTime(detail.createdAt)} mono />
                <Row label="transRef" value={detail.transRef ?? '— (บันทึกโดยผู้ดูแล)'} mono />
                <Row
                  label="ส่งอีเมลแล้ว"
                  value={detail.emailSentAt ? fmtDateTime(detail.emailSentAt) : 'ยังไม่ได้ส่ง'}
                  mono
                />
              </dl>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({ children, right, center }: { children: React.ReactNode; right?: boolean; center?: boolean }) {
  return (
    <th
      className={`py-2.5 px-3 text-xs font-semibold text-muted whitespace-nowrap ${
        right ? 'text-right' : center ? 'text-center' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, right, center }: { children: React.ReactNode; right?: boolean; center?: boolean }) {
  return (
    <td
      className={`py-3 px-3 text-primary align-middle whitespace-nowrap ${
        right ? 'text-right' : center ? 'text-center' : 'text-left'
      }`}
    >
      {children}
    </td>
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

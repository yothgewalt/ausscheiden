import React, { useState } from 'react';
import { useBooking } from '../context/BookingContext';
import { Table } from '../types';
import { Info } from 'lucide-react';

interface SeatMapProps {
  onSelectTable: (table: Table) => void;
}

export const SeatMap: React.FC<SeatMapProps> = ({ onSelectTable }) => {
  const {
    tables,
    activeZoneFilter,
    activeLockBooking,
    remoteLocks,
    locksReady,
  } = useBooking();

  // Memoized filtered tables
  const filteredTables = React.useMemo(() => {
    return tables.filter(
      (table) => activeZoneFilter === 'all' || table.zone === activeZoneFilter
    );
  }, [tables, activeZoneFilter]);

  // Grid layout: 10×8 = 80 slots. Slot 4 = the fixed โต๊ะอาจารย์ bar (row-span-2),
  // slot 14 = its span placeholder. Every other slot takes a table in ascending
  // tableNumber order so 1–70 fill contiguously around the bar; extras stay blank.
  const layout = React.useMemo<(Table | 'bar' | 'barspan' | null)[]>(() => {
    const ordered = [...tables].sort((a, b) => a.tableNumber - b.tableNumber);
    const cells: (Table | 'bar' | 'barspan' | null)[] = [];
    let ti = 0;
    for (let i = 0; i < 80; i++) {
      if (i === 4) { cells.push('bar'); continue; }
      if (i === 14) { cells.push('barspan'); continue; }
      cells.push(ordered[ti] ?? null);
      ti++;
    }
    return cells;
  }, [tables]);

  // Calculate table seat counts
  const getTableStats = (table: Table) => {
    const total = table.capacity;
    const booked = table.seats.filter((s) => s.status === 'booked').length;
    const held = table.seats.filter((s) => s.status === 'held').length;
    const available = total - booked - held;
    return { total, booked, held, available };
  };

  return (
    <section id="seat-map" className="text-primary">
      <div className="max-w-3xl mx-auto">

        {/* Status legend — availability coding IS information here (ponytail: the intentional
            exception to "amber = one meaning", same rationale luma spends amber on "approval"). */}
        <div className="flex items-center gap-4 flex-wrap justify-center mb-4 text-xs text-muted font-medium">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-surface border border-[rgba(20,20,20,0.16)]"></span>
            <span>ว่าง</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-accent"></span>
            <span>รอชำระ/บางส่วน</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-primary/12"></span>
            <span>เต็มแล้ว</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-primary"></span>
            <span>กำลังเลือก</span>
          </div>
        </div>

        {/* Floor Plan */}
        <div className="rounded-2xl bg-surface hairline p-4 sm:p-6">

          {/* Wait for the first tables.list so the grid paints with lock colors
              instead of flashing all-available, then flipping. */}
          {!locksReady ? (
            <div className="text-center py-16 text-muted">
              <Info className="w-8 h-8 text-subtle mx-auto mb-2 animate-pulse" />
              <p>กำลังโหลดผังที่นั่ง…</p>
            </div>
          ) : (
          <>
          {/* Stage Banner (เวที) */}
          <div className="w-full max-w-md mx-auto h-9 bg-page hairline rounded-lg flex items-center justify-center text-primary font-semibold text-sm tracking-widest mb-6 select-none">
            เวที
          </div>

          {/* Layout: table grid + beverage counter */}
          <div className="flex items-stretch gap-3">

            {/* Tables Grid (10 cols x 8 rows; tables 1-70 fill around the fixed faculty bar) */}
            <div
              className="flex-1 gap-x-1.5 gap-y-2 items-center justify-items-center"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(10, minmax(0, 1fr))' }}
            >
              {layout.map((cell, i) => {
                  // Fixed Faculty Bar (col 5, spans rows 0-1) — decorative, not a table.
                  if (cell === 'bar') {
                    return (
                      <div
                        key="teacher-zone-bar"
                        className="row-span-2 col-start-5 row-start-1 bg-page hairline text-muted font-semibold rounded-md flex items-center justify-center p-1 text-center text-xs tracking-widest select-none w-full h-full min-h-19 [writing-mode:vertical-rl] z-10"
                      >
                        โต๊ะอาจารย์
                      </div>
                    );
                  }
                  if (cell === 'barspan') {
                    return null; // covered by row-span-2
                  }
                  if (cell === null) {
                    return <div key={`empty-${i}`} className="w-9 h-9" />;
                  }

                  const table = cell;

                  // Reserve tables (59/60) back the individual-ticket pool — shown in place,
                  // dimmed and non-clickable, labeled "สำรอง". No onClick → can't be picked.
                  if (table.isReserve) {
                    return (
                      <div key={table.id} className="group flex flex-col items-center gap-1 select-none">
                        <div
                          className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-surface border border-[rgba(20,20,20,0.16)] opacity-40 flex items-center justify-center"
                          title={`${table.name} — สำรองสำหรับบัตรเดี่ยว`}
                        >
                          <span className="text-xs sm:text-sm text-subtle">{table.tableNumber}</span>
                        </div>
                        <span className="text-[9px] font-medium text-subtle px-1.5 py-0.5">สำรอง</span>
                      </div>
                    );
                  }

                  const stats = getTableStats(table);
                  // Effective server status (booked/closed/selecting/pending_payment) for
                  // other clients; booked/closed also apply to me. Local mock seats never
                  // carry booked, so a DB-confirmed table only reads full via this.
                  const remotePhase = remoteLocks[table.id];
                  const isFull = stats.available === 0 || remotePhase === 'booked';
                  const isPartial = stats.booked > 0 || stats.held > 0;
                  const isMyLockedTable = activeLockBooking?.tableId === table.id;
                  const isFilterMatched = filteredTables.some((ft) => ft.id === table.id);
                  // Anything booked/closed or held by a remote client is off-limits.
                  const isLocked = isFull || remotePhase != null;

                  // Status is the only color. Neutral base; zone identity comes from the filter.
                  let chipStyle = 'bg-surface border border-[rgba(20,20,20,0.16)]';
                  let numColor = 'text-primary font-semibold';
                  let pillText: string | null = null;
                  let pillStyle = '';

                  if (!isFilterMatched) {
                    chipStyle = 'bg-surface border border-[rgba(20,20,20,0.16)] opacity-25 pointer-events-none';
                    numColor = 'text-subtle';
                  } else if (isMyLockedTable) {
                    chipStyle = 'bg-primary ring-2 ring-primary';
                    numColor = 'text-white font-bold';
                    pillText = 'กำลังเลือก';
                    pillStyle = 'bg-primary text-white';
                  } else if (remotePhase === 'selecting') {
                    // Someone else is on the seat map with this table — black.
                    chipStyle = 'bg-[#141414]';
                    numColor = 'text-white font-semibold';
                    pillText = 'ผู้อื่นกำลังเลือก';
                    pillStyle = 'bg-[#141414] text-white';
                  } else if (remotePhase === 'pending_payment') {
                    // Someone else is paying — yellow (accent), clears within seconds/minutes.
                    chipStyle = 'bg-accent';
                    numColor = 'text-white font-semibold';
                    pillText = 'รอชำระเงิน';
                    pillStyle = 'bg-accent text-white';
                  } else if (isFull) {
                    chipStyle = 'bg-[#141414]/[0.04]';
                    numColor = 'text-subtle font-medium';
                    pillText = 'เต็ม';
                    pillStyle = 'bg-[#141414]/[0.04] text-subtle';
                  } else if (isPartial) {
                    chipStyle = 'bg-accent/10';
                    numColor = 'text-accent font-semibold';
                    pillText = `${stats.available}`;
                    pillStyle = 'bg-accent/10 text-accent';
                  }

                  return (
                    <div
                      key={table.id}
                      onClick={() => isFilterMatched && !isLocked && onSelectTable(table)}
                      className={`group flex flex-col items-center gap-1 select-none ${
                        isFilterMatched && !isLocked ? 'cursor-pointer' : ''
                      }`}
                    >
                      <div
                        className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full ${chipStyle} flex items-center justify-center transition-transform group-hover:scale-105`}
                        title={`${table.name} (${table.zoneLabelTh}) — ${stats.available}/${table.capacity} ที่นั่งว่าง`}
                      >
                        <span className={`text-xs sm:text-sm ${numColor}`}>
                          {table.tableNumber}
                        </span>
                      </div>
                      {/* pill only for non-available states; available shows number alone */}
                      {isFilterMatched && pillText && (
                        <span
                          className={`${pillStyle} text-[9px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap leading-none`}
                        >
                          {pillText}
                        </span>
                      )}
                    </div>
                  );
              })}
            </div>

            {/* Beverage Counter (จำหน่ายเครื่องดื่ม) on far right */}
            <div className="w-9 bg-page hairline rounded-lg flex items-center justify-center py-3 text-primary font-semibold text-xs tracking-widest select-none text-center [writing-mode:vertical-rl] min-h-55">
              จำหน่ายเครื่องดื่ม
            </div>

          </div>

          {filteredTables.length === 0 && (
            <div className="text-center py-8 text-muted">
              <Info className="w-8 h-8 text-subtle mx-auto mb-2" />
              <p>ไม่พบโต๊ะตามเงื่อนไขที่ค้นหา</p>
            </div>
          )}
          </>
          )}

        </div>

      </div>
    </section>
  );
};

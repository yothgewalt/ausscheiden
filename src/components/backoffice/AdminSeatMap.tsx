'use client';

import React from 'react';
import { generateInitialTables } from '../../data/mockData';

/** One row of `tables.list` — the server's effective status for a table. */
export interface AdminTable {
  id: string;
  zone: string;
  status: 'available' | 'booked' | 'selecting' | 'pending_payment' | 'closed';
}

interface AdminSeatMapProps {
  tables: AdminTable[];
  /** Buyer name per tableId, for the tooltip. Bookings only, no live locks. */
  buyerByTable: Record<string, string>;
  onSelectTable: (tableId: string) => void;
}

// Display metadata (number, name, price, zone label) is not in tables.list — it
// comes from the same generator that seeds Postgres, so the two cannot drift.
const META = generateInitialTables();
const metaById = new Map(META.map((t) => [t.id, t]));

/**
 * Read-only floor plan for the organisers.
 *
 * Deliberately NOT a reuse of components/SeatMap.tsx. That component pulls five
 * values off BookingContext, and mounting BookingProvider here would be unsafe:
 * its mount effect treats any pending_payment lock it doesn't recognise as
 * orphaned and releases it, so an admin tab open next to a buyer's payment tab
 * would free the table out from under someone who is paying. The admin view also
 * wants the opposite semantics — every lock including this browser's, a rendered
 * `closed` state, and clicks on taken tables rather than free ones.
 */
export function AdminSeatMap({ tables, buyerByTable, onSelectTable }: AdminSeatMapProps) {
  const statusById = React.useMemo(
    () => new Map(tables.map((t) => [t.id, t.status])),
    [tables]
  );

  // 10×8 = 80 slots. Slot 4 is the fixed โต๊ะอาจารย์ bar (row-span-2), slot 14 its
  // placeholder; the rest fill in ascending table number. Same layout the buyers
  // see, so a number an organiser reads out over the phone matches the room.
  const layout = React.useMemo(() => {
    const ordered = [...META].sort((a, b) => a.tableNumber - b.tableNumber);
    const cells: (typeof META[number] | 'bar' | 'barspan' | null)[] = [];
    let ti = 0;
    for (let i = 0; i < 80; i++) {
      if (i === 4) { cells.push('bar'); continue; }
      if (i === 14) { cells.push('barspan'); continue; }
      cells.push(ordered[ti] ?? null);
      ti++;
    }
    return cells;
  }, []);

  return (
    <>
      <div className="w-full max-w-md mx-auto h-9 bg-page hairline rounded-lg flex items-center justify-center text-primary font-semibold text-sm tracking-widest mb-6 select-none">
        เวที
      </div>

      <div className="flex items-stretch gap-3">
        <div
          className="flex-1 gap-x-1.5 gap-y-2 items-center justify-items-center"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(10, minmax(0, 1fr))' }}
        >
          {layout.map((cell, i) => {
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
            if (cell === 'barspan') return null;
            if (cell === null) return <div key={`empty-${i}`} className="w-9 h-9" />;

            const table = cell;
            const status = statusById.get(table.id) ?? 'available';
            const buyer = buyerByTable[table.id];

            let chipStyle = 'bg-surface border border-[rgba(20,20,20,0.16)]';
            let numColor = 'text-primary font-semibold';
            let pillText: string | null = null;
            let pillStyle = '';

            if (status === 'booked') {
              chipStyle = 'bg-primary';
              numColor = 'text-white font-bold';
              pillText = 'จองแล้ว';
              pillStyle = 'bg-primary text-white';
            } else if (status === 'closed') {
              // Tables 59/60 back the 16-seat individual pool — never sold as tables.
              chipStyle = 'bg-surface border border-[rgba(20,20,20,0.16)] opacity-40';
              numColor = 'text-subtle';
              pillText = 'สำรอง';
              pillStyle = 'text-subtle';
            } else if (status === 'selecting') {
              chipStyle = 'bg-[#141414]/[0.04]';
              numColor = 'text-primary font-semibold';
              pillText = 'กำลังเลือก';
              pillStyle = 'bg-[#141414]/[0.04] text-muted';
            } else if (status === 'pending_payment') {
              // The one accent meaning in the whole app: money in flight.
              chipStyle = 'bg-accent';
              numColor = 'text-white font-semibold';
              pillText = 'รอชำระเงิน';
              pillStyle = 'bg-accent text-white';
            }

            const title = buyer
              ? `${table.name} — ${buyer}`
              : `${table.name} (${table.zoneLabelTh})`;

            return (
              <div
                key={table.id}
                onClick={() => onSelectTable(table.id)}
                className="group flex flex-col items-center gap-1 select-none cursor-pointer"
              >
                <div
                  className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full ${chipStyle} flex items-center justify-center transition-transform group-hover:scale-105`}
                  title={title}
                >
                  <span className={`text-xs sm:text-sm ${numColor}`}>{table.tableNumber}</span>
                </div>
                {pillText && (
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

        <div className="w-9 bg-page hairline rounded-lg flex items-center justify-center py-3 text-primary font-semibold text-xs tracking-widest select-none text-center [writing-mode:vertical-rl] min-h-55">
          จำหน่ายเครื่องดื่ม
        </div>
      </div>
    </>
  );
}

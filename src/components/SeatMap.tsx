import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useBooking } from '../context/BookingContext';
import { Table } from '../types';
import { Info, Minus, Plus, Maximize } from 'lucide-react';
import { clampScale, clampTranslate, MAX_SCALE } from './seatMapZoom';

interface SeatMapProps {
  onSelectTable: (table: Table) => void;
}

// Intrinsic (unscaled) width the board is laid out at inside the zoom canvas.
// Wide enough that the 10-col grid + drinks counter never crush the chips.
const BOARD_W = 680;
const OPEN_ZOOM = 2.2; // default zoom on open, relative to fit-to-width (pct display = scale/fit)

// ── The floor plan itself: stage + 10-col table grid + drinks counter. ────────
// Identical markup on desktop and inside the mobile zoom canvas; pulled out so
// the canvas can transform it as one unit.
const MapBoard: React.FC<SeatMapProps> = ({ onSelectTable }) => {
  const { tables, activeZoneFilter, activeLockBooking, remoteLocks } = useBooking();

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

  const getTableStats = (table: Table) => {
    const total = table.capacity;
    const booked = table.seats.filter((s) => s.status === 'booked').length;
    const held = table.seats.filter((s) => s.status === 'held').length;
    const available = total - booked - held;
    return { total, booked, held, available };
  };

  return (
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
    </>
  );
};

// ── Touch-only pinch-zoom + drag-pan canvas wrapping the board. ───────────────
// Native Pointer Events; no gesture library. Fit-to-width on open, pinch into
// your area for big tap targets, drag to pan. A drag never selects a table.
const MobileZoomCanvas: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const [fit, setFit] = useState(1);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const reduced = useRef(false);

  // Live gesture bookkeeping (refs → no re-render churn on every move).
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const start = useRef({ scale: 1, tx: 0, ty: 0, dist: 0, midX: 0, midY: 0, px: 0, py: 0, moved: false });
  const justPanned = useRef(false);
  const contentSize = useRef({ w: BOARD_W, h: BOARD_W });
  const lastTap = useRef({ t: 0, x: 0, y: 0 });

  // Mirror the transform state so recompute() (captured once in the mount effect
  // and in the ResizeObserver) always reads live values, not a stale closure.
  const live = useRef({ scale: 1, tx: 0, ty: 0 });
  live.current = { scale, tx, ty };
  const lastVw = useRef(-1);

  // Fit-to-width. keepScale=false → fit + reset (open/reset); true → preserve zoom
  // across an actual viewport resize (orientation change).
  const recompute = useCallback((keepScale: boolean) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const vw = vp.clientWidth;
    const vh = vp.clientHeight;
    lastVw.current = vw;
    const ch = contentRef.current?.offsetHeight ?? BOARD_W; // unscaled (transform doesn't affect layout box)
    contentSize.current = { w: BOARD_W, h: ch };
    const nextFit = clampScale(vw / BOARD_W, vw / BOARD_W);
    setFit(nextFit);
    // Open at OPEN_ZOOM×fit (clamped to MAX); a live resize keeps the current zoom.
    const s = keepScale ? clampScale(live.current.scale, nextFit) : clampScale(nextFit * OPEN_ZOOM, nextFit);
    setScale(s);
    const c = clampTranslate(
      keepScale ? live.current.tx : 0,
      keepScale ? live.current.ty : 0,
      s, { w: vw, h: vh }, contentSize.current,
    );
    setTx(c.x);
    setTy(c.y);
  }, []);

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    recompute(false);
    const vp = viewportRef.current;
    if (!vp || typeof ResizeObserver === 'undefined') return;
    // RO fires once synchronously on observe(); skip it (and any no-op) so it can't
    // clobber the fit we just set — only real width changes recompute.
    const ro = new ResizeObserver(() => {
      if (viewportRef.current && viewportRef.current.clientWidth !== lastVw.current) {
        recompute(true);
      }
    });
    ro.observe(vp);
    return () => ro.disconnect();
  }, [recompute]);

  const vpRect = () => viewportRef.current?.getBoundingClientRect();

  const applyZoom = (nextScaleRaw: number, focalX: number, focalY: number) => {
    const rect = vpRect();
    if (!rect) return;
    const s2 = clampScale(nextScaleRaw, fit);
    // Keep the focal point (viewport-relative) stationary while scaling.
    const fx = (focalX - rect.left - tx) / scale;
    const fy = (focalY - rect.top - ty) / scale;
    const nx = focalX - rect.left - fx * s2;
    const ny = focalY - rect.top - fy * s2;
    const c = clampTranslate(nx, ny, s2, { w: rect.width, h: rect.height }, contentSize.current);
    setScale(s2);
    setTx(c.x);
    setTy(c.y);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setActiveCount(pointers.current.size);
    beginGesture();
  };

  // Snapshot gesture start from whatever pointers are currently down.
  const beginGesture = () => {
    const pts = [...pointers.current.values()];
    start.current.scale = scale;
    start.current.tx = tx;
    start.current.ty = ty;
    start.current.moved = false;
    if (pts.length >= 2) {
      const [a, b] = pts;
      start.current.dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      start.current.midX = (a.x + b.x) / 2;
      start.current.midY = (a.y + b.y) / 2;
    } else if (pts.length === 1) {
      start.current.px = pts[0].x;
      start.current.py = pts[0].y;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];

    if (pts.length >= 2) {
      e.preventDefault();
      const [a, b] = pts;
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      applyZoom(start.current.scale * (dist / start.current.dist), midX, midY);
      start.current.moved = true;
    } else if (pts.length === 1) {
      const dx = e.clientX - start.current.px;
      const dy = e.clientY - start.current.py;
      if (!start.current.moved && Math.hypot(dx, dy) < 8) return; // still a tap
      start.current.moved = true;
      const rect = vpRect();
      if (!rect) return;
      const c = clampTranslate(
        start.current.tx + dx,
        start.current.ty + dy,
        scale,
        { w: rect.width, h: rect.height },
        contentSize.current,
      );
      setTx(c.x);
      setTy(c.y);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const wasSingle = pointers.current.size === 1;
    pointers.current.delete(e.pointerId);
    setActiveCount(pointers.current.size);
    // A pan/pinch just happened → swallow the click so it can't select a table.
    if (start.current.moved) justPanned.current = true;

    if (pointers.current.size >= 1) {
      // Fingers still down (e.g. 2→1): re-anchor so the remaining finger doesn't jump.
      beginGesture();
      return;
    }

    // All up. Double-tap toggles fit ↔ 2× when it wasn't a drag.
    if (wasSingle && !start.current.moved) {
      const now = e.timeStamp;
      const near = Math.hypot(e.clientX - lastTap.current.x, e.clientY - lastTap.current.y) < 24;
      if (now - lastTap.current.t < 300 && near) {
        const target = scale > fit + 0.05 ? fit : Math.min(2, MAX_SCALE);
        applyZoom(target, e.clientX, e.clientY);
        justPanned.current = true; // this tap was consumed by the zoom toggle
        lastTap.current = { t: 0, x: 0, y: 0 };
      } else {
        lastTap.current = { t: now, x: e.clientX, y: e.clientY };
      }
    }
  };

  // Capture phase: kill the click that ends a drag before it reaches a chip.
  const onClickCapture = (e: React.MouseEvent) => {
    if (justPanned.current) {
      e.stopPropagation();
      e.preventDefault();
      justPanned.current = false;
    }
  };

  const zoomByButton = (factor: number) => {
    const rect = vpRect();
    if (!rect) return;
    applyZoom(scale * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };
  const resetView = () => recompute(false);

  const gesturing = activeCount > 0;
  const pct = Math.round((scale / fit) * 100);

  return (
    <div className="relative">
      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
        className="relative w-full h-[55vh] overflow-hidden rounded-xl bg-page/40"
        style={{ touchAction: 'none' }}
      >
        <div
          ref={contentRef}
          style={{
            width: BOARD_W,
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transformOrigin: '0 0',
            transition: gesturing || reduced.current ? 'none' : 'transform 0.2s cubic-bezier(0.4,0,0.2,1)',
          }}
        >
          {children}
        </div>
      </div>

      {/* Zoom controls — neutral tokens, no accent (design directive). */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-surface hairline p-1 shadow-sm select-none">
        <button
          onClick={() => zoomByButton(1 / 1.3)}
          aria-label="ซูมออก"
          className="w-8 h-8 flex items-center justify-center rounded-full text-primary hover:bg-page transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default"
          disabled={pct <= 100}
        >
          <Minus className="w-4 h-4" />
        </button>
        <span className="min-w-11 text-center text-xs font-medium text-muted tabular-nums">{pct}%</span>
        <button
          onClick={() => zoomByButton(1.3)}
          aria-label="ซูมเข้า"
          className="w-8 h-8 flex items-center justify-center rounded-full text-primary hover:bg-page transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default"
          disabled={scale >= MAX_SCALE - 0.01}
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          onClick={resetView}
          aria-label="รีเซ็ตมุมมอง"
          className="w-8 h-8 flex items-center justify-center rounded-full text-primary hover:bg-page transition-colors cursor-pointer"
        >
          <Maximize className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export const SeatMap: React.FC<SeatMapProps> = ({ onSelectTable }) => {
  const { tables, activeZoneFilter, locksReady } = useBooking();

  const filteredCount = React.useMemo(
    () => tables.filter((t) => activeZoneFilter === 'all' || t.zone === activeZoneFilter).length,
    [tables, activeZoneFilter],
  );

  // Touch devices get the pinch-zoom canvas; mouse/trackpad get the board as-is.
  const [isCoarse, setIsCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    setIsCoarse(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsCoarse(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

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

        {/* Touch hint — only where gestures apply. */}
        {isCoarse && locksReady && (
          <p className="text-center text-xs text-subtle mb-3 select-none">
            บีบนิ้วเพื่อซูม • ลากเพื่อเลื่อน • แตะโต๊ะเพื่อเลือก
          </p>
        )}

        {/* Floor Plan */}
        <div className="rounded-2xl bg-surface hairline p-4 sm:p-6">

          {/* Wait for the first tables.list so the grid paints with lock colors
              instead of flashing all-available, then flipping. */}
          {!locksReady ? (
            <div className="text-center py-16 text-muted">
              <Info className="w-8 h-8 text-subtle mx-auto mb-2 animate-pulse" />
              <p>กำลังโหลดผังที่นั่ง…</p>
            </div>
          ) : isCoarse ? (
            <MobileZoomCanvas>
              <MapBoard onSelectTable={onSelectTable} />
            </MobileZoomCanvas>
          ) : (
            <MapBoard onSelectTable={onSelectTable} />
          )}

          {locksReady && filteredCount === 0 && (
            <div className="text-center py-8 text-muted">
              <Info className="w-8 h-8 text-subtle mx-auto mb-2" />
              <p>ไม่พบโต๊ะตามเงื่อนไขที่ค้นหา</p>
            </div>
          )}

        </div>

      </div>
    </section>
  );
};

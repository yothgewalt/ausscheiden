'use client';

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import {
  Booking,
  EventDetails,
  Language,
  Seat,
  Table,
  UserRole,
  ZoneType,
  AdminStats,
} from '../types';
import { generateInitialTables, initialEventDetails, sampleBookings, INDIVIDUAL_PRICE } from '../data/mockData';
import { trpc } from '../lib/trpc';

// Effective server-side status for a table, as seen by OTHER clients. Named for
// its origin (the lock channel) but also carries persisted booked/closed so the
// seat map reflects confirmed bookings, not just live locks.
type RemoteStatus = 'selecting' | 'pending_payment' | 'booked' | 'closed';
const TABLE_ID_RE = /^T\d{2}$/;

// Session cookie is set (non-HttpOnly) by the tRPC HTTP handler — see
// src/server/trpc/context.ts SESSION_COOKIE. Read it to tell my own locks from others'.
function getMySid(): string | null {
  if (typeof document === 'undefined') return null;
  return document.cookie.match(/(?:^|;\s*)ausscheiden_sid=([^;]+)/)?.[1] ?? null;
}

interface BookingContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  userRole: UserRole;
  setUserRole: (role: UserRole) => void;
  eventDetails: EventDetails;
  
  // Tables & Seat Map
  tables: Table[];
  selectedTable: Table | null;
  setSelectedTable: (table: Table | null) => void;
  selectedSeats: Seat[];
  toggleSeatSelection: (seat: Seat) => void;
  selectWholeTable: (table: Table) => Promise<boolean>;
  clearSeatSelection: () => void;
  // Free a pre-submit 'selecting' lock when the user backs out / closes the map
  // before the form promotes it. No-op once a booking is active.
  releaseSelection: () => void;

  // Effective server status for tables held/taken by OTHER clients (tableId ->
  // status). Fed by the tRPC onLockChange subscription + initial tables.list.
  // My own live lock is excluded; booked/closed apply to everyone.
  remoteLocks: Record<string, RemoteStatus>;
  // Per-zone availability for the registration badge (zone -> counts).
  zoneAvailability: Record<string, { total: number; available: number }>;
  // False until the first tables.list resolves; gates the seat map's first paint.
  locksReady: boolean;
  // Set when selectWholeTable loses the race for a table; null once cleared.
  lockError: string | null;
  
  // Active Seat Lock & Flow
  activeLockBooking: Booking | null;
  lockTimerSeconds: number;
  startSeatLock: (buyerData: {
    buyerName: string;
    department: string;
    major: string;
    batch: string;
    phone: string;
    email: string;
    lineId?: string;
    guestNames?: Record<string, string>;
  }) => Booking;
  startIndividualLock: (buyerData: {
    buyerName: string;
    department: string;
    major: string;
    batch: string;
    phone: string;
    email: string;
    lineId?: string;
  }) => Booking;
  cancelSeatLock: () => void;
  
  // Slip Verification & Payment
  uploadSlipAndVerify: (
    bookingId: string,
    slipImage: string
  ) => Promise<Booking>;
  
  // Bookings list & Tickets
  bookings: Booking[];
  activeTicketBooking: Booking | null;
  setActiveTicketBooking: (booking: Booking | null) => void;
  getBookingById: (id: string) => Booking | undefined;
  
  // Admin & Staff Actions
  adminStats: AdminStats;
  updateTableStatus: (tableId: string, status: 'available' | 'booked' | 'closed') => void;
  updateTablePrice: (tableId: string, pricePerTable: number) => void;
  addTable: (zone: ZoneType, price: number) => void;
  deleteTable: (tableId: string) => void;
  adminApproveSlip: (bookingId: string) => void;
  adminRejectSlip: (bookingId: string, reason: string) => void;
  processCheckIn: (bookingIdOrQr: string, staffName: string) => { success: boolean; message: string; booking?: Booking };
  
  // Filter states
  activeZoneFilter: ZoneType | 'all';
  setActiveZoneFilter: (zone: ZoneType | 'all') => void;
}

const BookingContext = createContext<BookingContextType | undefined>(undefined);

export const BookingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<Language>('th');
  const [userRole, setUserRole] = useState<UserRole>('guest');
  const [eventDetails] = useState<EventDetails>(initialEventDetails);
  
  const [tables, setTables] = useState<Table[]>(() => generateInitialTables());
  const [bookings, setBookings] = useState<Booking[]>(sampleBookings);
  
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [selectedSeats, setSelectedSeats] = useState<Seat[]>([]);
  
  const [activeLockBooking, setActiveLockBooking] = useState<Booking | null>(null);
  const [lockTimerSeconds, setLockTimerSeconds] = useState<number>(0);
  const [activeTicketBooking, setActiveTicketBooking] = useState<Booking | null>(null);
  
  const [activeZoneFilter, setActiveZoneFilter] = useState<ZoneType | 'all'>('all');

  // ── Real-time backend wiring (tRPC + Redis locks) ──────────────────────────
  const [remoteLocks, setRemoteLocks] = useState<Record<string, RemoteStatus>>({});
  const [lockError, setLockError] = useState<string | null>(null);
  // False until the first tables.list resolves — gates the seat map's first paint
  // so it shows lock colors instead of flashing all-available.
  const [locksReady, setLocksReady] = useState(false);
  const mySidRef = useRef<string | null>(null);
  const reconciledRef = useRef(false);
  const utils = trpc.useUtils();

  const listQuery = trpc.tables.list.useQuery(undefined, { refetchOnWindowFocus: false });
  const zoneQuery = trpc.tables.zoneAvailability.useQuery(undefined, { refetchOnWindowFocus: false });

  const acquireLock = trpc.tables.acquireLock.useMutation();
  const promoteToPayment = trpc.tables.promoteToPayment.useMutation();
  const releaseLock = trpc.tables.releaseLock.useMutation();
  const confirmBooking = trpc.tables.confirmBooking.useMutation();
  const verifySlip = trpc.slips.verify.useMutation();

  // Seed remote status from the initial list (server tags lockedByMe via session cookie).
  useEffect(() => {
    if (!listQuery.data) return;
    const next: Record<string, RemoteStatus> = {};
    for (const t of listQuery.data) {
      // Live locks are hidden for my own session (I'm the one selecting/paying);
      // booked/closed are persisted facts that apply to everyone, me included.
      if (t.status === 'selecting' || t.status === 'pending_payment') {
        if (!t.lockedByMe) next[t.id] = t.status;
      } else if (t.status === 'booked' || t.status === 'closed') {
        next[t.id] = t.status;
      }
    }
    setRemoteLocks(next);
    setLocksReady(true);

    // Once per mount: a fresh load has no activeLockBooking, so any 'selecting'
    // lock the server still attributes to me is an orphan left by a closed tab
    // (close never releases — see cancelSeatLock/releaseSelection). Free it so the
    // table doesn't sit locked for the full TTL and re-clicking can't refresh it.
    // NOT pending_payment: that's a real in-flight payment.
    if (!reconciledRef.current) {
      reconciledRef.current = true;
      for (const t of listQuery.data) {
        if (t.lockedByMe && t.status === 'selecting') {
          releaseLock.mutate({ tableId: t.id });
        }
      }
    }
  }, [listQuery.data]);

  // Keep remote locks live. Events carry sessionId; drop my own so I never grey myself out.
  trpc.tables.onLockChange.useSubscription(undefined, {
    onData(evt) {
      const mySid = (mySidRef.current ??= getMySid());
      setRemoteLocks((prev) => {
        const next = { ...prev };
        if (evt.phase === null || evt.sessionId === mySid) delete next[evt.id];
        else next[evt.id] = evt.phase;
        return next;
      });
      // A confirmed booking releases its lock ({phase:null}) — the delete above would
      // wrongly clear a now-'booked' entry. Refetch the authoritative list so the
      // seeding effect re-applies booked/closed; also shifts zone availability.
      utils.tables.list.invalidate();
      utils.tables.zoneAvailability.invalidate();
    },
  });

  // Lock timer effect - optimized interval loop
  useEffect(() => {
    if (!activeLockBooking) return;

    const interval = setInterval(() => {
      setLockTimerSeconds((prev) => {
        if (prev <= 1) {
          cancelSeatLock();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [activeLockBooking?.id]);

  // Seat selection helpers
  const toggleSeatSelection = (seat: Seat) => {
    if (seat.status !== 'available') return;
    
    setSelectedSeats((prev) => {
      const exists = prev.some((s) => s.id === seat.id);
      if (exists) {
        return prev.filter((s) => s.id !== seat.id);
      } else {
        return [...prev, seat];
      }
    });
  };

  // Claim the table server-side first; only enter the form if the lock is ours.
  // Returns false when another client won the race (caller stays on the map).
  const selectWholeTable = async (table: Table): Promise<boolean> => {
    setLockError(null);
    if (TABLE_ID_RE.test(table.id)) {
      // null = mutation threw (backend unreachable) → fail open, keep the client
      // flow working. A real { ok:false } means another session holds it → block.
      const res = await acquireLock.mutateAsync({ tableId: table.id }).catch(() => null);
      if (res && !res.ok) {
        setLockError('โต๊ะนี้ถูกผู้อื่นเลือกอยู่ กรุณาเลือกโต๊ะอื่น');
        setRemoteLocks((prev) => ({ ...prev, [table.id]: 'selecting' }));
        return false;
      }
    }
    const availableSeats = table.seats.filter((s) => s.status === 'available');
    setSelectedTable(table);
    setSelectedSeats(availableSeats);
    return true;
  };

  const clearSeatSelection = () => {
    setSelectedSeats([]);
  };

  // User picked a table (acquired a 'selecting' lock) but backed out before the
  // form promoted it to pending_payment. Release it so it doesn't sit for the
  // full TTL. Guard: once activeLockBooking exists, cancelSeatLock owns release.
  const releaseSelection = () => {
    if (activeLockBooking) return; // promoted already — not ours to free here
    if (selectedTable && TABLE_ID_RE.test(selectedTable.id)) {
      releaseLock.mutate({ tableId: selectedTable.id });
    }
    setSelectedTable(null);
    setSelectedSeats([]);
    setLockError(null);
  };

  // Start temporary seat lock
  const startSeatLock = (buyerData: {
    buyerName: string;
    department: string;
    major: string;
    batch: string;
    phone: string;
    email: string;
    lineId?: string;
    guestNames?: Record<string, string>;
  }): Booking => {
    if (!selectedTable || selectedSeats.length === 0) {
      throw new Error('No seats selected');
    }

    const isWholeTable = selectedSeats.length === selectedTable.capacity;
    const totalAmount = isWholeTable
      ? selectedTable.pricePerTable
      : selectedSeats.length * selectedTable.pricePerSeat;

    const bookingId = `BK-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    const nowStr = new Date().toLocaleString('sv').replace('T', ' ').substring(0, 16);
    const lockDurationSec = eventDetails.lockTimeoutMinutes * 60;
    const lockExpiresAt = Date.now() + lockDurationSec * 1000;

    const guestList = selectedSeats.map((seat) => ({
      seatId: seat.id,
      seatNumber: seat.seatNumber,
      guestName: buyerData.guestNames?.[seat.id] || buyerData.buyerName,
    }));

    const newBooking: Booking = {
      id: bookingId,
      createdAt: nowStr,
      updatedAt: nowStr,
      buyerName: buyerData.buyerName,
      department: buyerData.department,
      major: buyerData.major,
      batch: buyerData.batch,
      phone: buyerData.phone,
      email: buyerData.email,
      lineId: buyerData.lineId,
      tableId: selectedTable.id,
      tableName: selectedTable.name,
      zone: selectedTable.zone,
      seats: selectedSeats.map((s) => ({ ...s, status: 'held', lockedBy: bookingId })),
      guestList,
      bookingType: isWholeTable ? 'whole_table' : 'individual_seats',
      totalAmount,
      finalAmount: totalAmount,
      lockExpiresAt,
      status: 'pending_payment',
      paymentMethod: 'promptpay',
      qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${bookingId}-${selectedTable.id}-${encodeURIComponent(buyerData.buyerName)}`,
      checkedIn: false,
    };

    // Update table seats status in state
    setTables((prevTables) =>
      prevTables.map((t) => {
        if (t.id === selectedTable.id) {
          const updatedSeats = t.seats.map((seat) => {
            if (selectedSeats.some((s) => s.id === seat.id)) {
              return { ...seat, status: 'held' as const, lockedBy: bookingId };
            }
            return seat;
          });
          return { ...t, seats: updatedSeats, status: 'held' as const };
        }
        return t;
      })
    );

    setActiveLockBooking(newBooking);
    setLockTimerSeconds(lockDurationSec);
    setBookings((prev) => [newBooking, ...prev]);

    // Promote the Redis lock to 'pending_payment' (turns yellow for others).
    // Reconcile the countdown to the server's TTL so both clients agree.
    if (TABLE_ID_RE.test(selectedTable.id)) {
      promoteToPayment
        .mutateAsync({ tableId: selectedTable.id })
        .then((res) => {
          if (res.ok && res.expiresAt) {
            setLockTimerSeconds(Math.max(0, Math.round((res.expiresAt - Date.now()) / 1000)));
          }
        })
        .catch(() => {});
    }

    return newBooking;
  };

  // Table-less individual ticket — no seat-holding side effect, no table fields
  const startIndividualLock = (buyerData: {
    buyerName: string;
    department: string;
    major: string;
    batch: string;
    phone: string;
    email: string;
    lineId?: string;
  }): Booking => {
    const bookingId = `BK-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    const nowStr = new Date().toLocaleString('sv').replace('T', ' ').substring(0, 16);
    const lockDurationSec = eventDetails.lockTimeoutMinutes * 60;
    const lockExpiresAt = Date.now() + lockDurationSec * 1000;

    const newBooking: Booking = {
      id: bookingId,
      createdAt: nowStr,
      updatedAt: nowStr,
      buyerName: buyerData.buyerName,
      department: buyerData.department,
      major: buyerData.major,
      batch: buyerData.batch,
      phone: buyerData.phone,
      email: buyerData.email,
      lineId: buyerData.lineId,
      tableId: undefined,
      tableName: undefined,
      zone: undefined,
      seats: [],
      guestList: [],
      bookingType: 'individual',
      totalAmount: INDIVIDUAL_PRICE,
      finalAmount: INDIVIDUAL_PRICE,
      lockExpiresAt,
      status: 'pending_payment',
      paymentMethod: 'promptpay',
      qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${bookingId}-individual-${encodeURIComponent(buyerData.buyerName)}`,
      checkedIn: false,
    };

    setActiveLockBooking(newBooking);
    setLockTimerSeconds(lockDurationSec);
    setBookings((prev) => [newBooking, ...prev]);

    return newBooking;
  };

  const cancelSeatLock = () => {
    if (!activeLockBooking) return;

    // Release the server-side Redis lock (frees the table for everyone else).
    if (activeLockBooking.tableId && TABLE_ID_RE.test(activeLockBooking.tableId)) {
      releaseLock.mutate({ tableId: activeLockBooking.tableId });
    }

    // Release held seats
    setTables((prevTables) =>
      prevTables.map((t) => {
        if (t.id === activeLockBooking.tableId) {
          const updatedSeats = t.seats.map((seat) => {
            if (seat.lockedBy === activeLockBooking.id) {
              return { ...seat, status: 'available' as const, lockedBy: undefined };
            }
            return seat;
          });

          const bookedSeatsCount = updatedSeats.filter((s) => s.status === 'booked').length;
          const tableStatus = bookedSeatsCount === t.capacity ? 'booked' : bookedSeatsCount > 0 ? 'held' : 'available';

          return { ...t, seats: updatedSeats, status: tableStatus as any };
        }
        return t;
      })
    );

    // Mark booking as expired
    setBookings((prev) =>
      prev.map((b) => (b.id === activeLockBooking.id ? { ...b, status: 'expired' } : b))
    );

    setActiveLockBooking(null);
    setLockTimerSeconds(0);
    clearSeatSelection();
  };

  // Automated Slip Verification Logic (Simulating SlipOK / EasySlip API)
  const uploadSlipAndVerify = async (
    bookingId: string,
    slipImage: string
  ): Promise<Booking> => {
    // Set status to verifying_slip
    setBookings((prev) =>
      prev.map((b) => (b.id === bookingId ? { ...b, status: 'verifying_slip', slipImage } : b))
    );

    const booking = bookings.find((b) => b.id === bookingId) || activeLockBooking;
    if (!booking) throw new Error('Booking not found');

    const res = await verifySlip.mutateAsync({
      slipImage,
      tableId: booking.tableId && TABLE_ID_RE.test(booking.tableId) ? booking.tableId : undefined,
      bookingType: booking.bookingType,
    });

    const isSuccess = res.success;

    const verificationResult = {
      success: isSuccess,
      confidence: isSuccess ? 0.99 : 0.45,
      transactionId: res.transRef,
      transferredAmount: res.amount ?? booking.finalAmount,
      transferredTime: new Date().toLocaleString('sv').replace('T', ' ').substring(0, 16),
      accountMatch: isSuccess,
      failureReason: isSuccess ? '' : res.failureReason,
    };

    const newStatus = isSuccess ? 'confirmed' : 'verifying_slip'; // if failed, kept in verifying queue for admin manual review

    const updatedBooking: Booking = {
      ...booking,
      status: newStatus,
      slipImage,
      slipUploadedAt: new Date().toLocaleString('sv').replace('T', ' ').substring(0, 16),
      slipVerificationResult: verificationResult,
    };

    // Update booking in list
    setBookings((prev) => prev.map((b) => (b.id === bookingId ? updatedBooking : b)));

    if (isSuccess) {
      // Persist the booking server-side: insert the purchase row (UUID PK, ref = BK code),
      // and for table bookings flip Postgres status -> 'booked' + clear the Redis lock.
      // Fires for individual tickets too (no tableId) so every purchase is recorded.
      // Awaited: the server caps individuals at 16 and can reject with sold_out — in that
      // case the local "confirmed" is a lie, so roll it back and surface the error.
      const confirmResult = await confirmBooking.mutateAsync({
        ref: booking.id,
        tableId:
          booking.tableId && TABLE_ID_RE.test(booking.tableId) ? booking.tableId : undefined,
        buyerName: booking.buyerName,
        phone: booking.phone,
        email: booking.email,
        lineId: booking.lineId,
        major: booking.major,
        batch: booking.batch,
        bookingType: booking.bookingType,
      });

      if (!confirmResult.ok) {
        // Individual pool sold out under this buyer — undo the optimistic confirm.
        const rejected: Booking = { ...updatedBooking, status: 'rejected' };
        setBookings((prev) => prev.map((b) => (b.id === bookingId ? rejected : b)));
        utils.tables.zoneAvailability.invalidate();
        throw new Error('บัตรเดี่ยวเต็มแล้ว (จำกัด 16 ที่นั่ง) — ไม่สามารถยืนยันการจองได้');
      }

      // Individual confirms fire no lock event, so the subscription-based invalidation
      // misses them — refresh the remaining-count badge explicitly.
      utils.tables.zoneAvailability.invalidate();

      // Permanently convert seats to booked
      setTables((prevTables) =>
        prevTables.map((t) => {
          if (t.id === booking.tableId) {
            const updatedSeats = t.seats.map((seat) => {
              if (booking.seats.some((bs) => bs.id === seat.id)) {
                return { ...seat, status: 'booked' as const, lockedBy: undefined };
              }
              return seat;
            });
            const bookedCount = updatedSeats.filter((s) => s.status === 'booked').length;
            return {
              ...t,
              seats: updatedSeats,
              status: bookedCount === t.capacity ? 'booked' : 'held',
            };
          }
          return t;
        })
      );

      // Clear lock timer if it was the active lock
      if (activeLockBooking?.id === bookingId) {
        setActiveLockBooking(null);
        setLockTimerSeconds(0);
        clearSeatSelection();
      }

      setActiveTicketBooking(updatedBooking);
    }

    return updatedBooking;
  };

  // Admin Actions
  const updateTableStatus = (tableId: string, newStatus: 'available' | 'booked' | 'closed') => {
    setTables((prev) =>
      prev.map((t) => {
        if (t.id === tableId) {
          const updatedSeats = t.seats.map((s) => ({
            ...s,
            status: newStatus === 'booked' ? 'booked' : newStatus === 'closed' ? 'closed' : 'available',
          }));
          return { ...t, status: newStatus, seats: updatedSeats as any };
        }
        return t;
      })
    );
  };

  const updateTablePrice = (tableId: string, pricePerTable: number) => {
    setTables((prev) =>
      prev.map((t) => (t.id === tableId ? { ...t, pricePerTable, pricePerSeat: Math.round(pricePerTable / 10) } : t))
    );
  };

  const addTable = (zone: ZoneType, price: number) => {
    const nextNum = tables.length + 1;
    const tableId = `T${nextNum.toString().padStart(2, '0')}`;
    const seats = Array.from({ length: 10 }, (_, i) => ({
      id: `${tableId}-S${i + 1}`,
      seatNumber: i + 1,
      status: 'available' as const,
    }));

    const newTable: Table = {
      id: tableId,
      name: `โต๊ะที่ ${nextNum}`,
      tableNumber: nextNum,
      zone,
      zoneLabelTh: zone === 'executive' ? 'โซน VIP' : zone === 'alumni' ? 'โซนศิษย์เก่า' : 'โซนนศ./บุคลากร',
      zoneLabelEn: zone === 'executive' ? 'VIP Zone' : zone === 'alumni' ? 'Alumni Zone' : 'Student Zone',
      pricePerTable: price,
      pricePerSeat: Math.round(price / 10),
      capacity: 10,
      seats,
      x: 10 + (nextNum * 3) % 80,
      y: 20 + (nextNum * 5) % 70,
      status: 'available',
    };

    setTables((prev) => [...prev, newTable]);
  };

  const deleteTable = (tableId: string) => {
    setTables((prev) => prev.filter((t) => t.id !== tableId));
  };

  const adminApproveSlip = (bookingId: string) => {
    const targetBooking = bookings.find((b) => b.id === bookingId);
    if (!targetBooking) return;

    setBookings((prev) =>
      prev.map((b) =>
        b.id === bookingId
          ? {
              ...b,
              status: 'confirmed',
              slipVerificationResult: {
                confidence: b.slipVerificationResult?.confidence ?? 0,
                ...b.slipVerificationResult,
                success: true,
                failureReason: 'อนุมัติโดยแอดมิน (Manual Verification Approved)',
              },
            }
          : b
      )
    );

    // Convert seats to booked
    setTables((prevTables) =>
      prevTables.map((t) => {
        if (t.id === targetBooking.tableId) {
          const updatedSeats = t.seats.map((seat) => {
            if (targetBooking.seats.some((bs) => bs.id === seat.id)) {
              return { ...seat, status: 'booked' as const };
            }
            return seat;
          });
          const bookedCount = updatedSeats.filter((s) => s.status === 'booked').length;
          return { ...t, seats: updatedSeats, status: bookedCount === t.capacity ? 'booked' : 'held' };
        }
        return t;
      })
    );
  };

  const adminRejectSlip = (bookingId: string, reason: string) => {
    const targetBooking = bookings.find((b) => b.id === bookingId);
    if (!targetBooking) return;

    setBookings((prev) =>
      prev.map((b) =>
        b.id === bookingId
          ? {
              ...b,
              status: 'rejected',
              slipVerificationResult: {
                confidence: b.slipVerificationResult?.confidence ?? 0,
                ...b.slipVerificationResult,
                success: false,
                failureReason: reason || 'แอดมินไม่อนุมัติสลิปชำระเงิน',
              },
            }
          : b
      )
    );

    // Release seats
    setTables((prevTables) =>
      prevTables.map((t) => {
        if (t.id === targetBooking.tableId) {
          const updatedSeats = t.seats.map((seat) => {
            if (targetBooking.seats.some((bs) => bs.id === seat.id)) {
              return { ...seat, status: 'available' as const, lockedBy: undefined };
            }
            return seat;
          });
          const bookedCount = updatedSeats.filter((s) => s.status === 'booked').length;
          return { ...t, seats: updatedSeats, status: bookedCount === t.capacity ? 'booked' : 'available' };
        }
        return t;
      })
    );
  };

  // Staff Check-in Scanner Processing
  const processCheckIn = (
    bookingIdOrQr: string,
    staffName: string
  ): { success: boolean; message: string; booking?: Booking } => {
    const cleanId = bookingIdOrQr.trim().toUpperCase();
    const booking = bookings.find(
      (b) => b.id.toUpperCase() === cleanId || cleanId.includes(b.id.toUpperCase())
    );

    if (!booking) {
      return { success: false, message: 'ไม่พบรหัสการจองนี้ในระบบ (Invalid Ticket Code)' };
    }

    if (booking.status !== 'confirmed') {
      return {
        success: false,
        message: `การจองสถานะ "${booking.status}" ยังไม่ได้รับการยืนยันการชำระเงิน`,
        booking,
      };
    }

    if (booking.checkedIn) {
      return {
        success: false,
        message: `ตั๋วนี้ได้รับการเช็คอินไปแล้ว เมื่อ ${booking.checkedInAt} โดย ${booking.checkedInBy}`,
        booking,
      };
    }

    const nowStr = new Date().toLocaleString('sv').replace('T', ' ').substring(0, 16);
    const updated: Booking = {
      ...booking,
      checkedIn: true,
      checkedInAt: nowStr,
      checkedInBy: staffName || 'เจ้าหน้าที่หน้างาน',
    };

    setBookings((prev) => prev.map((b) => (b.id === booking.id ? updated : b)));

    return {
      success: true,
      message: booking.bookingType === 'individual'
        ? `เช็คอินสำเร็จ! ต้อนรับคุณ ${booking.buyerName} (บัตรเดี่ยว 1 ท่าน)`
        : `เช็คอินสำเร็จ! ต้อนรับคุณ ${booking.buyerName} (${booking.tableName} - ${booking.seats.length} ที่นั่ง)`,
      booking: updated,
    };
  };

  const getBookingById = (id: string) => bookings.find((b) => b.id === id);

  // Compute Admin Statistics
  const adminStats: AdminStats = React.useMemo(() => {
    let totalSeats = 0;
    let bookedSeats = 0;
    let availableSeats = 0;
    let totalRevenue = 0;
    let pendingRevenue = 0;

    tables.forEach((t) => {
      totalSeats += t.capacity;
      t.seats.forEach((s) => {
        if (s.status === 'booked') bookedSeats += 1;
        else if (s.status === 'available') availableSeats += 1;
      });
    });

    bookings.forEach((b) => {
      if (b.status === 'confirmed') {
        totalRevenue += b.finalAmount;
      } else if (b.status === 'pending_payment' || b.status === 'verifying_slip') {
        pendingRevenue += b.finalAmount;
      }
    });

    const bookedTables = tables.filter((t) => t.status === 'booked').length;
    const availableTables = tables.filter((t) => t.status === 'available').length;
    const heldTables = tables.filter((t) => t.status === 'held').length;

    const pendingSlipsCount = bookings.filter((b) => b.status === 'verifying_slip').length;
    const checkedInCount = bookings.filter((b) => b.checkedIn).length;

    return {
      totalTables: tables.length,
      bookedTables,
      availableTables,
      heldTables,
      totalSeats,
      bookedSeats,
      availableSeats,
      totalRevenue,
      pendingRevenue,
      pendingSlipsCount,
      checkedInCount,
    };
  }, [tables, bookings]);

  const contextValue = React.useMemo(
    () => ({
      language,
      setLanguage,
      userRole,
      setUserRole,
      eventDetails,
      tables,
      selectedTable,
      setSelectedTable,
      selectedSeats,
      toggleSeatSelection,
      selectWholeTable,
      clearSeatSelection,
      releaseSelection,
      remoteLocks,
      zoneAvailability: zoneQuery.data ?? {},
      locksReady,
      lockError,
      activeLockBooking,
      lockTimerSeconds,
      startSeatLock,
      startIndividualLock,
      cancelSeatLock,
      uploadSlipAndVerify,
      bookings,
      activeTicketBooking,
      setActiveTicketBooking,
      getBookingById,
      adminStats,
      updateTableStatus,
      updateTablePrice,
      addTable,
      deleteTable,
      adminApproveSlip,
      adminRejectSlip,
      processCheckIn,
      activeZoneFilter,
      setActiveZoneFilter,
    }),
    [
      language,
      userRole,
      eventDetails,
      tables,
      selectedTable,
      selectedSeats,
      remoteLocks,
      zoneQuery.data,
      locksReady,
      lockError,
      activeLockBooking,
      lockTimerSeconds,
      bookings,
      activeTicketBooking,
      adminStats,
      activeZoneFilter,
    ]
  );

  return (
    <BookingContext.Provider value={contextValue}>
      {children}
    </BookingContext.Provider>
  );
};

export const useBooking = () => {
  const context = useContext(BookingContext);
  if (!context) {
    throw new Error('useBooking must be used within a BookingProvider');
  }
  return context;
};

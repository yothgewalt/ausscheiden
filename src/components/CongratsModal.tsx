import React from 'react';
import { useBooking } from '../context/BookingContext';
import { CheckCircle2, X } from 'lucide-react';

interface CongratsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Shown after a slip confirms. Reads activeTicketBooking (NOT activeLockBooking — that's
// nulled on confirm, so PaymentModal unmounts and can't show success itself).
export const CongratsModal: React.FC<CongratsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { activeTicketBooking: booking } = useBooking();

  if (!isOpen || !booking) return null;

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#141414]/40 backdrop-blur-sm animate-fade-in cursor-pointer"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md bg-surface rounded-lg card-shadow overflow-hidden text-primary cursor-default"
      >
        <button
          onClick={onClose}
          aria-label="ปิด"
          className="absolute top-4 right-4 p-1.5 text-muted hover:text-primary rounded-lg btn-secondary transition-all cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="p-8 flex flex-col items-center text-center gap-4">
          {/* Emerald = the "confirmed" signal. Amber stays the waiting gate. */}
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle2 className="w-9 h-9 text-emerald-600" />
          </div>

          <div className="space-y-1">
            <h3 className="text-xl font-bold text-primary">ชำระเงินสำเร็จ!</h3>
            <p className="text-sm text-muted leading-relaxed max-w-xs">
              ขอบคุณสำหรับการสำรองที่นั่ง เราได้รับสลิปการชำระเงินของท่านเรียบร้อยแล้ว
            </p>
          </div>

          {/* Read-only summary — whitespace + hairline, not a card (luma taste). */}
          <dl className="w-full text-sm border-t border-[rgba(20,20,20,0.08)] pt-4 space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted shrink-0">รหัสจอง</dt>
              <dd className="font-mono font-semibold text-primary text-right">{booking.id}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted shrink-0">
                {booking.bookingType === 'individual' ? 'ประเภทบัตร' : 'โต๊ะ'}
              </dt>
              <dd className="font-semibold text-primary text-right">
                {booking.tableName ?? 'บัตรเดี่ยว'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted shrink-0">ยอดที่ชำระ</dt>
              <dd className="font-mono font-bold text-primary text-right">
                ฿{booking.finalAmount.toLocaleString()}
              </dd>
            </div>
          </dl>

          <div className="w-full flex flex-col gap-2 pt-2">
            <button
              onClick={onClose}
              className="w-full py-3 px-6 rounded-lg bg-primary hover:bg-primary/90 text-white font-bold text-sm transition-colors cursor-pointer"
            >
              ปิด
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

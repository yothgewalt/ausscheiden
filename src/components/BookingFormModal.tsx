import React, { useState, useRef, useEffect } from 'react';
import { useBooking } from '../context/BookingContext';
import { INDIVIDUAL_PRICE } from '../data/mockData';
import {
  User,
  Building2,
  Phone,
  Mail,
  ArrowRight,
  Clock,
  AlertTriangle,
  ChevronDown,
  Check,
} from 'lucide-react';

const MAJOR_OPTIONS = ['ITT', 'INET', 'IT', 'ITI', 'INE'];

interface BookingFormModalProps {
  onBack: () => void;
  onSuccessProceedToPayment: () => void;
  individual?: boolean;
}

export const BookingFormModal: React.FC<BookingFormModalProps> = ({
  onBack,
  onSuccessProceedToPayment,
  individual = false,
}) => {
  const {
    selectedTable,
    selectedSeats,
    startSeatLock,
    startIndividualLock,
    eventDetails,
  } = useBooking();

  const [buyerName, setBuyerName] = useState('');
  const [major, setMajor] = useState('');
  const [batch, setBatch] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [errorMessage, setErrorMessage] = useState(''); // system/lock error only — field errors go inline
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [majorOpen, setMajorOpen] = useState(false);
  const majorRef = useRef<HTMLDivElement>(null);

  // Close the custom dropdown on any click outside it
  useEffect(() => {
    if (!majorOpen) return;
    const onClick = (e: MouseEvent) => {
      if (majorRef.current && !majorRef.current.contains(e.target as Node)) {
        setMajorOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [majorOpen]);

  if (!individual && (!selectedTable || selectedSeats.length === 0)) return null;

  const isWholeTable = individual ? false : selectedSeats.length === selectedTable!.capacity;
  const totalAmount = individual
    ? INDIVIDUAL_PRICE
    : isWholeTable
      ? selectedTable!.pricePerTable
      : selectedSeats.length * selectedTable!.pricePerSeat;

  // ponytail: red required-marker reused across fields; one element, no component.
  const req = <span className="text-[#DC2626]">*</span>;

  // Name: Thai + English letters, spaces, and "." (titles like "ดร.") only.
  const sanitizeName = (v: string) => v.replace(/[^฀-๿a-zA-Z\s.]/g, '');
  // Batch: digits only, max 2 (1–99).
  const sanitizeBatch = (v: string) => v.replace(/\D/g, '').slice(0, 2);
  // Phone mask: 0XX-XXX-XXXX as digits are typed.
  const formatPhone = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 10);
    return [d.slice(0, 3), d.slice(3, 6), d.slice(6, 10)].filter(Boolean).join('-');
  };
  const emailValid = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

  // Collect ALL field errors at once so every bad field lights up, not just the first.
  const validate = () => {
    const next: Record<string, string> = {};
    if (!buyerName.trim()) next.buyerName = 'กรุณากรอกชื่อ-นามสกุล';
    if (!major) next.major = 'กรุณาเลือกสาขา';
    if (!batch.trim()) next.batch = 'กรุณาระบุรุ่นที่';
    if (phone.replace(/\D/g, '').length !== 10)
      next.phone = 'เบอร์โทรศัพท์ต้องมี 10 หลัก (เช่น 082-120-3456)';
    if (!emailValid(email)) next.email = 'รูปแบบอีเมลไม่ถูกต้อง (เช่น name@university.ac.th)';
    return next;
  };

  // Drop a field's error the moment the user edits it.
  const clearError = (field: string) =>
    setErrors((prev) => (prev[field] ? { ...prev, [field]: '' } : prev));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const fieldErrors = validate();
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }
    setErrors({});

    const formattedDepartment = `${major} (รุ่น ${batch.trim()})`;

    try {
      if (individual) {
        startIndividualLock({ buyerName, department: formattedDepartment, major, batch: batch.trim(), phone, email });
      } else {
        startSeatLock({
          buyerName,
          department: formattedDepartment,
          major,
          batch: batch.trim(),
          phone,
          email,
          guestNames: {},
        });
      }
      onSuccessProceedToPayment();
    } catch (err: any) {
      setErrorMessage(err.message || 'เกิดข้อผิดพลาดในการล็อกที่นั่ง');
    }
  };

  const baseInput =
    'w-full bg-surface rounded-lg px-3.5 py-2.5 text-sm text-primary placeholder:text-subtle transition-colors focus:outline-none focus:ring-2';
  // Red border + red focus ring when the field has an error, neutral otherwise.
  const fieldClass = (field: string) =>
    `${baseInput} ${
      errors[field]
        ? 'border border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/20'
        : 'border border-[rgba(20,20,20,0.16)] focus:border-primary focus:ring-primary/15'
    }`;
  // ponytail: one-liner error text under a field; nothing rendered when clean.
  const errText = (field: string) =>
    errors[field] ? (
      <p className="mt-1.5 text-xs font-medium text-[#DC2626]">{errors[field]}</p>
    ) : null;

  return (
    <form onSubmit={handleSubmit} noValidate className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5 text-primary">

      {errorMessage && (
        <div className="p-3.5 rounded-lg bg-page text-primary text-xs font-medium flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-accent shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Seat Summary Box */}
      <div className="p-4 rounded-lg bg-page flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-surface hairline flex items-center justify-center text-primary font-bold">
            {individual ? '1' : selectedTable!.tableNumber}
          </div>
          <div>
            <div className="font-bold text-primary text-sm">
              {individual ? 'บัตรเดี่ยว (Individual)' : `${selectedTable!.name} (${selectedTable!.zoneLabelTh})`}
            </div>
            <div className="text-xs text-muted">
              {individual
                ? 'สำหรับผู้เข้าร่วม 1 ท่าน (ไม่ระบุโต๊ะ)'
                : isWholeTable
                  ? `จองเหมาทั้งโต๊ะ (${selectedTable!.capacity} ที่นั่ง)`
                  : `ที่นั่งเลขที่: ${selectedSeats.map((s) => s.seatNumber).join(', ')}`}
            </div>
          </div>
        </div>

        <div className="text-right">
          <div className="text-xs text-muted">ยอดรวม</div>
          <div className="text-lg font-black text-primary font-mono">
            ฿{totalAmount.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Non-refundable Policy Notice */}
      <div className="p-3 rounded-lg bg-page text-muted text-xs font-medium flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-accent shrink-0" />
        <span>
          หมายเหตุ: เมื่อซื้อบัตรแล้ว จะไม่สามารถคืนเงินได้
        </span>
      </div>

      {/* Input Fields */}
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-1">
            <label className="text-xs font-semibold text-primary mb-1.5 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-muted" />
              <span>ชื่อ-นามสกุล {req}</span>
            </label>
            <input
              type="text"
              required
              placeholder="เช่น ดร. สมชาย ใจดี"
              value={buyerName}
              onChange={(e) => { setBuyerName(sanitizeName(e.target.value)); clearError('buyerName'); }}
              className={fieldClass('buyerName')}
            />
            {errText('buyerName')}
          </div>

          <div>
            <label className="text-xs font-semibold text-primary mb-1.5 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-muted" />
              <span>สาขา {req}</span>
            </label>
            <div ref={majorRef} className="relative">
              <button
                type="button"
                onClick={() => setMajorOpen((o) => !o)}
                className={`${fieldClass('major')} flex items-center justify-between text-left cursor-pointer ${major ? 'text-primary' : 'text-subtle'} ${majorOpen && !errors.major ? 'border-primary ring-2 ring-primary/15' : ''}`}
              >
                <span>{major || '-- กรุณาเลือกสาขา --'}</span>
                <ChevronDown
                  className={`w-4 h-4 text-muted shrink-0 transition-transform ${majorOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {majorOpen && (
                <ul
                  role="listbox"
                  className="absolute z-20 mt-1.5 w-full bg-surface border border-[rgba(20,20,20,0.16)] rounded-lg card-shadow overflow-hidden py-1 animate-fade-in"
                >
                  {MAJOR_OPTIONS.map((opt) => {
                    const selected = major === opt;
                    return (
                      <li key={opt} role="option" aria-selected={selected}>
                        <button
                          type="button"
                          onClick={() => {
                            setMajor(opt);
                            setMajorOpen(false);
                            clearError('major');
                          }}
                          className={`w-full flex items-center justify-between px-3.5 py-2 text-sm text-left transition-colors cursor-pointer hover:bg-page ${selected ? 'text-primary font-semibold' : 'text-muted'}`}
                        >
                          <span>{opt}</span>
                          {selected && <Check className="w-4 h-4 text-accent shrink-0" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {errText('major')}
          </div>

          <div>
            <label className="text-xs font-semibold text-primary mb-1.5 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-muted" />
              <span>รุ่นที่ {req}</span>
            </label>
            <input
              type="text"
              inputMode="numeric"
              required
              placeholder="เช่น 25"
              value={batch}
              onChange={(e) => { setBatch(sanitizeBatch(e.target.value)); clearError('batch'); }}
              className={`${fieldClass('batch')} font-mono`}
            />
            {errText('batch')}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-primary mb-1.5 flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 text-muted" />
              <span>เบอร์โทรศัพท์ {req}</span>
            </label>
            <input
              type="tel"
              required
              placeholder="08X-XXX-XXXX"
              value={phone}
              onChange={(e) => { setPhone(formatPhone(e.target.value)); clearError('phone'); }}
              className={`${fieldClass('phone')} font-mono`}
            />
            {errText('phone')}
          </div>

          <div>
            <label className="text-xs font-semibold text-primary mb-1.5 flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-muted" />
              <span>อีเมล {req}</span>
            </label>
            <input
              type="email"
              required
              placeholder="name@university.ac.th"
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearError('email'); }}
              className={fieldClass('email')}
            />
            {errText('email')}
          </div>
        </div>

      </div>

      {/* Lock Notice */}
      <div className="p-3.5 rounded-lg bg-page text-muted text-xs flex items-center gap-2">
        <Clock className="w-4 h-4 shrink-0 text-muted" />
        <span>
          {`เมื่อกดยืนยัน ระบบจะเริ่มล็อกที่นั่งไว้ให้คุณเป็นเวลา ${eventDetails.lockTimeoutMinutes} นาที เพื่อดำเนินการชำระเงิน`}
        </span>
      </div>

      {/* Submit */}
      <div className="pt-2 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onBack}
          className="px-5 py-2.5 rounded-lg bg-surface btn-secondary text-primary text-sm font-semibold hover:bg-page transition-all cursor-pointer"
        >
          ย้อนกลับ
        </button>

        <button
          type="submit"
          className="px-6 py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-white font-semibold text-sm transition-colors flex items-center gap-2 cursor-pointer"
        >
          <span>ยืนยันและไปหน้าชำระเงิน</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

    </form>
  );
};

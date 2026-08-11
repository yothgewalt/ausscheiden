'use client';

import { useEffect, useRef, useState } from 'react';
import {
  X, User, Phone, Mail, Building2, ChevronDown, Check, AlertTriangle, Upload, Ticket,
} from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { generateInitialTables, INDIVIDUAL_PRICE } from '../../data/mockData';
import { MAX_SLIP_CHARS, readAsDataUrl, toSlipDataUrl } from '../slipImage';
import type { AdminTable } from './AdminSeatMap';
import { fmtBaht } from './format';

const MAJOR_OPTIONS = ['ITT', 'INET', 'IT', 'ITI', 'INE'];
const META = new Map(generateInitialTables().map((t) => [t.id, t]));

const REJECT_TH: Record<string, string> = {
  locked: 'มีผู้ใช้กำลังจองโต๊ะนี้อยู่ กรุณารอสักครู่แล้วลองใหม่',
  unavailable: 'โต๊ะนี้ถูกจองไปแล้ว กรุณาเลือกโต๊ะอื่น',
  sold_out: 'บัตรเดี่ยวเต็มแล้ว',
};

interface CreateBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableTables: AdminTable[];
}

export function CreateBookingModal({ isOpen, onClose, availableTables }: CreateBookingModalProps) {
  const utils = trpc.useUtils();

  const [individual, setIndividual] = useState(false);
  const [tableId, setTableId] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [batch, setBatch] = useState('');
  const [major, setMajor] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState('');
  const [slipImage, setSlipImage] = useState<string | null>(null);
  const [slipName, setSlipName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState('');

  const [majorOpen, setMajorOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const majorRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const create = trpc.admin.createBooking.useMutation();

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (majorRef.current && !majorRef.current.contains(e.target as Node)) setMajorOpen(false);
      if (tableRef.current && !tableRef.current.contains(e.target as Node)) setTableOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  if (!isOpen) return null;

  const clearError = (f: string) =>
    setErrors((prev) => (prev[f] ? { ...prev, [f]: '' } : prev));

  const baseInput =
    'w-full bg-surface rounded-lg px-3.5 py-2.5 text-sm text-primary placeholder:text-subtle transition-colors focus:outline-none focus:ring-2';
  const fieldClass = (field: string) =>
    `${baseInput} ${
      errors[field]
        ? 'border border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/20'
        : 'border border-[rgba(20,20,20,0.16)] focus:border-primary focus:ring-primary/15'
    }`;
  const errText = (field: string) =>
    errors[field] ? (
      <p className="mt-1.5 text-xs font-medium text-[#DC2626]">{errors[field]}</p>
    ) : null;
  const req = <span className="text-[#DC2626]">*</span>;

  const pickTable = (id: string) => {
    setTableId(id);
    setTableOpen(false);
    clearError('tableId');
    // Prefill the price the buyer would have paid; the organiser can override
    // it if the money that actually arrived was different.
    if (!amount) setAmount(String(META.get(id)?.pricePerTable ?? ''));
  };

  const goIndividual = (on: boolean) => {
    setIndividual(on);
    setTableId('');
    clearError('tableId');
    setAmount(on ? String(INDIVIDUAL_PRICE) : '');
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBanner('');
    try {
      // createImageBitmap can't decode every format on every browser (HEIC on
      // some), so fall back to the raw file rather than refusing the upload.
      const dataUrl = await toSlipDataUrl(file).catch(() => readAsDataUrl(file));
      if (dataUrl.length > MAX_SLIP_CHARS) {
        setBanner('ไฟล์สลิปมีขนาดใหญ่เกินไป กรุณาย่อขนาดรูปแล้วลองอีกครั้ง');
        return;
      }
      setSlipImage(dataUrl);
      setSlipName(file.name);
    } catch {
      setBanner('อ่านไฟล์รูปไม่สำเร็จ กรุณาลองไฟล์อื่น');
    }
  };

  const reset = () => {
    setIndividual(false);
    setTableId('');
    setBuyerName('');
    setBatch('');
    setMajor('');
    setPhone('');
    setEmail('');
    setAmount('');
    setSlipImage(null);
    setSlipName('');
    setErrors({});
    setBanner('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBanner('');

    // All errors at once, like the buyer form — one pass, not one field at a time.
    const next: Record<string, string> = {};
    if (!individual && !tableId) next.tableId = 'กรุณาเลือกโต๊ะ';
    if (!buyerName.trim()) next.buyerName = 'กรุณากรอกชื่อ-นามสกุล';
    if (!batch.trim()) next.batch = 'กรุณากรอกรุ่น';
    if (!major) next.major = 'กรุณาเลือกสาขา';
    if (!phone.trim()) next.phone = 'กรุณากรอกเบอร์โทร';
    if (!email.trim()) next.email = 'กรุณากรอกอีเมล';
    const finalAmount = Number(amount);
    if (!Number.isInteger(finalAmount) || finalAmount <= 0) next.amount = 'กรุณากรอกยอดเป็นจำนวนเต็มบวก';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    try {
      const res = await create.mutateAsync({
        tableId: individual ? undefined : tableId,
        buyerName: buyerName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        major,
        batch: batch.trim(),
        bookingType: individual ? 'individual' : 'whole_table',
        finalAmount,
        slipImage: slipImage ?? undefined,
      });

      if (!res.ok) {
        setBanner(REJECT_TH[res.reason] ?? 'บันทึกการจองไม่สำเร็จ');
        return;
      }

      await Promise.all([
        utils.admin.bookings.invalidate(),
        utils.tables.list.invalidate(),
        utils.tables.zoneAvailability.invalidate(),
      ]);
      reset();
      onClose();
    } catch (err: any) {
      setBanner(err?.message || 'บันทึกการจองไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    }
  };

  const selectedMeta = tableId ? META.get(tableId) : undefined;

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-primary/40 backdrop-blur-sm animate-fade-in cursor-pointer"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl max-h-[95vh] flex flex-col bg-surface rounded-lg card-shadow overflow-hidden text-primary cursor-default"
      >
        <div className="p-4 sm:p-5 hairline-b flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-base sm:text-lg font-semibold text-primary">เพิ่มการจอง</h3>
            <p className="text-xs text-muted">สำหรับผู้ที่ชำระเงินนอกระบบ</p>
          </div>
          <button
            onClick={onClose}
            aria-label="ปิด"
            className="p-2 text-muted hover:text-primary transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={submit} noValidate className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
          {banner && (
            <div className="p-3.5 rounded-lg bg-page text-primary text-xs font-medium flex items-center gap-2 animate-shake">
              <AlertTriangle className="w-4 h-4 text-[#DC2626] shrink-0" />
              <span>{banner}</span>
            </div>
          )}

          {/* Table vs individual ticket */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => goIndividual(false)}
              className={`px-4 py-3 rounded-lg text-sm font-semibold text-left transition-colors cursor-pointer ${
                !individual ? 'bg-page ring-[1px] ring-primary' : 'bg-page hover:bg-page/70 text-muted'
              }`}
            >
              จองโต๊ะ
            </button>
            <button
              type="button"
              onClick={() => goIndividual(true)}
              className={`px-4 py-3 rounded-lg text-sm font-semibold text-left flex items-center gap-2 transition-colors cursor-pointer ${
                individual ? 'bg-page ring-[1px] ring-primary' : 'bg-page hover:bg-page/70 text-muted'
              }`}
            >
              <Ticket className="w-4 h-4" />
              <span>บัตรเดี่ยว</span>
            </button>
          </div>

          {!individual && (
            <div ref={tableRef} className="relative">
              <label className="text-xs font-semibold text-primary mb-1.5 flex items-center gap-1.5">
                <span>โต๊ะ {req}</span>
              </label>
              <button
                type="button"
                onClick={() => setTableOpen((o) => !o)}
                className={`${fieldClass('tableId')} flex items-center justify-between text-left cursor-pointer`}
              >
                <span className={tableId ? 'text-primary' : 'text-subtle'}>
                  {selectedMeta
                    ? `${selectedMeta.name} — ${fmtBaht(selectedMeta.pricePerTable)}`
                    : `เลือกโต๊ะที่ว่าง (${availableTables.length} โต๊ะ)`}
                </span>
                <ChevronDown className={`w-4 h-4 text-muted transition-transform ${tableOpen ? 'rotate-180' : ''}`} />
              </button>
              {tableOpen && (
                <ul
                  role="listbox"
                  className="absolute z-20 mt-1.5 w-full max-h-60 overflow-y-auto bg-surface border border-[rgba(20,20,20,0.16)] rounded-lg card-shadow py-1 animate-fade-in"
                >
                  {availableTables.length === 0 && (
                    <li className="px-3.5 py-2 text-sm text-muted">ไม่มีโต๊ะว่าง</li>
                  )}
                  {availableTables.map((t) => {
                    const meta = META.get(t.id);
                    const selected = t.id === tableId;
                    return (
                      <li key={t.id} role="option" aria-selected={selected}>
                        <button
                          type="button"
                          onClick={() => pickTable(t.id)}
                          className={`w-full flex items-center justify-between px-3.5 py-2 text-sm text-left transition-colors cursor-pointer hover:bg-page ${
                            selected ? 'text-primary font-semibold' : 'text-muted'
                          }`}
                        >
                          <span>{meta?.name ?? t.id}</span>
                          <span className="flex items-center gap-2 font-mono text-xs">
                            {fmtBaht(meta?.pricePerTable ?? 0)}
                            {selected && <Check className="w-4 h-4 text-accent shrink-0" />}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {errText('tableId')}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-primary mb-1.5 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-muted" />
                <span>ชื่อ-นามสกุล {req}</span>
              </label>
              <input
                type="text"
                placeholder="เช่น ดร. สมชาย ใจดี"
                value={buyerName}
                onChange={(e) => { setBuyerName(e.target.value); clearError('buyerName'); }}
                className={fieldClass('buyerName')}
              />
              {errText('buyerName')}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-primary mb-1.5 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-muted" />
                  <span>รุ่น {req}</span>
                </label>
                <input
                  type="text"
                  placeholder="เช่น 12"
                  value={batch}
                  onChange={(e) => { setBatch(e.target.value); clearError('batch'); }}
                  className={`${fieldClass('batch')} font-mono`}
                />
                {errText('batch')}
              </div>

              <div ref={majorRef} className="relative">
                <label className="text-xs font-semibold text-primary mb-1.5 flex items-center gap-1.5">
                  <span>สาขา {req}</span>
                </label>
                <button
                  type="button"
                  onClick={() => setMajorOpen((o) => !o)}
                  className={`${fieldClass('major')} flex items-center justify-between text-left cursor-pointer`}
                >
                  <span className={major ? 'text-primary' : 'text-subtle'}>{major || 'เลือกสาขา'}</span>
                  <ChevronDown className={`w-4 h-4 text-muted transition-transform ${majorOpen ? 'rotate-180' : ''}`} />
                </button>
                {majorOpen && (
                  <ul
                    role="listbox"
                    className="absolute z-20 mt-1.5 w-full bg-surface border border-[rgba(20,20,20,0.16)] rounded-lg card-shadow overflow-hidden py-1 animate-fade-in"
                  >
                    {MAJOR_OPTIONS.map((opt) => {
                      const selected = opt === major;
                      return (
                        <li key={opt} role="option" aria-selected={selected}>
                          <button
                            type="button"
                            onClick={() => { setMajor(opt); setMajorOpen(false); clearError('major'); }}
                            className={`w-full flex items-center justify-between px-3.5 py-2 text-sm text-left transition-colors cursor-pointer hover:bg-page ${
                              selected ? 'text-primary font-semibold' : 'text-muted'
                            }`}
                          >
                            <span>{opt}</span>
                            {selected && <Check className="w-4 h-4 text-accent shrink-0" />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {errText('major')}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-primary mb-1.5 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-muted" />
                  <span>เบอร์โทร {req}</span>
                </label>
                <input
                  type="tel"
                  placeholder="0812345678"
                  value={phone}
                  onChange={(e) => { setPhone(e.target.value); clearError('phone'); }}
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
                  placeholder="somchai@example.com"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); clearError('email'); }}
                  className={fieldClass('email')}
                />
                {errText('email')}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-primary mb-1.5 flex items-center gap-1.5">
                <span>ยอดที่ชำระ (บาท) {req}</span>
              </label>
              <input
                type="number"
                min={1}
                step={1}
                placeholder="5999"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); clearError('amount'); }}
                className={`${fieldClass('amount')} font-mono`}
              />
              {errText('amount')}
            </div>

            <div>
              <label className="text-xs font-semibold text-primary mb-1.5 flex items-center gap-1.5">
                <Upload className="w-3.5 h-3.5 text-muted" />
                <span>สลิป (ไม่บังคับ)</span>
              </label>
              {/* The native control renders its own English label, so it stays
                  hidden behind a button that speaks the same Thai as the rest. */}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={(e) => onFile(e.target.files?.[0])}
                className="hidden"
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="px-5 py-2.5 rounded-lg bg-surface btn-secondary text-primary text-sm font-semibold hover:bg-page transition-all cursor-pointer flex items-center gap-2 shrink-0"
                >
                  <Upload className="w-4 h-4" />
                  <span>เลือกไฟล์</span>
                </button>
                {slipImage ? (
                  <span className="text-xs text-muted flex items-center gap-1.5 min-w-0">
                    <Check className="w-3.5 h-3.5 text-accent shrink-0" />
                    <span className="truncate">{slipName}</span>
                  </span>
                ) : (
                  <span className="text-xs text-subtle">ยังไม่ได้เลือกไฟล์</span>
                )}
              </div>
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-lg bg-surface btn-secondary text-primary text-sm font-semibold hover:bg-page transition-all cursor-pointer"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={create.isPending}
              className="px-6 py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-white text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {create.isPending ? 'กำลังบันทึก…' : 'บันทึกการจอง'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

import React, { useRef, useState } from 'react';
import { useBooking } from '../context/BookingContext';
import { promptPayPayload } from '../utils/promptpay';
import {
  X,
  Upload,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Copy,
  Check,
  ShieldCheck,
  Landmark,
} from 'lucide-react';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccessDone?: () => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  onClose,
  onSuccessDone,
}) => {
  const {
    activeLockBooking,
    lockTimerSeconds,
    eventDetails,
    uploadSlipAndVerify,
    cancelSeatLock,
  } = useBooking();

  const [copiedAccount, setCopiedAccount] = useState(false);
  const [slipImage, setSlipImage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen || !activeLockBooking) return null;

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleCopyAccount = () => {
    navigator.clipboard.writeText(eventDetails.bankAccountNumber);
    setCopiedAccount(true);
    setTimeout(() => setCopiedAccount(false), 2000);
  };

  const readSlipFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setVerificationError('กรุณาเลือกไฟล์รูปภาพ (JPG, PNG, WEBP)');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setSlipImage(reader.result as string);
      setVerificationError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    readSlipFile(e.target.files?.[0]);

  const handleDrop = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    setIsDragging(false);
    readSlipFile(e.dataTransfer.files?.[0]);
  };

  const clearSlip = () => {
    setSlipImage(null);
    setVerificationError(null);
    if (fileInputRef.current) fileInputRef.current.value = ''; // let the same file re-trigger onChange
  };

  const handleConfirmPayment = async () => {
    if (!slipImage) {
      setVerificationError('กรุณาอัปโหลดสลิปการโอนเงินก่อนยืนยัน');
      return;
    }

    setIsVerifying(true);
    setVerificationError(null);

    try {
      const result = await uploadSlipAndVerify(activeLockBooking.id, slipImage);
      setIsVerifying(false);

      if (result.status === 'confirmed') {
        // activeLockBooking is nulled on confirm → this modal unmounts immediately.
        // Hand off to the congrats modal (App.tsx); no in-modal success state can render.
        if (onSuccessDone) {
          onSuccessDone();
        } else {
          onClose();
        }
      } else {
        setVerificationError(
          result.slipVerificationResult?.failureReason || 'เกิดข้อผิดพลาดในการส่งสลิปการโอนเงิน'
        );
      }
    } catch (err: any) {
      setIsVerifying(false);
      setVerificationError(err.message || 'เกิดข้อผิดพลาดในการส่งหลักฐานการชำระเงิน');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-primary/40 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-2xl bg-surface rounded-lg card-shadow overflow-hidden text-primary max-h-[95vh] flex flex-col">

        {/* Header — title + amber countdown gate + cancel in one row (ponytail: was two stacked bars).
            Amber stays confined to the timer: the single "waiting" signal. */}
        <div className="p-5 hairline-b flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="text-base sm:text-lg font-bold text-primary leading-tight">
              ชำระเงินผ่านการโอนเงิน
            </h3>
            <p className="text-xs text-muted mt-0.5 truncate">
              {activeLockBooking.bookingType === 'individual'
                ? `รหัสจอง: ${activeLockBooking.id} • บัตรเดี่ยว 1 ท่าน`
                : `รหัสจอง: ${activeLockBooking.id} • ${activeLockBooking.tableName} (${activeLockBooking.seats.length} ที่นั่ง)`}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5 bg-accent/10 px-2.5 py-1.5 rounded-lg text-accent font-mono font-bold text-sm">
              <Clock className="w-4 h-4" />
              <span>{formatTimer(lockTimerSeconds)}</span>
            </div>
            <button
              onClick={cancelSeatLock}
              aria-label="ยกเลิก"
              className="p-1.5 text-muted hover:text-primary rounded-lg btn-secondary transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 overflow-y-auto">

            {/* Amount — the first thing to read */}
          <div className="flex items-baseline justify-between">
            <span className="text-xs sm:text-sm font-semibold text-muted">
              ยอดที่ต้องชำระ
            </span>
            <span className="text-2xl font-black text-primary font-mono">
              ฿{activeLockBooking.finalAmount.toLocaleString()}
            </span>
          </div>

          {/* PromptPay QR — dynamic (amount embedded). Payload built client-side from the
              e-Wallet ID; rendered via api.qrserver.com (same service as booking QR, no dep).
              Empty payload ⇒ skip the block rather than show a broken image. */}
          {(() => {
            const payload = promptPayPayload(
              eventDetails.promptpayNumber,
              activeLockBooking.finalAmount
            );
            if (!payload) return null;
            return (
              <div className="flex flex-col items-center gap-2 p-4 bg-page rounded-lg border border-[rgba(20,20,20,0.16)]">
                <span className="text-xs font-semibold text-muted">สแกนเพื่อชำระผ่านพร้อมเพย์</span>
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=0&data=${encodeURIComponent(payload)}`}
                  alt="PromptPay QR"
                  width={220}
                  height={220}
                  className="rounded-lg bg-surface p-2 border border-hairline"
                />
                <span className="text-[14px] text-subtle">{eventDetails.promptpayAccountName}</span>
              </div>
            );
          })()}

          {/* Slip Upload — input is sr-only (NOT display:none, or ref.click() no-ops on
              macOS) and triggered by ref. Empty state: whole zone opens the picker. Uploaded
              state: preview + explicit เปลี่ยน / ลบ so a wrong image is easy to swap out. */}
          <div>
            <div className="text-xs font-bold text-primary flex items-center justify-between mb-1.5">
              <span>อัปโหลดสลิปการโอนเงิน *</span>
              <span className="text-[10px] font-normal text-subtle">JPG, PNG, WEBP</span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="sr-only"
            />
            {slipImage ? (
              <div className="rounded-lg border-2 border-dashed border-[rgba(20,20,20,0.20)] bg-page p-4 flex items-center gap-3">
                <img src={slipImage} alt="Slip preview" className="w-16 h-16 rounded-lg object-cover border border-[rgba(20,20,20,0.16)] shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-primary">
                    <Check className="w-4 h-4 text-accent shrink-0" />
                    <span>อัปโหลดสลิปเรียบร้อยแล้ว</span>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-2.5 py-1 rounded-lg bg-surface btn-secondary text-xs font-bold text-primary hover:bg-primary/3 transition-all cursor-pointer"
                    >
                      เปลี่ยนรูป
                    </button>
                    <button
                      type="button"
                      onClick={clearSlip}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold text-muted hover:text-primary flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>ลบรูป</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), fileInputRef.current?.click())}
                onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                onDrop={handleDrop}
                className={`cursor-pointer rounded-lg border-2 border-dashed transition-colors flex flex-col items-center justify-center gap-2 p-6 text-center outline-none ${
                  isDragging
                    ? 'border-primary bg-primary/4'
                    : 'border-[rgba(20,20,20,0.20)] bg-page hover:bg-primary/2'
                }`}
              >
                <Upload className="w-5 h-5" />
                <div className="text-xs text-muted">
                  <span className="text-primary font-bold">คลิกเลือกไฟล์สลิป</span> หรือลากไฟล์มาวางที่นี่
                </div>
              </div>
            )}
          </div>

          {/* Error / Failure Banner */}
          {verificationError && (
            <div className="p-3 rounded-lg bg-page text-xs flex items-start gap-1.5">
              <AlertTriangle className="w-4 h-4 text-accent shrink-0 mt-px" />
              <div>
                <span className="font-bold text-accent">แจ้งชำระเงินไม่สำเร็จ: </span>
                <span className="text-muted">{verificationError}</span>
              </div>
            </div>
          )}

          {/* Payment Confirmation Button */}
          <button
            type="button"
            disabled={isVerifying}
            onClick={handleConfirmPayment}
            className="w-full py-3 px-6 rounded-lg bg-primary hover:bg-primary/90 text-white font-bold text-sm sm:text-base transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isVerifying ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>กำลังบันทึกข้อมูลการชำระเงิน...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5" />
                <span>ยืนยันการชำระเงิน</span>
              </>
            )}
          </button>

          {/* Non-refundable note — read-only prose, footnote not a card (luma taste) */}
          <p className="text-[11px] text-subtle flex items-center justify-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            <span>เมื่อชำระเงินแล้ว จะไม่สามารถขอคืนเงินได้</span>
          </p>

        </div>

      </div>
    </div>
  );
};

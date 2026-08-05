import React, { useEffect, useState } from 'react';
import { SeatMap } from './SeatMap';
import { BookingFormModal } from './BookingFormModal';
import { useBooking } from '../context/BookingContext';
import { Table } from '../types';
import { X, Map, ArrowLeft } from 'lucide-react';

interface SeatMapModalProps {
  isOpen: boolean;
  individualMode?: boolean;
  onClose: () => void;
  onSuccessProceedToPayment: () => void;
}

export const SeatMapModal: React.FC<SeatMapModalProps> = ({
  isOpen,
  individualMode = false,
  onClose,
  onSuccessProceedToPayment,
}) => {
  const { selectWholeTable, releaseSelection, lockError } = useBooking();
  const [step, setStep] = useState<'map' | 'form'>('map');

  // Fresh open: individual skips straight to the form; everyone else starts on the map
  useEffect(() => {
    if (isOpen) setStep(individualMode ? 'form' : 'map');
  }, [isOpen, individualMode]);

  if (!isOpen) return null;

  const handlePickTable = async (table: Table) => {
    // selectWholeTable acquires the server lock; only advance if it's ours.
    const ok = await selectWholeTable(table);
    if (ok) setStep('form');
  };

  // Bailing out before submit must free the 'selecting' lock (else it sits for the
  // full TTL). Success goes through onSuccessProceedToPayment, not these, so the
  // promoted lock is never touched here.
  const handleClose = () => {
    releaseSelection();
    onClose();
  };
  const handleBackToMap = () => {
    releaseSelection();
    setStep('map');
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-0 sm:p-4 bg-[#141414]/40 backdrop-blur-md animate-fade-in">
      <div className="relative w-full h-full sm:h-auto sm:max-w-3xl sm:max-h-[90vh] bg-surface sm:rounded-lg card-shadow overflow-hidden text-primary flex flex-col">

        {/* Wizard Header */}
        <div className="p-4 sm:p-5 hairline-b flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div>
              <h3 className="text-base sm:text-lg font-semibold text-primary">
                {step === 'form'
                  ? (individualMode ? 'จองบัตรเดี่ยว' : 'กรอกข้อมูลผู้จอง')
                  : 'ผังที่นั่ง — เลือกโต๊ะจีน'}
              </h3>
              <p className="text-xs text-muted">
                {step === 'form'
                  ? (individualMode
                      ? 'กรอกข้อมูลผู้จองบัตรเดี่ยว 1 ท่าน'
                      : 'กรอกข้อมูลเพื่อล็อกโต๊ะและดำเนินการชำระเงิน')
                  : 'คลิกเลือกโต๊ะที่ว่างเพื่อทำรายการจอง'}
              </p>
            </div>
          </div>

          <button
            onClick={handleClose}
            aria-label="Close"
            className="p-2 text-muted hover:text-primary transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Wizard Body */}
        {step === 'map' ? (
          <div className="overflow-y-auto flex-1 p-2 sm:p-4">
            {lockError && (
              <div className="mb-3 mx-auto max-w-md text-center text-sm font-medium text-red-600 bg-red-500/10 rounded-lg px-4 py-2">
                {lockError}
              </div>
            )}
            <SeatMap onSelectTable={handlePickTable} />
          </div>
        ) : (
          <BookingFormModal
            individual={individualMode}
            onBack={individualMode ? handleClose : handleBackToMap}
            onSuccessProceedToPayment={onSuccessProceedToPayment}
          />
        )}
      </div>
    </div>
  );
};

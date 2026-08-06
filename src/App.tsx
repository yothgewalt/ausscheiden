'use client';

import { useState } from 'react';
import { BookingProvider, useBooking } from './context/BookingContext';
import { TRPCProvider } from './components/TRPCProvider';
import { EventPage } from './components/EventPage';
import { SeatMapModal } from './components/SeatMapModal';
import { Footer } from './components/Footer';
import { PaymentModal } from './components/PaymentModal';
import { CongratsModal } from './components/CongratsModal';

function MainAppContent() {
  const {
    userRole,
    setActiveZoneFilter,
    activeLockBooking,
  } = useBooking();

  // Modal Visibility States
  const [isSeatMapModalOpen, setIsSeatMapModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isCongratsOpen, setIsCongratsOpen] = useState(false);
  const [individualMode, setIndividualMode] = useState(false); // skip the map → go straight to form

  const handleSuccessProceedToPayment = () => {
    setIsSeatMapModalOpen(false);
    setIsPaymentModalOpen(true);
  };

  const handlePaymentSuccessDone = () => {
    setIsPaymentModalOpen(false);
    setIsCongratsOpen(true);
  };

  return (
    <div className="min-h-screen bg-page text-primary font-sans antialiased selection:bg-primary selection:text-white flex flex-col justify-between">

      <main className="flex-1">
        <EventPage
            onSelectTableClick={() => setIsSeatMapModalOpen(true)}
            onSelectZone={(zoneId) => {
                if (zoneId === 'individual') {
                setIndividualMode(true);
                } else {
                setIndividualMode(false);
                setActiveZoneFilter(zoneId as any);
                }
                setIsSeatMapModalOpen(true);
            }}
        />
    </main>

      {/* Website Footer with Credits */}
      <Footer />

      {/* Modals & Overlay Windows */}

      {/* Fullscreen booking wizard: pick table → fill info */}
      <SeatMapModal
        isOpen={isSeatMapModalOpen}
        individualMode={individualMode}
        onClose={() => {
          setIsSeatMapModalOpen(false);
          setIndividualMode(false);
        }}
        onSuccessProceedToPayment={handleSuccessProceedToPayment}
      />

      {/* Dynamic PromptPay & Auto Slip Verification Modal */}
      {(isPaymentModalOpen || (activeLockBooking && activeLockBooking.status === 'pending_payment')) && (
        <PaymentModal
          isOpen={true}
          onClose={() => setIsPaymentModalOpen(false)}
          onSuccessDone={handlePaymentSuccessDone}
        />
      )}

      {/* Congratulation modal — shown once a slip confirms */}
      <CongratsModal
        isOpen={isCongratsOpen}
        onClose={() => setIsCongratsOpen(false)}
      />

    </div>
  );
}

export default function App() {
  return (
    <TRPCProvider>
      <BookingProvider>
        <MainAppContent />
      </BookingProvider>
    </TRPCProvider>
  );
}


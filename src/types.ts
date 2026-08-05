export type Language = 'th' | 'en';

export type UserRole = 'guest' | 'admin' | 'staff';

export type ZoneType = 'executive' | 'alumni' | 'student';

export type TableStatus = 'available' | 'held' | 'booked' | 'closed';

export interface Seat {
  id: string; // e.g., "T1-S1"
  seatNumber: number; // 1 to 10
  status: 'available' | 'held' | 'booked' | 'closed';
  lockedBy?: string; // session/booking id
  lockedAt?: number; // timestamp
  guestName?: string;
}

export interface Table {
  id: string; // e.g., "T1"
  name: string; // e.g., "โต๊ะ 1" or "T-01"
  tableNumber: number;
  zone: ZoneType;
  zoneLabelTh: string;
  zoneLabelEn: string;
  pricePerTable: number;
  pricePerSeat: number;
  capacity: number; // usually 10
  seats: Seat[];
  x: number; // visual coordinates on seat map grid (0-100%)
  y: number; // visual coordinates on seat map grid (0-100%)
  status: TableStatus; // aggregated status
  isReserve?: boolean; // Flag for overflow/reserve tables
  descriptionTh?: string;
  descriptionEn?: string;
}

export interface GuestInfo {
  seatId: string;
  seatNumber: number;
  guestName: string;
}

export interface Booking {
  id: string; // e.g., "BK-2026-0891"
  createdAt: string;
  updatedAt: string;
  
  // Buyer details
  buyerName: string;
  department: string;
  phone: string;
  email: string;
  lineId?: string;
  
  // Table & Seats — optional: an individual ticket carries no table
  tableId?: string;
  tableName?: string;
  zone?: ZoneType;
  seats: Seat[];
  guestList: GuestInfo[];
  bookingType: 'whole_table' | 'individual_seats' | 'individual';
  
  // Pricing
  totalAmount: number;
  discountAmount?: number;
  finalAmount: number;
  
  // Lock & Payment state
  lockExpiresAt: number; // timestamp
  status: 'locked' | 'pending_payment' | 'verifying_slip' | 'confirmed' | 'rejected' | 'expired' | 'checked_in';
  
  // Payment info
  paymentMethod: 'promptpay' | 'bank_transfer';
  slipImage?: string;
  slipUploadedAt?: string;
  slipVerificationResult?: {
    success: boolean;
    confidence: number;
    transactionId?: string;
    transferredAmount?: number;
    transferredTime?: string;
    accountMatch?: boolean;
    failureReason?: string;
  };
  
  // Ticket info
  qrCodeUrl: string;
  checkedIn: boolean;
  checkedInAt?: string;
  checkedInBy?: string;
}

export interface AdminStats {
  totalTables: number;
  bookedTables: number;
  availableTables: number;
  heldTables: number;
  totalSeats: number;
  bookedSeats: number;
  availableSeats: number;
  totalRevenue: number;
  pendingRevenue: number;
  pendingSlipsCount: number;
  checkedInCount: number;
}

export interface EventDetails {
  titleTh: string;
  titleEn: string;
  subtitleTh: string;
  subtitleEn: string;
  dateTh: string;
  dateEn: string;
  timeTh: string;
  timeEn: string;
  venueTh: string;
  venueEn: string;
  organizerTh: string;
  organizerEn: string;
  promptpayNumber: string;
  promptpayMobile: string;
  promptpayAccountName: string;
  bankName: string;
  bankAccountNumber: string;
  lockTimeoutMinutes: number;
}

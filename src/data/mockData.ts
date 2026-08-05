import { EventDetails, Table, ZoneType, Booking } from '../types';

export const initialEventDetails: EventDetails = {
  titleTh: 'มุทิตาจิต ภาควิชาเทคโนโลยีสารสนเทศ',
  titleEn: 'Mutita Ceremony, Department of Information Technology',
  subtitleTh: 'ขอเชิญร่วมย้อนวันวาน สืบสานความผูกพัน ภาควิชาเทคโนโลยีสารสนเทศ (Theme: 2499 อันธพาลครองเมือง)',
  subtitleEn: '30th Anniversary & Mutita Celebration Evening (Theme: Gangster 2499)',
  dateTh: 'วันที่ 19 กันยายน 2569',
  dateEn: 'September 19, 2026',
  timeTh: '16.00 - 21.00 น.',
  timeEn: '16:00 - 21:00',
  venueTh: 'ห้องพวงแสด คณะเทคโนโลยีและการจัดการอุตสาหกรรม',
  venueEn: 'Puang Saed Room, Faculty of Industrial Technology and Management',
  organizerTh: 'ภาควิชาเทคโนโลยีสารสนเทศ คณะเทคโนโลยีสารสนเทศ และการจัดการเทคโนโลยีอุตสาหกรรม มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ วิทยาเขตปราจีนบุรี',
  organizerEn: 'Department of Information Technology, Faculty of Information Technology and Industrial Technology Management, King Mongkut\'s University of Technology North Bangkok (Prachinburi Campus)',
  promptpayNumber: '004-64900071-0988', // PromptPay e-Wallet ID → QR source
  promptpayMobile: '064-182-3735',
  promptpayAccountName: 'ณัฏฐา สงวนศักดิ์',
  bankName: 'ธนาคารกสิกรไทย (K Bank)',
  bankAccountNumber: '137-3-88189-5',
  lockTimeoutMinutes: 10,
};

// Generate initial 70 tables layout (8 seats per table): 60 alumni + 10 student.
// โต๊ะอาจารย์ is a fixed decorative bar in SeatMap, not a numbered/bookable table.
// Tables 59 & 60 are reserved (closed) as the individual-ticket pool (2×8 = 16 seats).
export const generateInitialTables = (): Table[] => {
  const tables: Table[] = [];
  const studentTableNumbers = new Set([61, 62, 63, 64, 65, 66, 67, 68, 69, 70]);
  const reserveTableNumbers = new Set([59, 60]);

  for (let num = 1; num <= 70; num++) {
    const tableId = `T${num.toString().padStart(2, '0')}`;
    const isStudent = studentTableNumbers.has(num);
    const isReserve = reserveTableNumbers.has(num);

    const seats = Array.from({ length: 8 }, (_, i) => ({
      id: `${tableId}-S${i + 1}`,
      seatNumber: i + 1,
      status: 'available' as const,
      guestName: undefined,
    }));

    let tableName = `โต๊ะศิษย์เก่า ${num}`;
    let zone: ZoneType = 'alumni';
    let zoneLabelTh = 'รุ่นพี่ศิษย์เก่า';
    let zoneLabelEn = 'Alumni';
    let descTh = 'อาหาร + เครื่องดื่ม + ของที่ระลึก (ครบ 8 ที่นั่ง)';
    let descEn = 'Food + Drinks + Souvenir for all 8 seats';
    let pricePerTable = 5999;
    let pricePerSeat = 0; // ponytail: alumni เลือกที่ไม่ได้ — เหมาโต๊ะเท่านั้น (single seat 799 not sold in-app)

    if (isStudent) {
      tableName = `โต๊ะรุ่นน้อง ${num}`;
      zone = 'student';
      zoneLabelTh = 'รุ่นน้อง กำลังศึกษา';
      zoneLabelEn = 'Current Students';
      descTh = 'อาหาร + เครื่องดื่ม (ไม่มีของที่ระลึก) ราคาเหมา 3,499.- / โต๊ะ ไม่มีราคาเดี่ยว';
      descEn = 'Food + Drinks (no souvenir), flat rate 3,499 THB / table, no single seats';
      pricePerTable = 3499;
      pricePerSeat = 0;
    }

    tables.push({
      id: tableId,
      name: tableName,
      tableNumber: num,
      zone,
      zoneLabelTh,
      zoneLabelEn,
      pricePerTable,
      pricePerSeat,
      capacity: 8,
      seats,
      x: 0,
      y: 0,
      status: isReserve ? 'closed' : 'available',
      isReserve,
      descriptionTh: descTh,
      descriptionEn: descEn,
    });
  }

  return tables;
};

export const sampleBookings: Booking[] = [];

// ponytail: single source of truth for the table-less individual ticket price
export const INDIVIDUAL_PRICE = 799;

// Individual tickets are capped at 16 — tables 59+60 (8+8 seats) reserved as the pool.
export const INDIVIDUAL_CAPACITY = 16;


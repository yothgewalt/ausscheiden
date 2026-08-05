import React from 'react';
import { useBooking } from '../context/BookingContext';
import { INDIVIDUAL_PRICE, INDIVIDUAL_CAPACITY } from '../data/mockData';
import { MapPin, Users, ArrowRight, ShieldCheck, Shirt, Wine, AlertTriangle, ChevronRight, Check } from 'lucide-react';
import { motion } from 'motion/react';

interface EventPageProps {
  onSelectTableClick: () => void;
  onSelectZone: (zone: string) => void;
}

// ── ticket tiers, moved verbatim from the former PricingSection ──
const zones = [
{
    id: 'individual',
    titleTh: 'เดี่ยว (ศิษย์เก่า)',
    titleEn: 'Individual Ticket',
    priceTable: `฿${INDIVIDUAL_PRICE.toLocaleString()}`,
    priceSeat: '-',
    hasSeatOption: false,
    descTh: 'จองบัตรเข้าร่วมงานรายบุคคล 1 ท่าน (ไม่รวมการจองโต๊ะ) — ไม่ต้องเลือกโต๊ะ กรอกข้อมูลแล้วชำระเงินได้ทันที',
    descEn: 'Single individual attendee, no table booking. Skip the seat map — fill your info and pay directly.',
  },
  {
    id: 'alumni',
    titleTh: 'เหมาโต๊ะ 8 ที่นั่ง (ศิษย์เก่า)',
    titleEn: 'Alumni Zone',
    priceTable: '฿5,999',
    priceSeat: '-',
    hasSeatOption: false,
    descTh: 'สำหรับรุ่นพี่ศิษย์เก่า คณาจารย์ และบุคลากร อาหาร + เครื่องดื่ม + ของที่ระลึก ราคาเหมาทั้งโต๊ะ 8 ที่นั่ง',
    descEn: 'For alumni, faculty, and senior staff. Food + drinks + souvenir, flat rate per table (8 seats).',
  },
  {
    id: 'student',
    titleTh: 'เหมาโต๊ะ 8 ที่นั่ง (นักศึกษาปัจจุบัน)',
    titleEn: 'Current Students',
    priceTable: '฿3,499',
    priceSeat: '-',
    hasSeatOption: false,
    descTh: 'สำหรับกลุ่มนักศึกษาภาควิชาเทคโนโลยีสารสนเทศ ปัจจุบัน อาหาร + เครื่องดื่ม (ไม่มีของที่ระลึก) เหมาทั้งโต๊ะ 8 ที่นั่ง',
    descEn: 'Exclusive flat rate for current Information Technology students. Food + drinks, no souvenir (8 seats/table).',
  },
];

// ponytail: 12-entry map is enough; one fixed event, parsed from dateTh
const thaiMonthAbbr: Record<string, string> = {
  มกราคม: 'ม.ค.', กุมภาพันธ์: 'ก.พ.', มีนาคม: 'มี.ค.', เมษายน: 'เม.ย.',
  พฤษภาคม: 'พ.ค.', มิถุนายน: 'มิ.ย.', กรกฎาคม: 'ก.ค.', สิงหาคม: 'ส.ค.',
  กันยายน: 'ก.ย.', ตุลาคม: 'ต.ค.', พฤศจิกายน: 'พ.ย.', ธันวาคม: 'ธ.ค.',
};

// ── hosts shown in "ดำเนินการโดย" — edit names/colors as needed ──
const hosts = [
  { name: 'สโมสรภาควิชาเทคโนโลยีสารสนเทศ', color: '#6886dd' },
];

// ── event agenda, moved verbatim from the former EventInfoSection ──
const schedule = [
  { time: '16.00 น.', titleTh: 'ลงทะเบียนเข้าร่วมงานมุทิตาจิต ครบรอบ 30 ปี ภาควิชาฯ', titleEn: 'Registration & Welcome for 30th Anniversary Mutita Ceremony' },
  { time: '16.15 น.', titleTh: 'กิจกรรมกระชับความสัมพันธ์ระหว่างรุ่นพี่และรุ่นน้อง', titleEn: 'Alumni & Student Relationship Activities' },
  { time: '17.00 น.', titleTh: 'พิธีเปิดงาน', titleEn: 'Opening Ceremony' },
  { time: '17.30 น.', titleTh: 'พิธีมุทิตาจิตต่ออาจารย์ผู้เกษียณ', titleEn: 'Mutita Ceremony for Retired Faculty' },
  { time: '18.00 น.', titleTh: 'รับประทานอาหาร (โต๊ะจีนเริ่มเสิร์ฟอาหาร)', titleEn: 'Chinese Banquet Dinner Served' },
  { time: '18.30 น.', titleTh: 'กิจกรรมบนเวทีและการแสดงดนตรีสด', titleEn: 'Stage Performances & Live Music' },
  { time: '20.30 น.', titleTh: 'ช่วงเวลาอาจารย์พูดคุยพบปะกับศิษย์เก่า', titleEn: 'Faculty & Alumni Gathering Session' },
  { time: '21.00 น.', titleTh: 'ปิดงาน', titleEn: 'Event Closing' },
];

export const EventPage: React.FC<EventPageProps> = ({ onSelectZone }) => {
  const { eventDetails, tables, zoneAvailability } = useBooking();

  // A tier is full when its backing zone has zero available tables. 'individual' is
  // now table-backed too (zoneAvailability.individual = 16 − confirmed individuals).
  // Guard total>0 so we don't flash "เต็ม" before zoneAvailability loads.
  const isZoneFull = (zoneId: string) => {
    const z = zoneAvailability[zoneId];
    return !!z && z.total > 0 && z.available === 0;
  };

  // Live seat stats — identical derivation to the former LandingHero
  const { totalBookedSeats, availableSeats } = React.useMemo(() => {
    const totalCap = tables.reduce((s, t) => s + t.capacity, 0);
    const booked = tables.reduce((s, t) => s + t.seats.filter((x) => x.status === 'booked').length, 0);
    return { totalBookedSeats: booked, availableSeats: totalCap - booked };
  }, [tables]);

  // Parse "วันที่ 19 กันยายน 2569" → day "19", month "ก.ย." for the calendar tile
  const [dayNum, monthAbbr] = React.useMemo(() => {
    const m = eventDetails.dateTh.match(/(\d+)\s+(\S+)/);
    const day = m?.[1] ?? '';
    const month = m ? (thaiMonthAbbr[m[2]] ?? m[2]) : '';
    return [day, month];
  }, [eventDetails.dateTh]);

  // Registration ticket-type selection — defaults to first tier
  const [selectedZone, setSelectedZone] = React.useState(zones[0].id);

  return (
    <div className="max-w-[900px] mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <div className="flex flex-col lg:flex-row items-start gap-8 lg:gap-12">

        {/* ============ LEFT SIDEBAR (sticky) ============ */}
        <motion.aside
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="w-full lg:w-[300px] lg:shrink-0 lg:sticky lg:top-8 self-start space-y-5"
        >
          {/* Cover poster — 1:1, rounded-3xl, NO shadow. Photo + dark overlay for legible text. */}
          <div className="relative aspect-square rounded-lg overflow-hidden text-white">
            <img
              src="/images/front.jpg"
              alt="30 ปี ไอที: รีคอนเน็กต์"
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-black/10" />
            <div className="relative h-full flex flex-col items-center justify-center text-center p-8">
              <div className="font-display text-2xl sm:text-3xl font-[575] tracking-tight leading-tight drop-shadow-md">
                รีคอนเน็กต์
              </div>
              <div className="text-base text-white/80 drop-shadow">
                ไอทีฉลองครบรอบ 30 ปี
              </div>
              <div className="mt-3 text-sm text-white/70 drop-shadow">{eventDetails.dateTh}</div>
            </div>
          </div>

          {/* Presented by — avatar · label/org+chevron · Follow, luma-style */}
          <div className="flex items-center gap-3">
            <img
              src="/images/it_logo.jpg"
              alt={eventDetails.organizerTh}
              className="w-9 h-9 rounded-lg object-cover hairline shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-neutral-500">จัดโดย</div>
              <a
                href="https://www.facebook.com/IT.KMUTNB"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm font-medium text-primary leading-snug cursor-pointer hover:opacity-60"
              >
                <span>ภาควิชาเทคโนโลยีสารสนเทศ</span>
                <ChevronRight className="w-3 h-3 text-neutral-400 shrink-0" />
              </a>
            </div>
          </div>

          {/* Hosted By — avatar + name rows, luma-style */}
          <div className="pt-4 border-t-[0.5px] border-t-hairline space-y-3">
            <div className="text-base font-semibold text-primary">ดำเนินการโดย</div>
            <div className="space-y-2.5">
              {hosts.map((h) => (
                <div key={h.name} className="flex items-center gap-2.5">
                  <span
                    className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[14px] font-semibold text-white"
                    style={{ backgroundColor: h.color }}
                  >
                    {h.name.charAt(0)}
                  </span>
                  <span className="text-base font-medium text-primary">{h.name}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.aside>

        {/* ============ RIGHT MAIN COLUMN ============ */}
        <div className="w-full lg:flex-1 lg:min-w-0 space-y-6">

          {/* Title (the ONE h1) + subtitle */}
          <div className="space-y-2">
            <h1 className="font-display text-4xl sm:text-5xl md:text-[44px] font-[575] text-primary tracking-tight leading-[1.05]">
               30 ปี ไอที: รีคอนเน็กต์
            </h1>
          </div>

          {/* Date + Location — luma-style icon tiles */}
          <div className="space-y-4">
            {/* Date tile: calendar block (month strip + day) */}
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-lg bg-surface hairline overflow-hidden shrink-0 flex flex-col text-center">
                <div className="bg-neutral-200 text-[10.5px] font-semibold uppercase tracking-wide text-muted leading-none py-1">
                  {monthAbbr}
                </div>
                <div className="flex-1 flex items-center justify-center text-sm font-semibold text-primary leading-none">
                  {dayNum}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-primary leading-snug">{eventDetails.dateTh}</div>
                <div className="text-sm text-muted">{eventDetails.timeTh}</div>
              </div>
            </div>

            {/* Location tile: pin */}
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-lg bg-surface hairline shrink-0 flex items-center justify-center">
                <MapPin className="w-5 h-5 text-muted" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-primary leading-snug">สถานที่จัดงาน</div>
                <div className="text-sm text-muted leading-snug">{eventDetails.venueTh}</div>
              </div>
            </div>
          </div>

          {/* ===== REGISTRATION WIDGET — the ONE .card-shadow on the page ===== */}
          <div className="rounded-lg bg-surface card-shadow overflow-hidden">
            <div className="px-5 py-2 border-b-[0.5px] border-b-hairline">
              <span className="text-base font-bold text-primary">ลงทะเบียน</span>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-muted">เลือกประเภทบัตรที่ต้องการ</p>

              {/* ticket-tier radio rows — click to select, checked circle activates */}
              <div className="space-y-2.5">
                {zones.map((z) => {
                  const active = selectedZone === z.id;
                  const full = isZoneFull(z.id);
                  return (
                    <button
                      key={z.id}
                      onClick={() => !full && setSelectedZone(z.id)}
                      disabled={full}
                      className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                        full
                          ? 'bg-page opacity-60 cursor-not-allowed'
                          : active
                            ? 'bg-page ring-[1px] ring-primary cursor-pointer'
                            : 'bg-page border border-[rgba(20,20,20,0.24)] hover:bg-page/70 cursor-pointer'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={`w-5 h-5 rounded-full shrink-0 flex items-center justify-center transition-colors ${
                            active ? 'bg-primary text-white' : 'border border-[rgba(20,20,20,0.24)]'
                          }`}
                        >
                          {active && <Check className="w-3 h-3" strokeWidth={3} />}
                        </span>
                        <span className="flex flex-col min-w-0">
                          <span className={`text-sm truncate ${active ? 'font-semibold text-primary' : 'font-medium text-primary'}`}>
                            {z.titleTh}
                          </span>
                          {/* Live individual cap notice — falls back to full 16 before the query loads */}
                          {z.id === 'individual' && (
                            <span className="text-xs text-muted">
                              จำกัด {INDIVIDUAL_CAPACITY} ที่นั่ง · เหลือ {zoneAvailability.individual?.available ?? INDIVIDUAL_CAPACITY}
                            </span>
                          )}
                          {z.id === 'alumni' && (
                            <span className="text-xs text-muted">
                              อาหาร + เครื่องดื่ม + ของที่ระลึก · เหลือ {zoneAvailability.alumni?.available ?? 0} โต๊ะ
                            </span>
                          )}
                          {z.id === 'student' && (
                            <span className="text-xs text-muted">
                                อาหาร + เครื่องดื่ม (ไม่มีของที่ระลึก) · เหลือ {zoneAvailability.student?.available ?? 0} โต๊ะ
                            </span>
                          )}
                        </span>
                        {/* availability badge — green "ยังมีที่ว่าง" / red "เต็ม" when the zone is full */}
                        {full ? (
                          <span className="shrink-0 px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 text-[11px] font-medium">
                            เต็ม
                          </span>
                        ) : (
                          <span className="shrink-0 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 text-[11px] font-medium">
                            ยังมีที่ว่าง
                          </span>
                        )}
                      </span>
                      <span className={`shrink-0 text-sm font-mono font-semibold ${active ? 'text-primary' : 'text-primary/80'}`}>
                        {z.priceTable}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* primary CTA — neutral #141414, never amber → commits the selected tier */}
              <button
                onClick={() => onSelectZone(selectedZone)}
                className="w-full py-3 rounded-lg bg-primary hover:bg-primary/90 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer group"
              >
                <span>{selectedZone === 'individual' ? 'กรอกข้อมูลผู้จอง' : 'เลือกโต๊ะและดูผังที่นั่ง'}</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          </div>

          {/* ===== About Event — flat prose, hairline header rule, NO card ===== */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="space-y-4"
          >
            <h2 className="text-sm font-semibold text-primary hairline-b pb-2.5">เกี่ยวกับงาน</h2>
            <p className="text-base text-muted leading-relaxed">{eventDetails.subtitleTh}</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-5 pt-1">
              <div className="flex items-start gap-3">
                <Shirt className="w-5 h-5 text-muted shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-subtle">
                    ธีมการแต่งกาย
                  </div>
                  <div className="text-sm font-semibold text-primary mt-1">2499 อันธพาลครองเมือง</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Wine className="w-5 h-5 text-muted shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-subtle">
                    หมายเหตุเรื่องเครื่องดื่ม
                  </div>
                  <div className="text-sm text-muted mt-1 leading-relaxed">
                    เครื่องดื่มพิเศษที่ไม่ใช่น้ำเปล่าและน้ำอัดลม จะเป็นการขายทั้งหมดภายในงาน
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs sm:text-sm text-muted pt-1">
              <AlertTriangle className="w-4 h-4 text-muted shrink-0" />
              <span className="font-medium text-primary">หมายเหตุ:</span>
              <span>เมื่อซื้อบัตรแล้ว จะไม่สามารถคืนเงินได้</span>
            </div>
          </motion.section>

          {/* ===== Schedule — flat list, hairline header rule ===== */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="space-y-3"
          >
            <h2 className="text-sm font-semibold text-primary hairline-b pb-2.5">กำหนดการวันงาน</h2>
            {schedule.map((item, i) => (
              <div key={i} className="flex items-baseline gap-3.5">
                <span className="font-mono text-xs text-muted shrink-0 min-w-[64px]">{item.time}</span>
                <span className="text-sm text-primary leading-snug">{item.titleTh}</span>
              </div>
            ))}
          </motion.section>

          {/* ===== Location — venue prose + embedded Google Map ===== */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-primary hairline-b pb-2.5">สถานที่</h2>
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-muted shrink-0 mt-0.5" />
              <div className="text-sm text-primary leading-snug">{eventDetails.venueTh}</div>
            </div>
            <div className="rounded-lg overflow-hidden hairline">
              <iframe
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d4896.201646141703!2d101.34342437602731!3d14.159377086276283!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x311c52d45df19391%3A0xb7d8ac93e425b86f!2z4Lir4LmJ4Lit4LiH4Lie4Lin4LiH4LmB4Liq4LiUIOC4oeC4iOC4niDguJvguKPguLLguIjguLXguJnguJrguLjguKPguLU!5e1!3m2!1sth!2sth!4v1785906095164!5m2!1sth!2sth"
                className="w-full h-[280px]"
                style={{ border: 0 }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
                title="แผนที่สถานที่จัดงาน"
              />
            </div>
          </section>

        </div>
      </div>
    </div>
  );
};

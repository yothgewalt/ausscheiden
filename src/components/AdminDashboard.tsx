import React, { useState } from 'react';
import { useBooking } from '../context/BookingContext';
import { Table, Booking, ZoneType } from '../types';
import {
  Shield,
  Table as TableIcon,
  Users,
  CheckCircle2,
  AlertTriangle,
  QrCode,
  Download,
  Plus,
  Trash2,
  Search,
  Eye,
  Check,
  X,
  FileSpreadsheet,
  TrendingUp,
  DollarSign,
  RefreshCw,
  Edit,
  Clock,
} from 'lucide-react';

export const AdminDashboard: React.FC = () => {
  const {
    adminStats,
    tables,
    bookings,
    updateTableStatus,
    updateTablePrice,
    addTable,
    deleteTable,
    adminApproveSlip,
    adminRejectSlip,
    processCheckIn,
    userRole,
  } = useBooking();

  const [activeTab, setActiveTab] = useState<'overview' | 'tables' | 'bookings' | 'slips'>('overview');

  // Search & Filter
  const [bookingSearch, setBookingSearch] = useState('');
  const [selectedZone, setSelectedZone] = useState<ZoneType | 'all'>('all');

  // Table Manager Modal / Form
  const [newTableZone, setNewTableZone] = useState<ZoneType>('alumni');
  const [newTablePrice, setNewTablePrice] = useState<number>(6990);

  // Manual Check-in Scanner State
  const [scanCodeInput, setScanCodeInput] = useState('');
  const [scanResult, setScanResult] = useState<{ success: boolean; message: string; booking?: Booking } | null>(null);

  // Slip Inspector Modal State
  const [inspectSlipBooking, setInspectSlipBooking] = useState<Booking | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Filtered Bookings
  const filteredBookings = bookings.filter((b) => {
    const matchesSearch =
      !bookingSearch ||
      b.id.toLowerCase().includes(bookingSearch.toLowerCase()) ||
      b.buyerName.toLowerCase().includes(bookingSearch.toLowerCase()) ||
      b.phone.includes(bookingSearch) ||
      b.department.toLowerCase().includes(bookingSearch.toLowerCase());
    const matchesZone = selectedZone === 'all' || b.zone === selectedZone;
    return matchesSearch && matchesZone;
  });

  // Pending slips
  const pendingSlips = bookings.filter((b) => b.status === 'verifying_slip');

  // Handle Scan Submit
  const handleScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scanCodeInput.trim()) return;
    const res = processCheckIn(scanCodeInput, 'สตาฟฟ์ แอดมิน');
    setScanResult(res);
    setScanCodeInput('');
  };

  // Export CSV Helper
  const exportToCSV = () => {
    const headers = ['Booking ID', 'Buyer Name', 'Department', 'Phone', 'Table', 'Zone', 'Amount', 'Status', 'Checked In'];
    const rows = bookings.map((b) => [
      b.id,
      `"${b.buyerName}"`,
      `"${b.department}"`,
      b.phone,
      b.tableName ?? 'บัตรเดี่ยว',
      b.zone ?? 'individual',
      b.finalAmount,
      b.status,
      b.checkedIn ? 'Yes' : 'No',
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Retirement_Banquet_Report_2026.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const tabClass = (tab: typeof activeTab) =>
    `px-4 py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap ${
      activeTab === tab
        ? 'bg-primary text-white'
        : 'bg-surface hairline text-muted hover:text-primary'
    }`;

  return (
    <section className="py-8 bg-page text-primary min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">

        {/* Admin Title Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-6 bg-surface rounded-3xl hairline">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-page flex items-center justify-center text-primary">
              <Shield className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-primary">
                ระบบผู้จัดงานและแอดมิน (Admin Panel)
              </h2>
              <p className="text-xs text-muted mt-0.5">
                จัดการผังโต๊ะ อนุมัติสลิป และส่งออกรายงานการเงิน
              </p>
            </div>
          </div>

          <button
            onClick={exportToCSV}
            className="px-4 py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-white font-semibold text-xs transition-colors flex items-center gap-2 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>ส่งออกรายงาน Excel (CSV)</span>
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
          <button onClick={() => setActiveTab('overview')} className={tabClass('overview')}>
            <TrendingUp className="w-4 h-4" />
            <span>ภาพรวม (Dashboard)</span>
          </button>

          <button onClick={() => setActiveTab('tables')} className={tabClass('tables')}>
            <TableIcon className="w-4 h-4" />
            <span>จัดการผังโต๊ะ</span>
          </button>

          <button onClick={() => setActiveTab('bookings')} className={tabClass('bookings')}>
            <Users className="w-4 h-4" />
            <span>รายการจองทั้งหมด</span>
          </button>

          <button onClick={() => setActiveTab('slips')} className={`${tabClass('slips')} relative`}>
            <AlertTriangle className="w-4 h-4" />
            <span>ตรวจสลิป (Slip Queue)</span>
            {pendingSlips.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-accent text-white text-[10px] font-black flex items-center justify-center">
                {pendingSlips.length}
              </span>
            )}
          </button>
        </div>

        {/* TAB 1: OVERVIEW METRICS */}
        {activeTab === 'overview' && (
          <div className="space-y-6">

            {/* 4 Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 rounded-3xl bg-surface hairline">
                <div className="flex items-center justify-between text-muted text-xs">
                  <span>ยอดเงินโอนรวมสำเร็จ</span>
                  <DollarSign className="w-4 h-4 text-muted" />
                </div>
                <div className="text-2xl font-black text-primary font-mono mt-2">
                  ฿{adminStats.totalRevenue.toLocaleString()}
                </div>
                <div className="text-[11px] text-subtle mt-1">
                  + ฿{adminStats.pendingRevenue.toLocaleString()} รอตรวจสอบ
                </div>
              </div>

              <div className="p-5 rounded-3xl bg-surface hairline">
                <div className="flex items-center justify-between text-muted text-xs">
                  <span>จำนวนโต๊ะที่จองสำเร็จ</span>
                  <TableIcon className="w-4 h-4 text-muted" />
                </div>
                <div className="text-2xl font-black text-primary font-mono mt-2">
                  {adminStats.bookedTables} / {adminStats.totalTables} โต๊ะ
                </div>
                <div className="text-[11px] text-subtle mt-1">
                  {Math.round((adminStats.bookedTables / (adminStats.totalTables || 1)) * 100)}% ของพื้นที่จัดงาน
                </div>
              </div>

              <div className="p-5 rounded-3xl bg-surface hairline">
                <div className="flex items-center justify-between text-muted text-xs">
                  <span>ที่นั่งคงเหลือว่าง</span>
                  <Users className="w-4 h-4 text-muted" />
                </div>
                <div className="text-2xl font-black text-primary font-mono mt-2">
                  {adminStats.availableSeats} / {adminStats.totalSeats} ที่
                </div>
                <div className="text-[11px] text-subtle mt-1">
                  รองรับผู้ร่วมงานได้อีก
                </div>
              </div>

              <div className="p-5 rounded-3xl bg-surface hairline">
                <div className="flex items-center justify-between text-muted text-xs">
                  <span>ผู้ร่วมงานที่เช็คอินแล้ว</span>
                  <CheckCircle2 className="w-4 h-4 text-muted" />
                </div>
                <div className="text-2xl font-black text-primary font-mono mt-2">
                  {adminStats.checkedInCount} คน
                </div>
                <div className="text-[11px] text-subtle mt-1">
                  สแกน QR Code ประตูหน้างาน
                </div>
              </div>
            </div>

            {/* Zone breakdown table */}
            <div className="p-6 bg-surface hairline rounded-3xl space-y-4">
              <h3 className="text-sm font-bold text-primary uppercase tracking-wider">
                สรุปสถิติการจองแยกตามโซน
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left text-muted">
                  <thead className="text-subtle uppercase font-semibold hairline-b">
                    <tr>
                      <th className="p-3">โซน</th>
                      <th className="p-3">ราคา/โต๊ะ</th>
                      <th className="p-3">โต๊ะทั้งหมด</th>
                      <th className="p-3">จองสำเร็จ</th>
                      <th className="p-3">โต๊ะว่าง</th>
                      <th className="p-3 text-right">รายได้โซน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {['executive', 'alumni', 'student'].map((z) => {
                      const zoneTables = tables.filter((t) => t.zone === z);
                      const bookedCount = zoneTables.filter((t) => t.status === 'booked').length;
                      const totalRev = bookedCount * (zoneTables[0]?.pricePerTable || 0);

                      return (
                        <tr key={z} className="hairline-b hover:bg-page">
                          <td className="p-3 font-bold text-primary capitalize">
                            {z === 'executive' ? 'โซนอาจารย์' : z === 'alumni' ? 'โซนรุ่นพี่ศิษย์เก่า' : 'โซนรุ่นน้องกำลังศึกษา'}
                          </td>
                          <td className="p-3 font-mono">฿{zoneTables[0]?.pricePerTable.toLocaleString()}</td>
                          <td className="p-3 font-mono">{zoneTables.length} โต๊ะ</td>
                          <td className="p-3 font-mono text-primary font-bold">{bookedCount} โต๊ะ</td>
                          <td className="p-3 font-mono">{zoneTables.length - bookedCount} โต๊ะ</td>
                          <td className="p-3 font-mono font-bold text-primary text-right">฿{totalRev.toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* TAB 2: MANAGE TABLES */}
        {activeTab === 'tables' && (
          <div className="space-y-6">

            {/* Add Table Controls */}
            <div className="p-5 bg-surface hairline rounded-3xl flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <select
                  value={newTableZone}
                  onChange={(e) => setNewTableZone(e.target.value as ZoneType)}
                  className="bg-page hairline rounded-lg px-3 py-2 text-xs text-primary cursor-pointer"
                >
                  <option value="executive">โซนอาจารย์</option>
                  <option value="alumni">โซนรุ่นพี่ศิษย์เก่า</option>
                  <option value="student">โซนรุ่นน้องกำลังศึกษา</option>
                </select>

                <input
                  type="number"
                  placeholder="ราคาโต๊ะ (บาท)"
                  value={newTablePrice}
                  onChange={(e) => setNewTablePrice(Number(e.target.value))}
                  className="bg-page hairline rounded-lg px-3 py-2 text-xs text-primary w-32 font-mono"
                />

                <button
                  onClick={() => addTable(newTableZone, newTablePrice)}
                  className="px-4 py-2 bg-primary hover:bg-primary/90 text-white font-semibold text-xs rounded-lg flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>เพิ่มโต๊ะใหม่</span>
                </button>
              </div>

              <div className="text-xs text-muted">
                {`จำนวนโต๊ะรวมทั้งหมด: ${tables.length} โต๊ะ`}
              </div>
            </div>

            {/* Tables Grid Admin */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {tables.map((t) => (
                <div key={t.id} className="p-4 bg-surface hairline rounded-3xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-bold text-primary text-base">{t.name}</div>
                      <div className="text-[11px] text-muted">{t.zoneLabelTh}</div>
                    </div>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                        t.status === 'booked'
                          ? 'bg-page text-subtle'
                          : t.status === 'held'
                          ? 'bg-accent/10 text-accent'
                          : 'bg-page text-muted'
                      }`}
                    >
                      {t.status === 'booked' ? 'จองเต็ม' : t.status === 'held' ? 'รอชำระ' : 'ว่าง'}
                    </span>
                  </div>

                  <div className="text-xs font-mono text-primary font-bold">
                    ฿{t.pricePerTable.toLocaleString()} / โต๊ะ ({t.capacity} ที่นั่ง)
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-2 hairline-b border-b-0">
                    <button
                      onClick={() => updateTableStatus(t.id, t.status === 'booked' ? 'available' : 'booked')}
                      className="px-3 py-1.5 rounded-lg bg-page hairline hover:bg-[#141414]/[0.04] text-xs font-semibold text-muted cursor-pointer transition-colors"
                    >
                      {t.status === 'booked' ? 'ปลดสิทธิ์' : 'มาร์คว่าจองแล้ว'}
                    </button>

                    <button
                      onClick={() => deleteTable(t.id)}
                      className="p-1.5 rounded-lg bg-page hairline hover:bg-[#141414]/[0.04] text-muted cursor-pointer ml-auto transition-colors"
                      title="ลบโต๊ะ"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

          </div>
        )}

        {/* TAB 3: BOOKINGS LIST */}
        {activeTab === 'bookings' && (
          <div className="space-y-4">

            {/* Search Filter Bar */}
            <div className="p-4 bg-surface hairline rounded-3xl flex flex-wrap gap-3 items-center justify-between">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="w-4 h-4 text-subtle absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="ค้นหาชื่อผู้จอง, รหัสจอง, เบอร์โทร..."
                  value={bookingSearch}
                  onChange={(e) => setBookingSearch(e.target.value)}
                  className="w-full bg-page hairline rounded-lg pl-9 pr-3 py-2 text-xs text-primary placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-primary/15"
                />
              </div>

              <select
                value={selectedZone}
                onChange={(e) => setSelectedZone(e.target.value as ZoneType | 'all')}
                className="bg-page hairline rounded-lg px-3 py-2 text-xs text-primary cursor-pointer"
              >
                <option value="all">ทุกโซน</option>
                <option value="executive">โซนอาจารย์</option>
                <option value="alumni">โซนศิษย์เก่า</option>
                <option value="student">โซนนศ.</option>
              </select>
            </div>

            {/* Bookings Table */}
            <div className="bg-surface hairline rounded-3xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left text-muted">
                  <thead className="text-subtle uppercase font-semibold hairline-b">
                    <tr>
                      <th className="p-3">รหัสจอง</th>
                      <th className="p-3">ชื่อผู้จอง / หน่วยงาน</th>
                      <th className="p-3">โต๊ะ</th>
                      <th className="p-3">ยอดเงิน</th>
                      <th className="p-3">สถานะสลิป</th>
                      <th className="p-3">เช็คอิน</th>
                      <th className="p-3 text-right">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBookings.map((b) => (
                      <tr key={b.id} className="hairline-b hover:bg-page">
                        <td className="p-3 font-mono font-bold text-primary">{b.id}</td>
                        <td className="p-3">
                          <div className="font-bold text-primary">{b.buyerName}</div>
                          <div className="text-[11px] text-muted">{b.department} • {b.phone}</div>
                        </td>
                        <td className="p-3 font-bold text-primary">{b.tableName ?? 'บัตรเดี่ยว'}</td>
                        <td className="p-3 font-mono font-bold text-primary">฿{b.finalAmount.toLocaleString()}</td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              b.status === 'confirmed'
                                ? 'bg-page text-primary'
                                : b.status === 'verifying_slip'
                                ? 'bg-accent/10 text-accent'
                                : 'bg-page text-subtle'
                            }`}
                          >
                            {b.status === 'confirmed' ? 'ผ่าน' : b.status === 'verifying_slip' ? 'รอตรวจ' : 'ปฏิเสธ'}
                          </span>
                        </td>
                        <td className="p-3 font-mono text-[11px]">
                          {b.checkedIn ? (
                            <span className="text-primary flex items-center gap-1"><Check className="w-3.5 h-3.5" />เช็คอินแล้ว</span>
                          ) : (
                            <span className="text-subtle">ยังไม่เช็คอิน</span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => setInspectSlipBooking(b)}
                            className="p-1.5 rounded-lg bg-page hairline hover:bg-[#141414]/[0.04] text-muted cursor-pointer transition-colors"
                            title="ดูสลิป"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* TAB 4: SLIP AUDIT QUEUE */}
        {activeTab === 'slips' && (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-primary uppercase tracking-wider flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-accent" />
              <span>คิวสลิปที่รอแอดมินอนุมัติแบบ Manual ({pendingSlips.length} รายการ)</span>
            </h3>

            {pendingSlips.length === 0 ? (
              <div className="p-8 bg-surface hairline rounded-3xl text-center text-muted">
                <CheckCircle2 className="w-10 h-10 text-muted mx-auto mb-2" />
                <p>ไม่มีสลิปตกค้างในคิว ระบบตรวจสอบสลิปอัตโนมัติทำงานเรียบร้อยครบถ้วน</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {pendingSlips.map((b) => (
                  <div key={b.id} className="p-5 bg-surface hairline rounded-3xl space-y-4">
                    <div className="flex items-center justify-between hairline-b pb-3">
                      <div>
                        <div className="font-bold text-primary font-mono text-sm">{b.id}</div>
                        <div className="font-bold text-primary">{b.buyerName} ({b.tableName ?? 'บัตรเดี่ยว'})</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-muted">ยอดที่ต้องชำระ</div>
                        <div className="font-mono font-bold text-primary text-sm">฿{b.finalAmount.toLocaleString()}</div>
                      </div>
                    </div>

                    {b.slipImage && (
                      <div className="h-44 bg-page rounded-lg overflow-hidden hairline">
                        <img src={b.slipImage} alt="Slip" className="w-full h-full object-cover" />
                      </div>
                    )}

                    {b.slipVerificationResult?.failureReason && (
                      <div className="p-3 bg-page rounded-lg text-muted text-xs flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                        <span>สาเหตุที่ไม่ผ่านอัตโนมัติ: {b.slipVerificationResult.failureReason}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-2">
                      <button
                        onClick={() => adminRejectSlip(b.id, 'สลิปไม่สมบูรณ์')}
                        className="px-4 py-2 rounded-lg bg-surface hairline hover:bg-page text-muted text-xs font-bold cursor-pointer flex items-center gap-1 transition-colors"
                      >
                        <X className="w-4 h-4" />
                        <span>ปฏิเสธสลิป</span>
                      </button>

                      <button
                        onClick={() => adminApproveSlip(b.id)}
                        className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white text-xs font-bold cursor-pointer flex items-center gap-1 transition-colors"
                      >
                        <Check className="w-4 h-4" />
                        <span>อนุมัติผ่าน (Manual Approve)</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Slip Inspector Modal */}
      {inspectSlipBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#141414]/40 backdrop-blur-sm">
          <div className="bg-surface rounded-3xl card-shadow p-6 max-w-lg w-full space-y-4">
            <div className="flex items-center justify-between hairline-b pb-3">
              <h3 className="font-bold text-primary">ตรวจสอบสลิป {inspectSlipBooking.id}</h3>
              <button onClick={() => setInspectSlipBooking(null)} className="p-1 text-muted hover:text-primary">
                <X className="w-5 h-5" />
              </button>
            </div>

            {inspectSlipBooking.slipImage && (
              <img src={inspectSlipBooking.slipImage} alt="Slip" className="w-full h-56 object-cover rounded-lg hairline" />
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  adminRejectSlip(inspectSlipBooking.id, 'สลิปไม่ผ่านการตรวจสอบ');
                  setInspectSlipBooking(null);
                }}
                className="px-4 py-2 bg-surface hairline hover:bg-page text-muted font-bold rounded-lg text-xs transition-colors"
              >
                ปฏิเสธ
              </button>
              <button
                onClick={() => {
                  adminApproveSlip(inspectSlipBooking.id);
                  setInspectSlipBooking(null);
                }}
                className="px-4 py-2 bg-primary hover:bg-primary/90 text-white font-bold rounded-lg text-xs transition-colors"
              >
                อนุมัติสลิป
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

// Dữ liệu mẫu cho test Module B/D/E (tiện ích, booking, hóa đơn). Dùng cùng helpers/db.js + fixtures.js.
import { Amenity, Booking, Invoice } from '../../src/models/index.js';
import { addMinutes, startOfVnDay } from '../../src/utils/time.js';

let seq = 0;
const next = () => (seq += 1);

export function createAmenity(extra = {}) {
  return Amenity.create({
    name: `Sân ${next()}`,
    accessMode: 'BOOKING',
    openTime: '06:00',
    closeTime: '22:00',
    slotDurationMinutes: 60,
    capacityPerSlot: 2,
    feePerBooking: 50000,
    ...extra,
  });
}

/** Booking với slot bắt đầu tại `startAt` (Date), dài 60 phút */
export function createBooking({ amenity, apartment, startAt, status = 'APPROVED', fee = 50000, ...extra }) {
  const endAt = addMinutes(startAt, 60);
  const hhmm = (d) => new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(11, 16);
  return Booking.create({
    amenityId: amenity._id,
    apartmentId: apartment._id,
    date: startOfVnDay(startAt),
    slotStart: hhmm(startAt),
    slotEnd: hhmm(endAt),
    startAt,
    endAt,
    fee,
    status,
    ...extra,
  });
}

export function createInvoice({ apartment, status = 'UNPAID', dueDate, period = '2026-10', ...extra }) {
  return Invoice.create({
    code: `HD-TEST-${String(next()).padStart(5, '0')}`,
    apartmentId: apartment._id,
    buildingId: apartment.buildingId,
    period,
    items: [{ feeCategory: 'CLEANING', description: 'Phí vệ sinh', quantity: 1, unitPrice: 100000, amount: 100000 }],
    totalAmount: 100000,
    status,
    issuedAt: new Date('2026-10-01T00:00:00Z'),
    dueDate,
    ...extra,
  });
}

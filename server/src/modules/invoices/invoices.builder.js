// UC-B02 — Tính dòng phí của hóa đơn kỳ P (chỉ đọc, không ghi): dùng chung cho xem trước, sinh thủ công và cron.
// Phí vệ sinh, gửi xe tính cho chính kỳ P (thu trước); phí tiện ích phát sinh trong kỳ P−1 (thu sau).
import {
  AMENITY_PASS_STATUS,
  BOOKING_BILLABLE_STATUSES,
  FEE_CALC_METHODS,
  FEE_CATEGORIES,
  VISIT_STATUS,
} from '../../constants/enums.js';
import { AmenityPass, AmenityVisit, Booking } from '../../models/index.js';
import { getPayer } from '../contracts/contracts.queries.js';
import { getBillableVehicles } from '../vehicles/vehicles.queries.js';
import { ApiError } from '../../utils/ApiError.js';
import { fmtDateVn, periodEnd, periodLabel, periodStart, shiftPeriod } from '../../utils/time.js';


// feeCode cho dòng tiện ích — phân biệt nguồn khi truy vết refId
export const AMENITY_FEE_CODES = Object.freeze({
  PASS: 'AMENITY_PASS',
  VISIT: 'AMENITY_VISIT',
  BOOKING: 'AMENITY_BOOKING',
});

const dayLabel = (date) => fmtDateVn(date).slice(0, 5); // "DD/MM"

/** Mã hóa đơn gốc HD-YYYYMM-<mã tòa>-<mã căn> (mã căn chỉ unique trong 1 tòa) */
export const baseInvoiceCode = (period, buildingCode, apartmentCode) =>
  `HD-${period.replace('-', '')}-${buildingCode}-${apartmentCode}`;

const amenityName = (doc) => doc.amenityId?.name ?? 'Tiện ích';
const personName = (doc, path = 'userId') => doc[path]?.fullName;
const withPerson = (text, name) => (name ? `${text} – ${name}` : text);

const item = (feeCategory, feeCode, description, quantity, unitPrice, refId = null) => ({
  feeCategory,
  feeCode,
  description,
  quantity,
  unitPrice,
  amount: Math.round(quantity * unitPrice), // VNĐ nguyên; diện tích lẻ vd 72.5 m²
  refId,
});

/** Dòng phí theo căn: mọi mức giá không phải gửi xe (PER_M2 theo diện tích, PER_APARTMENT cố định) — BR-F4 */
function apartmentItems(apartment, prices) {
  const items = [];
  for (const fee of prices.values()) {
    if (fee.calcMethod === FEE_CALC_METHODS.PER_M2) {
      items.push(item(fee.feeCategory, fee.code, `${fee.name} ${apartment.area}m²`, apartment.area, fee.unitPrice));
    } else if (fee.calcMethod === FEE_CALC_METHODS.PER_APARTMENT) {
      items.push(item(fee.feeCategory, fee.code, fee.name, 1, fee.unitPrice));
    }
  }
  return items;
}

/** Mỗi xe tính phí kỳ P (BR-F5) 1 dòng, giá theo mã phí gửi xe của loại xe. Thiếu giá → lỗi rõ ràng, không tính 0đ */
async function parkingItems(apartment, period, prices) {
  const byType = new Map(
    [...prices.values()].filter((f) => f.calcMethod === FEE_CALC_METHODS.PER_VEHICLE).map((f) => [f.vehicleType, f]),
  );
  const vehicles = await getBillableVehicles(apartment._id, period);
  return vehicles.map((v) => {
    const fee = byType.get(v.type);
    if (!fee) throw new ApiError('FEE_PRICE_MISSING', `Chưa có đơn giá gửi xe loại ${v.type} cho kỳ ${periodLabel(period)}`);
    return item(FEE_CATEGORIES.PARKING, fee.code, `${fee.name} ${v.plateNumber}`, 1, fee.unitPrice, v._id);
  });
}

/**
 * Phí tiện ích phát sinh trong kỳ `prev` chưa gộp hóa đơn (invoiceId null) do Module D ghi:
 * gói tháng (month = prev), vé lẻ (billingMonth = prev), booking có phí (ngày đặt thuộc prev).
 * Trả về các dòng + id bản ghi để gắn invoiceId khi lưu.
 */
export async function collectAmenityCharges(apartmentId, prev) {
  const unbilled = { apartmentId, fee: { $gt: 0 }, invoiceId: null };
  const [passes, visits, bookings] = await Promise.all([
    AmenityPass.find({ ...unbilled, month: prev, status: AMENITY_PASS_STATUS.ACTIVE })
      .populate('amenityId', 'name')
      .populate('userId', 'fullName')
      .sort({ createdAt: 1 })
      .lean(),
    AmenityVisit.find({ ...unbilled, billingMonth: prev, status: VISIT_STATUS.VALID })
      .populate('amenityId', 'name')
      .populate('userId', 'fullName')
      .sort({ visitedAt: 1 })
      .lean(),
    Booking.find({
      ...unbilled,
      status: { $in: BOOKING_BILLABLE_STATUSES },
      paidAt: null, // đã thanh toán trước khi đặt (giữ chỗ chờ thanh toán) thì không thu lại trên hóa đơn
      date: { $gte: periodStart(prev), $lt: periodEnd(prev) },
    })
      .populate('amenityId', 'name')
      .sort({ date: 1, slotStart: 1 })
      .lean(),
  ]);

  const items = [
    ...passes.map((p) =>
      item(
        FEE_CATEGORIES.AMENITY,
        AMENITY_FEE_CODES.PASS,
        withPerson(`Gói tháng ${amenityName(p)} ${periodLabel(prev)}`, personName(p)),
        1,
        p.fee,
        p._id,
      ),
    ),
    ...visits.map((v) =>
      item(
        FEE_CATEGORIES.AMENITY,
        AMENITY_FEE_CODES.VISIT,
        withPerson(`Vé lẻ ${amenityName(v)} ${dayLabel(v.visitedAt)}`, personName(v)),
        1,
        v.fee,
        v._id,
      ),
    ),
    ...bookings.map((b) =>
      item(
        FEE_CATEGORIES.AMENITY,
        AMENITY_FEE_CODES.BOOKING,
        `Đặt ${amenityName(b)} ${dayLabel(b.date)} ${b.slotStart}–${b.slotEnd}`,
        1,
        b.fee,
        b._id,
      ),
    ),
  ];
  return {
    items,
    passIds: passes.map((p) => p._id),
    visitIds: visits.map((v) => v._id),
    bookingIds: bookings.map((b) => b._id),
  };
}

/**
 * Bản nháp hóa đơn kỳ `period` cho 1 căn (apartment cần có buildingId đã populate `code`).
 * Căn chưa có hợp đồng mua bán hiệu lực → payer null, không có dòng phí (bỏ qua khi sinh).
 * @param {Map<string, object>} prices bảng giá kỳ `period` (getPriceTable)
 */
export async function buildInvoiceDraft(apartment, period, prices) {
  const building = apartment.buildingId;
  const base = {
    apartmentId: apartment._id,
    apartmentCode: apartment.code,
    buildingId: building._id,
    buildingCode: building.code,
    period,
    code: baseInvoiceCode(period, building.code, apartment.code),
  };

  // BR-F7: người trả tại đầu kỳ
  const payer = await getPayer(apartment._id, periodStart(period));
  if (!payer) return { ...base, payer: null, items: [], totalAmount: 0, charges: null };

  const charges = await collectAmenityCharges(apartment._id, shiftPeriod(period, -1));
  const items = [...apartmentItems(apartment, prices), ...(await parkingItems(apartment, period, prices)), ...charges.items];
  return {
    ...base,
    payer,
    items,
    totalAmount: items.reduce((s, i) => s + i.amount, 0),
    charges: { passIds: charges.passIds, visitIds: charges.visitIds, bookingIds: charges.bookingIds },
  };
}

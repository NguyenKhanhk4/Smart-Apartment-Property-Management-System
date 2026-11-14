// UC-B02 — Tính dòng phí của hóa đơn kỳ P (chỉ đọc, không ghi): dùng chung cho xem trước, sinh thủ công và cron.
// Phí quản lý, gửi xe tính cho chính kỳ P (thu trước, theo số ngày thực tế); truy thu / hoàn phí xe kỳ P−1 khi xe
// đăng ký / gỡ sau lúc tính; phí tiện ích phát sinh trong kỳ P−1 (thu sau);
// chi phí sửa chữa trong căn của phiếu đã nghiệm thu trước đầu kỳ P mà chưa tính (UC48);
// ± khoản điều chỉnh của các thông báo kỳ trước đã phát hành (M4-5).
import {
  ADJUSTMENT_STATUS,
  APARTMENT_OCCUPANCY,
  BOOKING_BILLABLE_STATUSES,
  FEE_CALC_METHODS,
  FEE_CATEGORIES,
  INVOICE_PUBLISHED_STATUSES,
  QUOTE_STATUS,
  TICKET_STATUS,
} from '../../constants/enums.js';
import { Booking, Invoice, InvoiceAdjustment, RepairQuote } from '../../models/index.js';
import { getPayer } from '../contracts/contracts.queries.js';
import { getPriceTable } from '../feeTypes/feeTypes.queries.js';
import { getBillableVehicles } from '../vehicles/vehicles.queries.js';
import { managementAreaAt } from '../apartments/managementArea.js';
import { ApiError } from '../../utils/ApiError.js';
import { DAY_MS, fmtDateVn, periodEnd, periodLabel, periodStart, shiftPeriod, startOfVnDay } from '../../utils/time.js';


// feeCode cho dòng tiện ích — phân biệt nguồn khi truy vết refId
export const AMENITY_FEE_CODES = Object.freeze({
  BOOKING: 'AMENITY_BOOKING',
});

const dayLabel = (date) => fmtDateVn(date).slice(0, 5); // "DD/MM"

/** Mã hóa đơn gốc HD-YYYYMM-<mã tòa>-<mã căn> (mã căn chỉ unique trong 1 tòa) */
export const baseInvoiceCode = (period, buildingCode, apartmentCode) =>
  `HD-${period.replace('-', '')}-${buildingCode}-${apartmentCode}`;

const amenityName = (doc) => doc.amenityId?.name ?? 'Tiện ích';

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
function apartmentItems(apartment, prices, daysInPeriod, billableDays, managementArea) {
  const items = [];
  for (const fee of prices.values()) {
    if (fee.feeCategory === FEE_CATEGORIES.MANAGEMENT) {
      if (!apartment.handoverDate || fee.code !== `MANAGEMENT_${apartment.type}`) continue;
      if (!(managementArea > 0)) {
        throw ApiError.field('netArea', 'Cần diện tích tính phí quản lý');
      }
      items.push(item(
        fee.feeCategory,
        fee.code,
        `${fee.name} (${managementArea} m² × ${billableDays}/${daysInPeriod} ngày)`,
        managementArea * billableDays / daysInPeriod,
        fee.unitPrice,
      ));
    } else if (fee.calcMethod === FEE_CALC_METHODS.PER_M2) {
      items.push(item(fee.feeCategory, fee.code, `${fee.name} ${apartment.area}m²`, apartment.area, fee.unitPrice));
    } else if (fee.calcMethod === FEE_CALC_METHODS.PER_APARTMENT) {
      items.push(item(fee.feeCategory, fee.code, fee.name, 1, fee.unitPrice));
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Phí gửi xe theo số ngày thực tế (Mô đun 4: xe đăng ký mới / gỡ xe / bàn giao giữa tháng).
// Phí thu trước: thông báo kỳ P tính lúc đầu kỳ nên chưa biết xe duyệt / gỡ sau đó. Thông báo kỳ P+1 đối chiếu số ngày đã tính
// trên thông báo kỳ P đã phát hành với số ngày thực tế → dòng "Truy thu" (thiếu) / "Hoàn" (thừa). Mỗi kỳ chỉ đối chiếu kỳ ngay trước.
// ---------------------------------------------------------------------------
export const PARKING_CORRECTION_FEE_CODE = 'PARKING_CORRECTION';
const QTY_EPSILON = 1e-9;

/** Số ngày xe được gửi trong [from, to): tính cả ngày duyệt, phí dừng từ ngày gỡ (không tính ngày gỡ) — theo ngày giờ VN */
export function vehicleDays(vehicle, from, to) {
  const s = Math.max(from.getTime(), startOfVnDay(new Date(vehicle.approvedAt)).getTime());
  const e = Math.min(to.getTime(), vehicle.cancelledAt ? startOfVnDay(new Date(vehicle.cancelledAt)).getTime() : to.getTime());
  return Math.max(0, Math.round((e - s) / DAY_MS));
}

const parkingFees = (prices) =>
  new Map([...prices.values()].filter((f) => f.calcMethod === FEE_CALC_METHODS.PER_VEHICLE).map((f) => [f.vehicleType, f]));

const missingPrice = (type, period) => new ApiError('FEE_PRICE_MISSING', `Chưa có đơn giá gửi xe loại ${type} cho kỳ ${periodLabel(period)}`);

/**
 * Mỗi xe có ngày gửi trong kỳ P: 1 dòng, số lượng = số ngày / số ngày của kỳ (đủ tháng = 1), giá theo loại xe.
 * `billFrom`: ngày bắt đầu tính phí của căn (bàn giao giữa kỳ). Thiếu giá → lỗi rõ ràng, không tính 0đ.
 */
async function parkingItems(apartment, period, prices, billFrom) {
  const byType = parkingFees(prices);
  const end = periodEnd(period);
  const daysInPeriod = Math.round((end - periodStart(period)) / DAY_MS);
  const vehicles = await getBillableVehicles(apartment._id, period);
  const items = [];
  for (const v of vehicles) {
    const days = vehicleDays(v, billFrom, end);
    if (!days) continue;
    const fee = byType.get(v.type);
    if (!fee) throw missingPrice(v.type, period);
    const label = days === daysInPeriod ? `${fee.name} ${v.plateNumber}` : `${fee.name} ${v.plateNumber} (${days}/${daysInPeriod} ngày)`;
    items.push(item(FEE_CATEGORIES.PARKING, fee.code, label, days / daysInPeriod, fee.unitPrice, v._id));
  }
  return items;
}

/**
 * Đối chiếu phí xe kỳ trước `prev` = P−1 trên các thông báo đã phát hành của căn: số ngày thực tế (theo approvedAt / cancelledAt
 * hiện tại) − số ngày đã tính → dòng điều chỉnh (dương: truy thu, âm: hoàn), giá = đơn giá đã tính kỳ đó (xe chưa tính thì
 * giá kỳ đó). Kỳ trước chưa phát hành / không có thông báo thì không đối chiếu (Nháp kỳ trước tự tính lại đúng số ngày).
 */
async function parkingCorrections(apartment, period, prices) {
  const prev = shiftPeriod(period, -1);
  const prevInvoices = await Invoice.find({ apartmentId: apartment._id, period: prev, status: { $in: INVOICE_PUBLISHED_STATUSES } })
    .select('items')
    .lean();
  if (!prevInvoices.length) return [];

  const billed = new Map(); // vehicleId → { qty, unitPrice }
  for (const it of prevInvoices.flatMap((inv) => inv.items)) {
    if (it.feeCategory !== FEE_CATEGORIES.PARKING || !it.refId || it.feeCode === PARKING_CORRECTION_FEE_CODE) continue;
    const key = String(it.refId);
    const b = billed.get(key) ?? { qty: 0, unitPrice: it.unitPrice };
    b.qty += it.quantity;
    billed.set(key, b);
  }

  const start = periodStart(prev);
  const end = periodEnd(prev);
  const daysInPrev = Math.round((end - start) / DAY_MS);
  const handover = apartment.handoverDate ? startOfVnDay(new Date(apartment.handoverDate)) : null;
  const from = handover && handover > start ? handover : start;
  const vehicles = await getBillableVehicles(apartment._id, prev, { ids: [...billed.keys()] });

  let prevPrices = null; // chỉ tải bảng giá kỳ trước khi có xe chưa từng tính
  const items = [];
  for (const v of vehicles) {
    const actual = vehicleDays(v, from, end);
    const b = billed.get(String(v._id));
    const diffQty = actual / daysInPrev - (b?.qty ?? 0);
    if (Math.abs(diffQty) < QTY_EPSILON) continue;

    let unitPrice = b?.unitPrice;
    const name = parkingFees(prices).get(v.type)?.name ?? 'Phí gửi xe';
    if (unitPrice == null) {
      prevPrices ??= parkingFees(await getPriceTable(prev));
      const fee = prevPrices.get(v.type);
      if (!fee) throw missingPrice(v.type, prev);
      unitPrice = fee.unitPrice;
    }
    const diffDays = Math.round(Math.abs(diffQty) * daysInPrev);
    const reason = diffQty > 0 ? `đăng ký ${dayLabel(v.approvedAt)}` : v.cancelledAt ? `gỡ xe ${dayLabel(v.cancelledAt)}` : 'tính thừa';
    const label = `${diffQty > 0 ? 'Truy thu' : 'Hoàn'} ${name.toLowerCase()} ${v.plateNumber} kỳ ${periodLabel(prev)} (${diffDays} ngày, ${reason})`;
    const line = item(FEE_CATEGORIES.PARKING, PARKING_CORRECTION_FEE_CODE, label, diffQty, unitPrice, v._id);
    if (line.amount !== 0) items.push(line);
  }
  return items;
}

/**
 * Phí tiện ích phát sinh trong kỳ `prev` chưa gộp hóa đơn (invoiceId null): booking có phí chưa trả online
 * (Lễ tân đặt hộ tại quầy, hoặc lúc chưa cấu hình payOS) có ngày đặt thuộc kỳ prev. Booking đã trả qua payOS có paidAt nên không tính lại.
 * Trả về các dòng + id bản ghi để gắn invoiceId khi lưu.
 * `invoiceId`: khi tính lại 1 thông báo Nháp, lấy cả bản ghi đã gắn vào chính thông báo đó.
 */
export async function collectAmenityCharges(apartmentId, prev, { invoiceId = null } = {}) {
  const unbilled = { apartmentId, fee: { $gt: 0 }, invoiceId: invoiceId ? { $in: [null, invoiceId] } : null };
  const [bookings] = await Promise.all([
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
    bookingIds: bookings.map((b) => b._id),
  };
}

export const REPAIR_FEE_CODE = 'REPAIR';

/**
 * Chi phí sửa chữa trong căn (UC48): báo giá đã đồng ý (bản ACCEPTED hiện hành) của phiếu sự cố Đã nghiệm thu (CLOSED)
 * trước 00:00 ngày đầu kỳ `period`, chưa gộp vào thông báo nào (invoiceId null) → tính vào kỳ `period` ("kỳ tiếp theo").
 * Phiếu bị từ chối / chưa nghiệm thu không tính. `invoiceId`: tính lại thông báo Nháp thì lấy cả bản đã gắn vào chính nó.
 */
export async function collectRepairCharges(apartmentId, period, { invoiceId = null } = {}) {
  const quotes = await RepairQuote.find({
    apartmentId,
    status: QUOTE_STATUS.ACCEPTED,
    invoiceId: invoiceId ? { $in: [null, invoiceId] } : null,
  })
    .populate('ticketId', 'code title status closedAt')
    .sort({ sentAt: 1 })
    .lean();
  const cutoff = periodStart(period);
  const billable = quotes.filter(
    (q) => q.ticketId?.status === TICKET_STATUS.CLOSED && q.ticketId.closedAt && new Date(q.ticketId.closedAt) < cutoff,
  );
  return {
    items: billable.map((q) =>
      item(
        FEE_CATEGORIES.REPAIR,
        REPAIR_FEE_CODE,
        `Sửa chữa: ${q.ticketId.title} (${q.ticketId.code}, nghiệm thu ${dayLabel(q.ticketId.closedAt)})`,
        1,
        q.totalAmount,
        q._id,
      ),
    ),
    repairQuoteIds: billable.map((q) => q._id),
  };
}

export const ADJUSTMENT_FEE_CODE = 'ADJUSTMENT';

/**
 * Tổng tiền từ các dòng phí. Khoản điều chỉnh giảm có thể làm tổng âm: tổng để 0, phần dư (adjustmentCredit)
 * cộng vào Số dư trả trước khi phát hành — không mất tiền của Người nộp phí.
 */
export function totalsOf(items) {
  const sum = items.reduce((s, i) => s + i.amount, 0);
  return { totalAmount: Math.max(0, sum), adjustmentCredit: Math.max(0, -sum) };
}

/**
 * Khoản điều chỉnh (M4-5) chờ vào kỳ sau: của thông báo kỳ trước `period`, cùng Người nộp phí `payerId` (X1),
 * chưa gộp vào thông báo nào (hoặc đã gộp vào chính thông báo Nháp `invoiceId` đang tính lại).
 * Đổi Người nộp phí thì khoản điều chỉnh của người cũ chờ đến khi Kế toán xử lý (hủy / tất toán).
 */
export async function collectAdjustments(apartmentId, period, payerId, { invoiceId = null } = {}) {
  const adjustments = await InvoiceAdjustment.find({
    apartmentId,
    payerId,
    status: ADJUSTMENT_STATUS.PENDING,
    invoiceId: invoiceId ? { $in: [null, invoiceId] } : null,
  })
    .populate('sourceInvoiceId', 'code period')
    .sort({ createdAt: 1 })
    .lean();
  const billable = adjustments.filter((a) => a.sourceInvoiceId && a.sourceInvoiceId.period < period);
  return {
    items: billable.map((a) =>
      item(
        FEE_CATEGORIES.ADJUSTMENT,
        ADJUSTMENT_FEE_CODE,
        `Điều chỉnh ${a.sourceInvoiceId.code} (kỳ ${periodLabel(a.sourceInvoiceId.period)}): ${a.reason}`,
        1,
        a.amount,
        a._id,
      ),
    ),
    adjustmentIds: billable.map((a) => a._id),
  };
}

/**
 * Bản nháp hóa đơn kỳ `period` cho 1 căn (apartment cần có buildingId đã populate `code`).
 * Bỏ qua căn chưa bàn giao trong kỳ hoặc chưa xác định được người nộp phí.
 * @param {Map<string, object>} prices bảng giá kỳ `period` (getPriceTable)
 * @param {{ invoiceId?: import('mongoose').Types.ObjectId }} [opts] tính lại thông báo Nháp đã có
 */
export async function buildInvoiceDraft(apartment, period, prices, { invoiceId = null } = {}) {
  const building = apartment.buildingId;
  const base = {
    apartmentId: apartment._id,
    apartmentCode: apartment.code,
    buildingId: building._id,
    buildingCode: building.code,
    period,
    code: baseInvoiceCode(period, building.code, apartment.code),
  };

  const start = periodStart(period);
  const end = periodEnd(period);
  const handover = apartment.handoverDate ? startOfVnDay(new Date(apartment.handoverDate)) : null;
  if (apartment.occupancyStatus === APARTMENT_OCCUPANCY.NOT_HANDED_OVER || (handover && handover >= end)) {
    return { ...base, excludedByHandover: true, payer: null, items: [], totalAmount: 0, charges: null };
  }

  // Kỳ đầu có bàn giao giữa tháng dùng người nộp phí tại ngày bắt đầu tính.
  const billFrom = handover && handover > start ? handover : start;
  const payer = await getPayer(apartment._id, billFrom);
  if (!payer) return { ...base, payer: null, items: [], totalAmount: 0, charges: null };

  // Các nguồn phí độc lập nhau → truy vấn song song (DB ở xa: tuần tự thì cộng dồn độ trễ mỗi căn)
  const [charges, repairs, adjustments, parking, parkingFix] = await Promise.all([
    collectAmenityCharges(apartment._id, shiftPeriod(period, -1), { invoiceId }),
    collectRepairCharges(apartment._id, period, { invoiceId }),
    collectAdjustments(apartment._id, period, payer.userId, { invoiceId }),
    parkingItems(apartment, period, prices, billFrom),
    parkingCorrections(apartment, period, prices),
  ]);
  const items = [
    ...apartmentItems(apartment, prices, (end - start) / DAY_MS, (end - billFrom) / DAY_MS, managementAreaAt(apartment, start)),
    ...parking,
    ...parkingFix,
    ...charges.items,
    ...repairs.items,
    ...adjustments.items,
  ];
  return {
    ...base,
    payer,
    items,
    ...totalsOf(items),
    charges: {
      bookingIds: charges.bookingIds,
      repairQuoteIds: repairs.repairQuoteIds,
      adjustmentIds: adjustments.adjustmentIds,
    },
  };
}

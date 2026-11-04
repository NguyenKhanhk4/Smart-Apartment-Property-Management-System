import { INVOICE_STATUS } from '../../constants/enums.js';
import { FeeType, Invoice } from '../../models/index.js';
import { periodStart, shiftPeriod, vnPeriod } from '../../utils/time.js';

// Mức giá lưu [effectiveFrom, effectiveTo) theo mốc 00:00 ngày 1 giờ VN → quy về kỳ 'YYYY-MM' để hiển thị và so sánh.
/** Kỳ đầu tiên áp dụng mức giá */
export const fromPeriodOf = (fee) => vnPeriod(fee.effectiveFrom);
/** Kỳ cuối cùng áp dụng (bao gồm); null = chưa có ngày kết thúc */
export const endPeriodOf = (fee) => (fee.effectiveTo ? shiftPeriod(vnPeriod(fee.effectiveTo), -1) : null);

/**
 * Bảng giá áp dụng cho kỳ `period` (UC-B02 dùng khi sinh hóa đơn): mức giá có effectiveFrom <= đầu kỳ < effectiveTo.
 * BR-F12 bảo đảm mỗi code có tối đa 1 mức giá cho 1 kỳ.
 * @returns {Promise<Map<string, object>>} code → fee type (lean)
 */
export async function getPriceTable(period) {
  const at = periodStart(period);
  const rows = await FeeType.find({
    effectiveFrom: { $lte: at },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gt: at } }],
  })
    .sort({ feeCategory: 1, code: 1 })
    .lean();
  return new Map(rows.map((r) => [r.code, r]));
}

/** Có hóa đơn chưa hủy dùng mã phí `code` trong các kỳ [fromPeriod, endPeriod] (endPeriod null = tới nay) không */
export function isBilled(code, fromPeriod, endPeriod = null) {
  return Invoice.exists({
    status: { $ne: INVOICE_STATUS.CANCELLED },
    'items.feeCode': code,
    period: endPeriod ? { $gte: fromPeriod, $lte: endPeriod } : { $gte: fromPeriod },
  }).then(Boolean);
}

/** Các kỳ đã lập hóa đơn (chưa hủy) theo từng mã phí — tính cờ inUse cho cả danh sách bằng 1 truy vấn */
export async function billedPeriodsByCode(codes) {
  if (!codes.length) return new Map();
  const rows = await Invoice.aggregate([
    { $match: { status: { $ne: INVOICE_STATUS.CANCELLED }, 'items.feeCode': { $in: codes } } },
    { $unwind: '$items' },
    { $match: { 'items.feeCode': { $in: codes } } },
    { $group: { _id: '$items.feeCode', periods: { $addToSet: '$period' } } },
  ]);
  return new Map(rows.map((r) => [r._id, r.periods]));
}

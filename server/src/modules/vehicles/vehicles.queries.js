import { VEHICLE_STATUS } from '../../constants/enums.js';
import { periodEnd, periodStart } from '../../utils/time.js';
import { Vehicle } from '../../models/index.js';

const VEHICLE_FIELDS = '_id type plateNumber approvedAt cancelledAt';

/** Điều kiện "xe có ít nhất 1 ngày được gửi trong [from, to)": duyệt trước `to`, chưa gỡ hoặc gỡ sau `from` */
export const activeVehicleFilter = (from, to) => ({
  approvedAt: { $lt: to },
  $or: [
    { status: VEHICLE_STATUS.APPROVED },
    { status: VEHICLE_STATUS.CANCELLED, cancelledAt: { $gt: from } },
  ],
});

/**
 * Mô đun 4 — xe tính phí gửi xe kỳ `period` ('YYYY-MM', giờ VN): mọi xe có ít nhất 1 ngày được gửi trong kỳ.
 * Số ngày thực tế (đăng ký mới / gỡ xe giữa tháng) do builder thông báo phí tính từ approvedAt / cancelledAt.
 *
 * @param {string|import('mongoose').Types.ObjectId} apartmentId
 * @param {string} period 'YYYY-MM'
 * @param {{ ids?: Array }} [opts] thêm các xe này dù không còn hoạt động trong kỳ (đối chiếu xe đã tính phí kỳ trước)
 * @returns {Promise<Array<{ _id: import('mongoose').Types.ObjectId, type: string, plateNumber: string, approvedAt: Date, cancelledAt: Date }>>}
 */
export async function getBillableVehicles(apartmentId, period, { ids = [] } = {}) {
  const active = activeVehicleFilter(periodStart(period), periodEnd(period));
  const filter = ids.length ? { apartmentId, $or: [active, { _id: { $in: ids } }] } : { apartmentId, ...active };
  return Vehicle.find(filter).select(VEHICLE_FIELDS).sort({ createdAt: 1 }).lean();
}

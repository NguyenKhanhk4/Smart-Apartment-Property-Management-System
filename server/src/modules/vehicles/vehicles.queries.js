import { VEHICLE_STATUS } from '../../constants/enums.js';
import { Vehicle } from '../../models/index.js';
import { periodStart } from '../../utils/time.js';

/**
 * BR-F5: Xe tính vé tháng cho kỳ `period` ('YYYY-MM', giờ VN):
 * Xe duyệt trong tháng T -> tính phí từ kỳ T+1; xe hủy trong tháng T -> vẫn tính hết tháng T.
 * Điều kiện:
 * approvedAt < periodStart(period) VÀ (status APPROVED, hoặc status CANCELLED với cancelledAt >= periodStart(period))
 *
 * @param {string|import('mongoose').Types.ObjectId} apartmentId
 * @param {string} period 'YYYY-MM'
 * @returns {Promise<Array<{ _id: import('mongoose').Types.ObjectId, type: string, plateNumber: string, approvedAt: Date, cancelledAt: Date }>>}
 */
export async function getBillableVehicles(apartmentId, period) {
  const start = periodStart(period);
  const filter = {
    apartmentId,
    approvedAt: { $lt: start },
    $or: [
      { status: VEHICLE_STATUS.APPROVED },
      { status: VEHICLE_STATUS.CANCELLED, cancelledAt: { $gte: start } },
    ],
  };

  const list = await Vehicle.find(filter)
    .select('_id type plateNumber approvedAt cancelledAt')
    .sort({ createdAt: 1 })
    .lean();

  return list;
}

// Truy vấn gói tháng dùng chung (không phụ thuộc service khác để tránh import vòng):
// bước 9 (đặt chỗ phí 0), bước 11 (vào cửa), tra mã tại quầy và trang Gia đình đều dùng ở đây.
import { AMENITY_PASS_STATUS } from '../../constants/enums.js';
import { AmenityPass } from '../../models/index.js';
import { vnPeriod } from '../../utils/time.js';

/**
 * Gói ACTIVE của người dùng cho tiện ích tại thời điểm `at` (tháng dương lịch theo giờ VN), hoặc null.
 * Gói đã hủy không tính; gói đã gộp hóa đơn vẫn còn hiệu lực trong tháng của nó.
 */
export function getActivePass(userId, amenityId, at = new Date()) {
  return AmenityPass.findOne({
    userId,
    amenityId,
    month: vnPeriod(at),
    status: AMENITY_PASS_STATUS.ACTIVE,
  }).lean();
}

/** Gói ACTIVE từ tháng `fromMonth` trở đi của nhiều người (kèm tên tiện ích), nhóm theo userId */
export async function activePassesByUser(userIds, { apartmentId, fromMonth, toMonth } = {}) {
  const month = {};
  if (fromMonth) month.$gte = fromMonth;
  if (toMonth) month.$lte = toMonth;
  const rows = await AmenityPass.find({
    userId: { $in: userIds },
    status: AMENITY_PASS_STATUS.ACTIVE,
    ...(apartmentId && { apartmentId }),
    ...(Object.keys(month).length && { month }),
  })
    .populate('amenityId', 'name accessMode')
    .sort({ month: 1, createdAt: 1 })
    .lean();
  const out = new Map();
  for (const r of rows) {
    const list = out.get(String(r.userId)) ?? [];
    list.push({
      _id: r._id,
      amenityId: r.amenityId?._id ?? r.amenityId,
      amenityName: r.amenityId?.name ?? null,
      month: r.month,
      ageGroup: r.ageGroup,
      fee: r.fee,
      invoiceId: r.invoiceId,
    });
    out.set(String(r.userId), list);
  }
  return out;
}

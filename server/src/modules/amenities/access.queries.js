// Quyền dùng tiện ích dùng chung cho booking (UC-D06/D07), gói tháng (UC-D09), lượt vào (UC-D10).
// Chỉ phụ thuộc model để bookings / amenityPasses / amenityVisits / memberCodes import mà không vòng.
import { MemberCode } from '../../models/index.js';

/** Tiện ích riêng tòa chỉ dành cho căn thuộc tòa đó; chung toàn khu thì mọi căn */
export const amenityVisibleTo = (amenity, apartment) =>
  !amenity.buildingId || String(amenity.buildingId) === String(apartment.buildingId?._id ?? apartment.buildingId);

/** BR-O26: chủ hộ luôn được phát sinh phí; thành viên khác cần chủ hộ bật canIncurCharges */
export async function canIncurCharges(userId, apartmentId, isHead) {
  if (isHead) return true;
  const code = await MemberCode.findOne({ userId, apartmentId, isActive: true }).select('canIncurCharges').lean();
  return Boolean(code?.canIncurCharges);
}

/**
 * Mã cư dân đang hiệu lực của các cặp (căn, người) → Map `${apartmentId}:${userId}` → mã chữ.
 * @param {{ apartmentId: any, userId: any }[]} pairs id hoặc document đã populate
 */
export async function activeMemberCodes(pairs) {
  const idOf = (v) => String(v?._id ?? v);
  const valid = pairs.filter((p) => p.apartmentId && p.userId);
  if (!valid.length) return new Map();
  const rows = await MemberCode.find({
    apartmentId: { $in: [...new Set(valid.map((p) => idOf(p.apartmentId)))] },
    userId: { $in: [...new Set(valid.map((p) => idOf(p.userId)))] },
    isActive: true,
  })
    .select('apartmentId userId code')
    .lean();
  return new Map(rows.map((r) => [`${r.apartmentId}:${r.userId}`, r.code]));
}

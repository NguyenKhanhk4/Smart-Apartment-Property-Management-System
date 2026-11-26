import { Apartment, Resident } from '../models/index.js';
import { effectiveOccupancy, occupyingHeadRelation } from '../modules/residents/residentOccupancy.js';
import { ApiError } from '../utils/ApiError.js';

export const MOVE_IN_REQUIRED = 'Cần Ban quản lý xác nhận vào ở trước khi sử dụng dịch vụ, đăng ký xe, cấp thẻ hoặc gửi phản ánh';

/** Hồ sơ cũ đã ở được giữ quyền; các lượt mới PENDING phải được BQL ghi nhận. */
export function canUseResidentServices(apartment, resident, now = new Date()) {
  if (!apartment || !resident?.isActive || resident.moveInStatus === 'PENDING'
    || (resident.moveInDate && new Date(resident.moveInDate) > now)) return false;
  const status = effectiveOccupancy(apartment);
  if (!['OWNER_OCCUPIED', 'RENTED', 'UNDER_REPAIR'].includes(status)) return false;
  if (status === 'RENTED' && resident.relationType === 'OWNER') return false;
  if (status !== 'RENTED' && resident.relationType === 'TENANT') return false;
  if (status === 'UNDER_REPAIR' && resident.moveInStatus !== 'CONFIRMED') return false;
  return true;
}

export async function assertResidentServiceAccess(userId, apartmentId, session = null) {
  const apartment = await Apartment.findById(apartmentId).session(session).lean();
  const resident = await Resident.findOne({ userId, apartmentId, isActive: true }).session(session).lean();
  const head = apartment && await Resident.findOne({ apartmentId, isActive: true,
    relationType: occupyingHeadRelation(effectiveOccupancy(apartment)), userId: { $type: 'objectId' },
  }).session(session).lean();
  if (!canUseResidentServices(apartment, resident) || (head && !canUseResidentServices(apartment, head))) throw ApiError.forbidden(MOVE_IN_REQUIRED);
  return { apartment, resident };
}

/** Các căn hộ cư dân đang ở (residents.isActive = true). */
export async function getActiveApartmentIds(userId) {
  const rows = await Resident.find({ userId, isActive: true }).select('apartmentId').lean();
  return rows.map((r) => String(r.apartmentId));
}

/**
 * Xác định căn hộ cư dân thao tác. Có truyền apartmentId thì phải thuộc về cư dân;
 * không truyền thì lấy căn duy nhất (nếu ở nhiều căn → bắt chọn).
 * Trả về document căn hộ (lean).
 */
export async function resolveResidentApartment(userId, apartmentId) {
  const ids = await getActiveApartmentIds(userId);
  if (!ids.length) {
    throw ApiError.forbidden('Tài khoản chưa được gán vào căn hộ nào (liên hệ Lễ tân)');
  }
  let target = apartmentId;
  if (!target) {
    if (ids.length > 1) throw ApiError.badRequest('Bạn ở nhiều căn hộ, hãy chọn apartmentId');
    [target] = ids;
  } else if (!ids.includes(String(target))) {
    throw ApiError.forbidden('Bạn không thuộc căn hộ này');
  }
  const apartment = await Apartment.findById(target).lean();
  if (!apartment) throw ApiError.notFound('Không tìm thấy căn hộ');
  return apartment;
}

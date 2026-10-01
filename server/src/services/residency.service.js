import { Apartment, Resident } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';

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

// API Module D (Thanh Bình): Tiện ích & đặt chỗ.
// Theo quy ước axiosClient.js: trả nguyên envelope { success, data, pagination? }.
import { http } from './axiosClient';

// ===== UC-D05: Tiện ích =====
// body: các field tiện ích; image: File (tùy chọn) — luôn gửi multipart (field "image")
const amenityForm = (body, image) => {
  const form = new FormData();
  Object.entries(body).forEach(([k, v]) => v !== undefined && v !== null && form.append(k, v));
  if (image) form.append('image', image);
  return form;
};

export const amenityApi = {
  list: (params) => http.get('/amenities', { params }),
  get: (id) => http.get(`/amenities/${id}`),
  create: (body, image) => http.post('/amenities', amenityForm(body, image)),
  update: (id, body, image) => http.put(`/amenities/${id}`, amenityForm(body, image)),
  setStatus: (id, isActive) => http.patch(`/amenities/${id}/status`, { isActive }),
  /** UC-D06: lưới slot của tiện ích BOOKING trong 1 ngày. params: { date: 'YYYY-MM-DD', apartmentId? } */
  slots: (id, params) => http.get(`/amenities/${id}/slots`, { params }),
};

// ===== UC-D06: Đặt tiện ích =====
export const bookingApi = {
  /** body: { apartmentId, amenityId, date: 'YYYY-MM-DD', slotStart: 'HH:mm' } */
  create: (body) => http.post('/bookings', body),
  /** params: { scope: 'upcoming' | 'past', apartmentId?, page?, limit? } */
  mine: (params) => http.get('/bookings/mine', { params }),
  cancel: (id) => http.patch(`/bookings/${id}/cancel`, {}),
};

// ===== UC-D11: Thẻ cư dân (mã chữ), gia đình, tra mã =====
// apartmentId có thể bỏ trống khi chỉ ở một căn
const withApartment = (apartmentId) => (apartmentId ? { params: { apartmentId } } : undefined);

export const memberCodeApi = {
  mine: () => http.get('/member-codes/mine'),
  household: (apartmentId) => http.get('/member-codes/household', withApartment(apartmentId)),
  /** body: { canIncurCharges?, dateOfBirth?: 'YYYY-MM-DD' | null } */
  updateMember: (userId, body, apartmentId) => http.patch(`/member-codes/household/${userId}`, body, withApartment(apartmentId)),
  /** Lễ tân / Bảo vệ / Trưởng BQL tra mã chữ */
  lookup: (q) => http.get('/member-codes/lookup', { params: { q } }),
  /** Lễ tân sửa ngày sinh khi đối chiếu giấy tờ */
  setDateOfBirth: (userId, dateOfBirth) => http.patch(`/member-codes/${userId}/date-of-birth`, { dateOfBirth }),
};

// ===== UC-D09: Gói tháng tiện ích =====
export const amenityPassApi = {
  /** Cư dân: chủ hộ thấy cả hộ, thành viên thấy gói của mình. params: { apartmentId?, month?, status? } */
  mine: (params) => http.get('/amenity-passes/mine', { params }),
  /** Chủ hộ: tiện ích có bán gói + giá theo nhóm tuổi của từng thành viên (params: { apartmentId?, month? }) */
  options: (params) => http.get('/amenity-passes/options', { params }),
  /** body: { apartmentId, userId, amenityId, month: 'YYYY-MM' } */
  purchase: (body) => http.post('/amenity-passes', body),
  /** Chủ hộ: gói tháng sau (không cần lý do). Trưởng BQL: gói bất kỳ chưa gộp hóa đơn, bắt buộc reason */
  cancel: (id, reason) => http.patch(`/amenity-passes/${id}/cancel`, reason ? { reason } : {}),
  /** Trưởng BQL / Lễ tân. params: { page, limit, sort, month, amenityId, apartmentId, userId, status, invoiced } */
  list: (params) => http.get('/amenity-passes', { params }),
};

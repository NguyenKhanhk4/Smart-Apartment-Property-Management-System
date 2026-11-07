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
  /** Cư dân hủy: không cần lý do. Lễ tân hủy: bắt buộc reason (UC-D07) */
  cancel: (id, reason) => http.patch(`/bookings/${id}/cancel`, reason ? { reason } : {}),

  // ----- UC-D07: lịch trong ngày, check-in, đặt hộ (Lễ tân, Bảo vệ, Trưởng BQL) -----
  /** params: { date?: 'YYYY-MM-DD' (mặc định hôm nay), amenityId?, q? } → { date, serverTime, rules, bookings[] } */
  schedule: (params) => http.get('/bookings/schedule', { params }),
  /** Lễ tân / Bảo vệ. code: mã cư dân của người đến (tùy chọn) để kiểm tra đúng căn */
  checkIn: (id, code) => http.patch(`/bookings/${id}/check-in`, code ? { code } : {}),
  /** Lễ tân. body: { memberCode, amenityId, date, slotStart, payerCode?, checkInNow? } */
  counter: (body) => http.post('/bookings/counter', body),

  // ----- Người 4: vé QR, giữ chỗ chờ thanh toán, đổi lịch -----
  /** Lễ tân / Bảo vệ quét vé QR của cư dân */
  checkInByQr: (token) => http.post('/bookings/check-in-by-qr', { token }),
  /** Lễ tân xác nhận đã thu tiền booking đang giữ chỗ */
  markPaid: (id, paymentRef) => http.patch(`/bookings/${id}/mark-paid`, paymentRef ? { paymentRef } : {}),
  /** Cư dân tạo link payOS trả phí booking đang giữ chỗ → { checkoutUrl, orderCode, expiredAt } */
  payos: (id) => http.post(`/bookings/${id}/payos`),
  /** Cư dân đổi sang khung giờ khác. body: { date: 'YYYY-MM-DD', slotStart: 'HH:mm' } */
  reschedule: (id, body) => http.patch(`/bookings/${id}/reschedule`, body),
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

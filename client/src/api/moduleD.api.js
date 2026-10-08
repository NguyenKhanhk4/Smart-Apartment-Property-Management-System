// API Module D (Thanh Bình): Tài sản & bảo trì, Tiện ích & đặt chỗ.
// Theo quy ước axiosClient.js: trả nguyên envelope { success, data, pagination? }.
import { http } from './axiosClient';

// ===== UC-D01: Tài sản =====
export const assetApi = {
  list: (params) => http.get('/assets', { params }),
  get: (id) => http.get(`/assets/${id}`),
  history: (id, params) => http.get(`/assets/${id}/history`, { params }),
  create: (body) => http.post('/assets', body),
  update: (id, body) => http.put(`/assets/${id}`, body),
  setStatus: (id, isActive) => http.patch(`/assets/${id}/status`, { isActive }),
};

// ===== UC-D02..D04: Work order =====
export const workOrderApi = {
  list: (params) => http.get('/work-orders', { params }),
  get: (id) => http.get(`/work-orders/${id}`),
  assignees: () => http.get('/work-orders/assignees'),
  assign: (id, body) => http.patch(`/work-orders/${id}/assign`, body),
  // UC-D04 (KTV): body { status: 'IN_PROGRESS' } hoặc { status: 'DONE', note } + files (ảnh bằng chứng, bắt buộc khi DONE)
  updateStatus: (id, body, files = []) => {
    if (!files.length) return http.patch(`/work-orders/${id}/status`, body);
    const form = new FormData();
    Object.entries(body).forEach(([k, v]) => v != null && v !== '' && form.append(k, v));
    files.forEach((f) => form.append('images', f));
    return http.patch(`/work-orders/${id}/status`, form);
  },
  // Chạy thủ công cron quét tài sản đến hạn; trả bản ghi cron_runs (affectedCount = số work order mới)
  runGenerate: () => http.post('/work-orders/jobs/generate/run'),
};

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

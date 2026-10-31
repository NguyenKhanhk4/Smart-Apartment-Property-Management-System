// API Module E (Phạm Lượng): Ticket, Sổ khách, Bảng tin & Thông báo, Báo cáo, Danh mục & tham số.
// Theo quy ước axiosClient.js: trả nguyên envelope { success, data, pagination? }.
import { apiClient, http } from './axiosClient';

// ===== UC-E01: Danh mục phản ánh & tham số nghiệp vụ =====
export const complaintCategoryApi = {
  list: (params) => http.get('/complaint-categories', { params }),
  create: (body) => http.post('/complaint-categories', body),
  update: (id, body) => http.patch(`/complaint-categories/${id}`, body),
  remove: (id) => http.delete(`/complaint-categories/${id}`),
};

export const systemConfigApi = {
  list: () => http.get('/system-configs'),
  update: (key, value) => http.patch(`/system-configs/${key}`, { value }),
};

// multipart: field rỗng bỏ qua, ảnh gửi ở field `images`
function toForm(body, files) {
  const form = new FormData();
  Object.entries(body).forEach(([k, v]) => v != null && v !== '' && form.append(k, v));
  files.forEach((f) => form.append('images', f));
  return form;
}

// ===== UC-E02..E06: Ticket =====
export const ticketApi = {
  list: (params) => http.get('/tickets', { params }),
  get: (id) => http.get(`/tickets/${id}`),
  /** body: { categoryId, title, description, type, scope, apartmentId? }, files: File[] */
  create: (body, files = []) => http.post('/tickets', toForm(body, files)),
  /** Lễ tân tạo hộ cư dân — body như create, apartmentId bắt buộc */
  createByStaff: (body, files = []) => http.post('/tickets/staff', toForm(body, files)),
  /** Hàng chờ sự cố của KTV: { items, hasSchedule, onDuty } */
  queue: () => http.get('/tickets/queue'),
  /** Kanban của Trưởng BQL: { columns: [{ status, items }] } */
  board: (params) => http.get('/tickets/board', { params }),
  claim: (id) => http.patch(`/tickets/${id}/claim`),
  /** Người nộp phí đồng ý / từ chối báo giá sự cố trong căn hộ */
  decideQuote: (id, body) => http.patch(`/tickets/${id}/quote-decision`, body),
  assignees: () => http.get('/tickets/assignees'),
  assign: (id, body) => http.patch(`/tickets/${id}/assign`, body),
  reject: (id, reason) => http.patch(`/tickets/${id}/reject`, { reason }),
  /** files: ảnh kết quả, bắt buộc khi status = WAITING_CONFIRM (gửi multipart) */
  progress: (id, body, files = []) => {
    if (!files.length) return http.patch(`/tickets/${id}/progress`, body);
    return http.patch(`/tickets/${id}/progress`, toForm(body, files));
  },
  confirm: (id, body) => http.patch(`/tickets/${id}/confirm`, body),
  runJob: (job) => http.post(`/tickets/jobs/${job}/run`),
};

// ===== UC-E07, E08: Sổ khách =====
export const guestApi = {
  list: (params) => http.get('/guests', { params }),
  register: (body) => http.post('/guests', body),
  cancel: (id) => http.delete(`/guests/${id}`),
  walkIn: (body) => http.post('/guests/walk-in', body),
  checkIn: (id, note) => http.patch(`/guests/${id}/check-in`, note ? { note } : {}),
  checkOut: (id) => http.patch(`/guests/${id}/check-out`),
};

// ===== UC-E09: Bảng tin & thông báo =====
export const announcementApi = {
  list: (params) => http.get('/announcements', { params }),
  get: (id) => http.get(`/announcements/${id}`),
  create: (body) => http.post('/announcements', body),
  update: (id, body) => http.patch(`/announcements/${id}`, body),
  remove: (id) => http.delete(`/announcements/${id}`),
};

export const notificationApi = {
  list: (params) => http.get('/notifications', { params }),
  unreadCount: () => http.get('/notifications/unread-count'),
  markRead: (ids) => http.patch('/notifications/read', ids ? { ids } : { all: true }),
  markOneRead: (id) => http.patch(`/notifications/${id}/read`),
};

// ===== UC-E10..E14: Báo cáo =====
export const reportApi = {
  billingSummary: (params) => http.get('/reports/billing-summary', { params }),
  debts: (params) => http.get('/reports/debts', { params }),
  fund: (params) => http.get('/reports/fund', { params }),
  occupancy: (params) => http.get('/reports/occupancy', { params }),
  tickets: (params) => http.get('/reports/tickets', { params }),
  maintenance: (params) => http.get('/reports/maintenance', { params }),
  amenityUsage: (params) => http.get('/reports/amenity-usage', { params }),

  /** UC-E13 — tải file Excel/PDF, trả về tên file đã lưu */
  async download(params) {
    const res = await apiClient.get('/reports/export', { params, responseType: 'blob' });
    const match = /filename="?([^"]+)"?/.exec(res.headers['content-disposition'] ?? '');
    const filename = match?.[1] ?? `bao-cao-${params.type}.${params.format}`;
    const url = URL.createObjectURL(res.data);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return filename;
  },
};

// ===== Lookup cho ô chọn =====
export const lookupApi = {
  buildings: () => http.get('/lookups/buildings'),
  apartments: (params) => http.get('/lookups/apartments', { params }),
  amenities: () => http.get('/lookups/amenities'),
};

// ===== Người 4: Lịch ca trực Kỹ thuật / Bảo vệ =====
export const dutyShiftApi = {
  /** params: { from, to, roleTitle?, userId? } (ISO) */
  list: (params) => http.get('/duty-shifts', { params }),
  onDuty: (roleTitle) => http.get('/duty-shifts/on-duty', { params: { roleTitle } }),
  staff: (roleTitle) => http.get('/duty-shifts/staff', { params: { roleTitle } }),
  /** body: { roleTitle, userId, startAt, endAt, isBackup?, repeatDays?, note? } */
  create: (body) => http.post('/duty-shifts', body),
  remove: (id) => http.delete(`/duty-shifts/${id}`),
};

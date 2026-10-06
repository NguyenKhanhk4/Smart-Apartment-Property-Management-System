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

// ===== UC-E02..E06: Ticket =====
export const ticketApi = {
  list: (params) => http.get('/tickets', { params }),
  get: (id) => http.get(`/tickets/${id}`),
  /** body: { categoryId, title, description, apartmentId? }, files: File[] */
  create: (body, files = []) => {
    const form = new FormData();
    Object.entries(body).forEach(([k, v]) => v != null && v !== '' && form.append(k, v));
    files.forEach((f) => form.append('images', f));
    return http.post('/tickets', form);
  },
  assignees: () => http.get('/tickets/assignees'),
  assign: (id, body) => http.patch(`/tickets/${id}/assign`, body),
  reject: (id, reason) => http.patch(`/tickets/${id}/reject`, { reason }),
  progress: (id, body) => http.patch(`/tickets/${id}/progress`, body),
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

// API dùng chung Module 7/8: vận hành an ninh, bảng tin, bình luận và khảo sát theo căn hộ.
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
  respondComplaint: (id, body, files = []) =>
    http.patch(`/tickets/${id}/respond-complaint`, files.length ? toForm(body, files) : body),
  /** files: ảnh kết quả, bắt buộc khi status = WAITING_CONFIRM (gửi multipart) */
  progress: (id, body, files = []) => {
    if (!files.length) return http.patch(`/tickets/${id}/progress`, body);
    return http.patch(`/tickets/${id}/progress`, toForm(body, files));
  },
  /** UC49: chưa đồng ý kết quả có thể kèm ảnh (tối đa 3) */
  confirm: (id, body, files = []) => http.patch(`/tickets/${id}/confirm`, files.length ? toForm(body, files) : body),
  /** BR-X6: sự cố khẩn cấp chưa ai nhận (banner) và bấm "Đã tiếp nhận" */
  emergencyAlerts: () => http.get('/tickets/emergency-alerts'),
  emergencyAck: (id) => http.patch(`/tickets/${id}/emergency-ack`),
  runJob: (job) => http.post(`/tickets/jobs/${job}/run`),
  /** M5-6: sự cố khu vực chung đang mở cùng tòa, cùng loại. params: { apartmentId?, categoryId, excludeId? } */
  similar: (params) => http.get('/tickets/similar', { params }),
  /** M5-5: body { type?, scope?, reason } */
  classify: (id, body) => http.patch(`/tickets/${id}/classify`, body),
  /** M5-6: body { parentId, note? } */
  merge: (id, body) => http.patch(`/tickets/${id}/merge`, body),
};

// ===== UC-E07, E08: Sổ khách =====
export const guestApi = {
  operations: (kind, params) => http.get(`/guests/operations/${kind}`, { params }),
  alerts: () => http.get('/guests/alerts'),
  summary: (params) => http.get('/guests/operations/summary', { params }),
  confirm: (id, confirmed) => http.patch(`/guests/${id}/confirm`, { confirmed }),
  receiveParcel: (body, files) => http.post('/guests/parcels', toForm(body, files)),
  recipients: (id) => http.get(`/guests/parcels/${id}/recipients`),
  receipt: (id) => http.get(`/guests/parcels/${id}/receipt`),
  handover: (id, body) => http.patch(`/guests/parcels/${id}/handover`, body),
  checkpoint: (body) => http.post('/guests/checkpoints', body),
  updateCheckpoint: (id, active) => http.patch(`/guests/checkpoints/${id}`, { active }),
  tour: (body) => http.post('/guests/tours', body),
  scan: (id, body) => http.patch(`/guests/tours/${id}/scan`, body),
  incident: (body, files = []) => http.post('/guests/incidents', toForm(body, files)),
  acknowledge: (id) => http.patch(`/guests/incidents/${id}/acknowledge`),
  broadcast: (id) => http.patch(`/guests/incidents/${id}/broadcast`),
  endBroadcast: (id) => http.patch(`/guests/incidents/${id}/end-broadcast`),
  list: (params) => http.get('/guests', { params }),
  register: (body) => http.post('/guests', body),
  cancel: (id) => http.delete(`/guests/${id}`),
  walkIn: (body) => http.post('/guests/walk-in', body),
  checkIn: (id, note) => http.patch(`/guests/${id}/check-in`, note ? { note } : {}),
  checkOut: (id) => http.patch(`/guests/${id}/check-out`),
};

// ===== UC-E09: Bảng tin & thông báo =====
export const announcementApi = {
  comments: (id, params) => http.get(`/announcements/${id}/comments`, { params }),
  comment: (id, content) => http.post(`/announcements/${id}/comments`, { content }),
  hideComment: (id, commentId) => http.patch(`/announcements/${id}/comments/${commentId}/hide`),
  poll: (id, apartmentId) => http.get(`/announcements/${id}/poll`, { params: { apartmentId } }),
  vote: (id, body) => http.put(`/announcements/${id}/poll/vote`, body),
  closePoll: (id) => http.patch(`/announcements/${id}/poll/close`),
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
  /** UC60 Dashboard vận hành — params: { from, to: 'YYYY-MM', buildingId } */
  operationsKpi: (params) => http.get('/reports/operations-kpi', { params }),
  amenityUsage: (params) => http.get('/reports/amenity-usage', { params }),
  /** Mô đun 9 — Dashboard tài chính (UC60). params: { from, to } dạng YYYY-MM */
  finance: (params) => http.get('/reports/finance', { params }),
  /** Báo cáo giám sát cho Ban quản trị. params: { from, to } dạng YYYY-MM */
  supervision: (params) => http.get('/reports/supervision', { params }),

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
  /** body: { roleTitle, userIds: [], startAt, endAt, repeatDays?, note? } — 1 ca có thể nhiều người trực */
  create: (body) => http.post('/duty-shifts', body),
  /** body: { userId?, startAt?, endAt?, note? } — sửa ca chưa kết thúc / kéo thả sang ngày khác */
  update: (id, body) => http.patch(`/duty-shifts/${id}`, body),
  /** UC37: sao chép ca tuần trước sang tuần bắt đầu `weekStart` → { created, skipped } */
  copyWeek: (body) => http.post('/duty-shifts/copy-week', body),
  remove: (id) => http.delete(`/duty-shifts/${id}`),
};

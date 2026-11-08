// API Người 1 — Vũ Việt (Mô đun 10): Thiết bị & bảo trì định kỳ.
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
  // UC08 (KTV): checklist ca → quét QR thiết bị → nộp kết quả (multipart: result, note, results JSON, images)
  shiftChecklist: () => http.get('/work-orders/shift-checklist'),
  scan: (id, qrCode) => http.post(`/work-orders/${id}/scan`, { qrCode }),
  submitInspection: (id, { result, note, results }, files = []) => {
    const form = new FormData();
    form.append('result', result);
    form.append('note', note ?? '');
    form.append('results', JSON.stringify(results ?? []));
    files.forEach((f) => form.append('images', f));
    return http.post(`/work-orders/${id}/inspection`, form);
  },
  // Chạy thủ công cron quét tài sản đến hạn; trả bản ghi cron_runs (affectedCount = số work order mới)
  runGenerate: () => http.post('/work-orders/jobs/generate/run'),
};

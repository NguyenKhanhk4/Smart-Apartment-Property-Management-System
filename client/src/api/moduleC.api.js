// API Module C (Minh): Quỹ bảo trì, đề xuất chi quỹ, chi phí vận hành & nhật ký hoạt động.
// Theo quy ước axiosClient.js: trả nguyên envelope { success, data, pagination? }.
import { apiClient, http } from './axiosClient';

// Ảnh chứng từ gửi multipart qua field "images" như Module D/E; không có ảnh thì gửi JSON.
const withImages = (body, files = []) => {
  if (!files.length) return body;
  const form = new FormData();
  Object.entries(body).forEach(([key, value]) => value != null && value !== '' && form.append(key, value));
  files.forEach((file) => form.append('images', file));
  return form;
};

// ===== UC-C07: Chi phí vận hành (tách biệt quỹ bảo trì) =====
export const operatingExpenseApi = {
  list: (params) => http.get('/operating-expenses', { params }),
  /** body: { category, amount, month: 'YYYY-MM', description }; files: ảnh chứng từ */
  create: (body, files) => http.post('/operating-expenses', withImages(body, files)),
};

// ===== UC-C08: Tra cứu nhật ký hoạt động =====
export const auditLogApi = {
  list: (params) => http.get('/audit-logs', { params }),
  options: () => http.get('/audit-logs/options'),
  // UC06 bước 5: tải file Excel / PDF theo bộ lọc đang xem; trả tên file để báo MSG-G06
  async download(params) {
    const res = await apiClient.get('/audit-logs/export', { params, responseType: 'blob' });
    const match = /filename="?([^"]+)"?/.exec(res.headers['content-disposition'] ?? '');
    const filename = match?.[1] ?? `nhat-ky-hoat-dong.${params.format}`;
    const url = URL.createObjectURL(res.data);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return filename;
  },
};

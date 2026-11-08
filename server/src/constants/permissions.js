// UC04 – Ma trận phân quyền (BR-S07, BR-X2, BR-X3).
//
// Cách áp dụng (đã chốt 08/11/2026, cách A "lớp chặn chung"):
// - Quyền trần của mỗi vai trò = những gì authorize() trong code đang cho phép. Đọc tự động từ bảng route
//   (permissions.service.js), nên nhóm sửa authorize() thì ma trận tự đúng theo.
// - Trưởng BQL chỉ TẮT được quyền trong phạm vi quyền trần, không cấp thêm ngoài phạm vi.
// - Quyền lõi (BR-X3) luôn bật; vai trò Trưởng BQL chỉ đọc (BR-X2).
// - Middleware authenticate chặn request theo (chức năng, hành động) suy ra từ đường dẫn + phương thức HTTP.

export const PERMISSION_ACTIONS = Object.freeze({
  VIEW: 'VIEW',
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  APPROVE: 'APPROVE',
});
export const ACTION_LABELS = { VIEW: 'Xem', CREATE: 'Tạo', UPDATE: 'Sửa', DELETE: 'Xóa', APPROVE: 'Duyệt' };

/** 7 vai trò của SRS. Nhân viên tách theo chức danh, Ban quản trị gộp Trưởng BQT và thành viên */
export const PERMISSION_ROLES = Object.freeze({
  MANAGER: 'Trưởng BQL',
  ACCOUNTANT: 'Kế toán',
  RECEPTIONIST: 'Lễ tân',
  TECHNICIAN: 'Kỹ thuật viên',
  SECURITY: 'Bảo vệ',
  BOARD: 'Ban quản trị',
  RESIDENT: 'Cư dân',
});
export const ROLE_KEYS = Object.keys(PERMISSION_ROLES);
export const READ_ONLY_ROLE = 'MANAGER'; // BR-X2

/** user (req.user hoặc User) → khóa vai trò của ma trận */
export function roleKeyOf(user) {
  if (!user?.role) return null;
  if (user.role === 'STAFF') return user.roleTitle ?? null;
  return user.role; // MANAGER, ACCOUNTANT, BOARD, RESIDENT
}

/** spec của authorize() → các khóa vai trò: 'STAFF' → 3 chức danh, 'BOARD:CHAIRMAN' → BOARD */
export function roleKeysOfSpec(spec) {
  const [role, title] = spec.split(':');
  if (role === 'STAFF') return title ? [title] : ['RECEPTIONIST', 'TECHNICIAN', 'SECURITY'];
  return [role];
}

/**
 * Danh mục chức năng: mỗi chức năng gồm các tiền tố API và các mục menu client (ẩn khi tắt quyền Xem).
 * Tiền tố dài hơn được ưu tiên khi khớp.
 */
export const FEATURES = [
  // Tài sản
  { code: 'APARTMENTS', label: 'Tòa nhà và căn hộ', group: 'Tài sản', prefixes: ['/buildings', '/apartments'], menuKeys: ['buildings', 'apartment-detail', 'my-apartment'] },
  { code: 'ASSETS', label: 'Thiết bị', group: 'Tài sản', prefixes: ['/assets'], menuKeys: ['assets', 'asset-detail'] },
  { code: 'WORK_ORDERS', label: 'Phiếu bảo trì', group: 'Tài sản', prefixes: ['/work-orders'], menuKeys: ['work-orders', 'my-work-orders', 'repair-approvals'] },
  // Cư dân
  { code: 'CONTRACTS', label: 'Hợp đồng', group: 'Cư dân', prefixes: ['/contracts'], menuKeys: ['contracts'] },
  { code: 'RESIDENTS', label: 'Cư dân và nhân khẩu', group: 'Cư dân', prefixes: ['/residents'], menuKeys: ['resident-changes'] },
  { code: 'MEMBER_CODES', label: 'Mã cư dân', group: 'Cư dân', prefixes: ['/member-codes'], menuKeys: ['my-code', 'family'] },
  { code: 'ACTIVATION_CODES', label: 'Cấp mã kích hoạt, đổi SĐT tại quầy', group: 'Cư dân', prefixes: ['/activation-codes'], menuKeys: ['activation-codes'] },
  { code: 'VEHICLES', label: 'Đăng ký xe', group: 'Cư dân', prefixes: ['/vehicles'], menuKeys: ['vehicle-requests', 'my-vehicles'] },
  { code: 'PARKING_CARDS', label: 'Thẻ gửi xe', group: 'Cư dân', prefixes: ['/parking-cards'], menuKeys: ['parking-cards'] },
  // Vận hành
  { code: 'TICKETS', label: 'Sự cố và phản ánh', group: 'Vận hành', prefixes: ['/tickets'], menuKeys: ['tickets', 'ticket-detail', 'ticket-board'] },
  { code: 'REPAIR_QUOTES', label: 'Báo giá sửa chữa', group: 'Vận hành', prefixes: ['/repair-quotes'], menuKeys: [] },
  { code: 'COMPLAINT_CATEGORIES', label: 'Danh mục phản ánh', group: 'Vận hành', prefixes: ['/complaint-categories'], menuKeys: ['complaint-settings'] },
  { code: 'DUTY_SHIFTS', label: 'Ca trực', group: 'Vận hành', prefixes: ['/duty-shifts'], menuKeys: ['duty-shifts'] },
  { code: 'GUESTS', label: 'Khách, bưu kiện và an ninh', group: 'Vận hành', prefixes: ['/guests'], menuKeys: ['guests'] },
  { code: 'PARKING_GATE', label: 'Kiểm soát xe ra vào', group: 'Vận hành', prefixes: ['/parking-gate', '/plates'], menuKeys: ['security-gate'] },
  { code: 'AMENITIES', label: 'Tiện ích', group: 'Vận hành', prefixes: ['/amenities'], menuKeys: ['amenities'] },
  { code: 'BOOKINGS', label: 'Đặt tiện ích', group: 'Vận hành', prefixes: ['/bookings'], menuKeys: ['booking-schedule', 'my-bookings', 'amenity-booking'] },
  { code: 'ANNOUNCEMENTS', label: 'Bảng tin', group: 'Vận hành', prefixes: ['/announcements'], menuKeys: ['announcements'] },
  // Tài chính
  { code: 'FEE_TYPES', label: 'Bảng phí', group: 'Tài chính', prefixes: ['/fee-types'], menuKeys: ['fee-types'] },
  { code: 'INVOICES', label: 'Thông báo phí', group: 'Tài chính', prefixes: ['/invoices'], menuKeys: ['invoices', 'invoice-generate', 'invoice-detail', 'my-invoices', 'my-invoice-detail'] },
  { code: 'PAYMENTS', label: 'Thanh toán', group: 'Tài chính', prefixes: ['/payments'], menuKeys: ['payments', 'payment-receipt', 'my-receipt', 'payment-result'] },
  { code: 'DEBTS', label: 'Công nợ', group: 'Tài chính', prefixes: ['/debts'], menuKeys: ['debts', 'debt-apartment'] },
  { code: 'FUND', label: 'Quỹ bảo trì', group: 'Tài chính', prefixes: ['/fund'], menuKeys: ['fund', 'fund-proposal'] },
  { code: 'REPORTS', label: 'Báo cáo', group: 'Tài chính', prefixes: ['/reports'], menuKeys: ['report-finance', 'report-supervision', 'report-billing', 'report-fund', 'report-operations', 'report-amenity'] },
  // Hệ thống
  { code: 'STAFF_ACCOUNTS', label: 'Tài khoản nội bộ', group: 'Hệ thống', prefixes: ['/users'], menuKeys: ['internal-accounts'] },
  { code: 'SYSTEM_CONFIGS', label: 'Cấu hình hệ thống', group: 'Hệ thống', prefixes: ['/system-configs'], menuKeys: [] },
  { code: 'AUDIT_LOGS', label: 'Nhật ký hoạt động', group: 'Hệ thống', prefixes: ['/audit-logs'], menuKeys: ['audit-logs'] },
  { code: 'SYSTEM_DASHBOARD', label: 'Dashboard hệ thống', group: 'Hệ thống', prefixes: ['/system-dashboard'], menuKeys: ['system-dashboard'] },
  { code: 'BUILDING_SETTINGS', label: 'Cấu hình tòa nhà & biểu phí', group: 'Hệ thống', prefixes: ['/building-profile', '/utility-tariffs', '/collection-settings'], menuKeys: ['building-settings'] },
];

/** Đường dẫn không thuộc ma trận: đăng nhập, hồ sơ của chính mình, thông báo, tra cứu dùng chung, trang phân quyền */
export const EXEMPT_PREFIXES = ['/auth', '/users/me', '/notifications', '/lookups', '/dev', '/permissions'];

/** BR-X3: quyền lõi không bỏ được (chỉ có hiệu lực ở ô nằm trong quyền trần của vai trò) */
export const CORE_PERMISSIONS = {
  TECHNICIAN: ['TICKETS:VIEW', 'TICKETS:UPDATE', 'WORK_ORDERS:VIEW', 'WORK_ORDERS:UPDATE', 'ASSETS:VIEW'],
  SECURITY: ['BOOKINGS:VIEW', 'BOOKINGS:UPDATE', 'PARKING_GATE:VIEW', 'PARKING_GATE:CREATE', 'PARKING_GATE:UPDATE', 'GUESTS:VIEW', 'GUESTS:CREATE', 'GUESTS:UPDATE'],
  ACCOUNTANT: ['INVOICES:VIEW', 'INVOICES:CREATE', 'INVOICES:UPDATE', 'PAYMENTS:VIEW', 'PAYMENTS:CREATE'],
  RECEPTIONIST: ['RESIDENTS:VIEW', 'RESIDENTS:UPDATE', 'VEHICLES:VIEW', 'VEHICLES:UPDATE', 'ACTIVATION_CODES:VIEW', 'ACTIVATION_CODES:CREATE'],
  BOARD: ['FUND:VIEW', 'FUND:APPROVE', 'REPORTS:VIEW'],
  RESIDENT: ['INVOICES:VIEW', 'PAYMENTS:VIEW', 'PAYMENTS:CREATE', 'TICKETS:VIEW', 'TICKETS:CREATE', 'TICKETS:UPDATE'],
  MANAGER: [],
};

// ===== Suy ra hành động từ phương thức HTTP + đường dẫn =====
/** Đoạn cuối của đường dẫn mang nghĩa phê duyệt / quyết định */
const APPROVE_WORDS = new Set([
  'approve', 'reject', 'publish', 'return', 'review', 'owner-decision', 'quote-decision', 'votes', 'accept-work',
  'repair-decision', 'accept', 'return-repair', // UC09, UC10: quyết định sửa chữa, nghiệm thu / yêu cầu sửa lại
]);
/** Ngoại lệ: đường dẫn mà quy tắc chung đoán sai (khóa: 'PHƯƠNG_THỨC /chức-năng/đường/dẫn' với tham số là :id) */
const ACTION_OVERRIDES = {
  'POST /bookings/check-in-by-qr': 'UPDATE', // Bảo vệ quét vé vào cửa: là cập nhật lượt đặt, không tạo mới
};

const isIdSegment = (s) => s.startsWith(':') || /^[0-9a-f]{24}$/i.test(s) || /^\d+$/.test(s);

/** Đường dẫn thật hoặc mẫu ('/tickets/:id/claim') → mẫu chuẩn với tham số là ':id' */
export const normalizePath = (path) =>
  `/${path.split('/').filter(Boolean).map((s) => (isIdSegment(s) ? ':id' : s)).join('/')}`;

/** (phương thức, đường dẫn đã chuẩn hóa) → hành động */
export function actionOf(method, path) {
  const m = method.toUpperCase();
  const override = ACTION_OVERRIDES[`${m} ${path}`];
  if (override) return override;
  if (m === 'GET' || m === 'HEAD') return 'VIEW';
  if (m === 'DELETE') return 'DELETE';
  const segments = path.split('/').filter(Boolean);
  const last = [...segments].reverse().find((s) => s !== ':id');
  if (APPROVE_WORDS.has(last)) return 'APPROVE';
  if (m === 'POST' && !segments.includes(':id')) return 'CREATE';
  return 'UPDATE';
}

/** Đường dẫn (không có /api) → chức năng; null = ngoài ma trận */
export function featureOf(path) {
  if (EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  let best = null;
  let bestLength = -1;
  for (const feature of FEATURES) {
    for (const prefix of feature.prefixes) {
      if ((path === prefix || path.startsWith(`${prefix}/`)) && prefix.length > bestLength) {
        best = feature;
        bestLength = prefix.length;
      }
    }
  }
  return best;
}

export const permissionKey = (featureCode, action) => `${featureCode}:${action}`;

import { BOARD_TITLES, ROLES, ROLE_TITLES } from '../constants/enums.js';
import { ApiError } from '../utils/ApiError.js';

const TITLES_BY_ROLE = {
  [ROLES.STAFF]: { field: 'roleTitle', values: Object.values(ROLE_TITLES) },
  [ROLES.BOARD]: { field: 'boardTitle', values: Object.values(BOARD_TITLES) },
};

/**
 * Kiểm tra user có khớp ít nhất một spec không (srs_final.md §2.3).
 *   'RESIDENT' | 'ACCOUNTANT' | 'MANAGER' | 'ADMIN' | 'STAFF' | 'BOARD' → đúng role đó
 *   'STAFF:TECHNICIAN'  → STAFF có roleTitle TECHNICIAN (RECEPTIONIST / SECURITY / TECHNICIAN)
 *   'BOARD:CHAIRMAN'    → BOARD có boardTitle CHAIRMAN (CHAIRMAN / MEMBER)
 * ADMIN KHÔNG tự có quyền nghiệp vụ của role khác (BR-R3).
 */
export function hasPermission(user, specs) {
  if (!user) return false;
  return specs.some((spec) => {
    const [role, title] = spec.split(':');
    if (user.role !== role) return false;
    if (!title) return true;
    return user[TITLES_BY_ROLE[role].field] === title;
  });
}

function assertValidSpec(spec) {
  const [role, title] = spec.split(':');
  const validRole = Object.values(ROLES).includes(role);
  const validTitle = !title || Boolean(TITLES_BY_ROLE[role]?.values.includes(title));
  if (!validRole || !validTitle) {
    throw new Error(`authorize(): spec không hợp lệ "${spec}"`);
  }
}

/**
 * Middleware phân quyền (NFR-03). Luôn đặt sau `authenticate`.
 * @example router.post('/', authenticate, authorize('MANAGER', 'STAFF:RECEPTIONIST'), controller.create)
 */
export function authorize(...specs) {
  // Bắt lỗi gõ sai role ngay lúc khởi động server thay vì lúc gọi API
  specs.forEach(assertValidSpec);

  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!hasPermission(req.user, specs)) return next(ApiError.forbidden());
    return next();
  };
}

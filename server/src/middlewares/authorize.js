import { ROLES, ROLE_TITLES } from '../constants/enums.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Kiểm tra user có khớp ít nhất một spec không.
 *   'ADMIN' | 'BOARD' | 'RESIDENT' → đúng role đó
 *   'STAFF'                        → mọi STAFF, và ADMIN (BR10: Admin có toàn quyền của Staff)
 *   'STAFF:ACCOUNTANT'             → STAFF có roleTitle ACCOUNTANT, và ADMIN
 */
export function hasPermission(user, specs) {
  if (!user) return false;
  return specs.some((spec) => {
    const [role, title] = spec.split(':');
    if (role === ROLES.STAFF) {
      if (user.role === ROLES.ADMIN) return true;
      return user.role === ROLES.STAFF && (!title || user.roleTitle === title);
    }
    return user.role === role;
  });
}

function assertValidSpec(spec) {
  const [role, title] = spec.split(':');
  const validRole = Object.values(ROLES).includes(role);
  const validTitle = !title || (role === ROLES.STAFF && Object.values(ROLE_TITLES).includes(title));
  if (!validRole || !validTitle) {
    throw new Error(`authorize(): spec không hợp lệ "${spec}"`);
  }
}

/**
 * Middleware phân quyền (NFR-03). Luôn đặt sau `authenticate`.
 * @example router.post('/income', authenticate, authorize('ADMIN', 'STAFF:ACCOUNTANT'), controller.recordIncome)
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

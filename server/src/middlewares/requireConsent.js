import { ROLES } from '../constants/enums.js';
import { User } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { consentState } from '../utils/consent.js';

/**
 * Khóa chức năng cần dữ liệu cá nhân khi cư dân chưa đồng ý, đã rút đồng ý, hoặc mới đồng ý bản điều khoản cũ
 * (điều khoản đã cập nhật, phải đồng ý lại) (BR-X7, MSG-S19).
 * Gắn sau `authenticate` ở khai báo nhân khẩu, đăng ký xe, tải ảnh của cư dân. Nhân viên không bị khóa.
 */
export async function requireConsent(req, _res, next) {
  if (req.user?.role !== ROLES.RESIDENT) return next();
  const user = await User.findById(req.user.id).select('consents').lean();
  if (!consentState(user?.consents).accepted) throw new ApiError('CONSENT_REQUIRED');
  next();
}

import { CONSENT_ACTIONS } from '../constants/enums.js';
import { User } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Khóa chức năng cần dữ liệu cá nhân khi người dùng chưa đồng ý hoặc đã rút đồng ý (BR-X7, MSG-S19).
 * Gắn sau `authenticate` ở khai báo nhân khẩu, đăng ký xe, tải ảnh.
 */
export async function requireConsent(req, _res, next) {
  const user = await User.findById(req.user.id).select('consents').lean();
  if (user?.consents?.at(-1)?.action !== CONSENT_ACTIONS.ACCEPTED) throw new ApiError('CONSENT_REQUIRED');
  next();
}

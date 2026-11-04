// Tìm tài khoản theo SĐT và kiểm tra trùng (BR-S01, BR-X5: 1 SĐT = 1 tài khoản).
import { User } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { normalizePhone } from '../../utils/validators.js';

export const phoneTakenError = () =>
  new ApiError('PHONE_EXISTS', undefined, { details: [{ field: 'phone', message: 'Số điện thoại đã được sử dụng' }] });

const emailTakenError = () =>
  new ApiError('EMAIL_EXISTS', undefined, { details: [{ field: 'email', message: 'Email đã được sử dụng' }] });

/** Lỗi trùng SĐT / email từ unique index → mã lỗi nghiệp vụ; lỗi khác trả null */
export function uniqueConflictError(err) {
  if (err?.code !== 11000) return null;
  if (err.keyPattern?.phone) return phoneTakenError();
  if (err.keyPattern?.email || err.message?.includes('uniq_email')) return emailTakenError();
  return null;
}

export const findUserByPhone = (phone, session = null) =>
  User.findOne({ phone: normalizePhone(phone) }).session(session);

/**
 * Chặn trùng khi tạo tài khoản mới, trả lỗi theo field trước khi ghi.
 * 2 request đồng thời có thể cùng qua bước này: unique index chặn, `uniqueConflictError` đổi sang mã lỗi nghiệp vụ.
 */
export async function assertPhoneAndEmailFree({ phone, email }, session = null) {
  if (await findUserByPhone(phone, session)) throw phoneTakenError();
  if (email && (await User.exists({ email: email.trim().toLowerCase() }).session(session))) {
    throw emailTakenError();
  }
}

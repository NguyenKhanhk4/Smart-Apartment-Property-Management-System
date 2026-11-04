// Tìm tài khoản theo SĐT và kiểm tra trùng (BR-S01, BR-X5: 1 SĐT = 1 tài khoản).
import { User } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { normalizePhone } from '../../utils/validators.js';

export const phoneTakenError = () =>
  new ApiError('PHONE_EXISTS', undefined, { details: [{ field: 'phone', message: 'Số điện thoại đã được sử dụng' }] });

const emailTakenError = () =>
  new ApiError('EMAIL_EXISTS', undefined, { details: [{ field: 'email', message: 'Email đã được sử dụng' }] });

export const findUserByPhone = (phone, session = null) =>
  User.findOne({ phone: normalizePhone(phone) }).session(session);

/**
 * Chặn trùng khi tạo tài khoản mới. Email không còn unique trong DB, nhưng đăng nhập vẫn tìm theo email
 * cho đến UC01 nên vẫn phải chặn trùng ở đây để một email không trỏ tới 2 tài khoản.
 */
export async function assertPhoneAndEmailFree({ phone, email }, session = null) {
  if (await findUserByPhone(phone, session)) throw phoneTakenError();
  if (email && (await User.exists({ email: email.trim().toLowerCase() }).session(session))) {
    throw emailTakenError();
  }
}

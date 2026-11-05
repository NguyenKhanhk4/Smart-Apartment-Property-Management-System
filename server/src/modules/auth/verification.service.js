// Tạo và kiểm tra mã xác minh (BR-S05). Dùng chung cho kích hoạt (UC11) và khôi phục mật khẩu (UC02).
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { VERIFICATION_CHANNELS } from '../../constants/enums.js';
import { VerificationCode } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';

export const OTP_TTL_MINUTES = 10;
export const OTP_RESEND_SECONDS = 60;
const MAX_ATTEMPTS = 5;

const invalidCode = () =>
  new ApiError('ACTIVATION_CODE_INVALID', undefined, {
    details: [{ field: 'code', message: 'Mã không đúng hoặc đã hết hạn' }],
  });

/** Hủy các mã chưa dùng của tài khoản: mỗi mục đích chỉ có 1 mã còn hiệu lực */
const voidCodes = (userId, purpose) =>
  VerificationCode.updateMany({ userId, purpose, usedAt: null }, { usedAt: new Date() });

/** Tạo OTP 6 số gửi qua email, trả về mã gốc. Gửi lại quá sớm → 429 */
export async function issueEmailOtp(userId, purpose) {
  const recentlySent = await VerificationCode.exists({
    userId,
    purpose,
    channel: VERIFICATION_CHANNELS.EMAIL_OTP,
    createdAt: { $gt: new Date(Date.now() - OTP_RESEND_SECONDS * 1000) },
  });
  if (recentlySent) throw new ApiError('OTP_RESEND_TOO_SOON');

  await voidCodes(userId, purpose);
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await VerificationCode.create({
    userId,
    purpose,
    channel: VERIFICATION_CHANNELS.EMAIL_OTP,
    codeHash: await bcrypt.hash(code, 10),
    expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
  });
  return code;
}

/**
 * Kiểm tra mã còn hiệu lực. Tính lượt trước khi so sánh để nhiều request song song
 * cũng không thử được quá MAX_ATTEMPTS lần. Mã chưa bị đánh dấu đã dùng ở bước này.
 */
export async function checkCode(userId, purpose, code) {
  const record = await VerificationCode.findOneAndUpdate(
    { userId, purpose, usedAt: null, expiresAt: { $gt: new Date() }, attempts: { $lt: MAX_ATTEMPTS } },
    { $inc: { attempts: 1 } },
    { sort: { createdAt: -1 }, new: true },
  );
  if (!record || !(await bcrypt.compare(code, record.codeHash))) throw invalidCode();
  return record;
}

/** Đánh dấu đã dùng trong transaction; 2 request cùng lúc thì chỉ 1 request thành công */
export async function claimCode(recordId, session) {
  const claimed = await VerificationCode.findOneAndUpdate(
    { _id: recordId, usedAt: null },
    { usedAt: new Date() },
    { session },
  );
  if (!claimed) throw invalidCode();
}

/** Gửi email thất bại: bỏ mã vừa tạo, người dùng được gửi lại ngay */
export const discardCodes = (userId, purpose) => VerificationCode.deleteMany({ userId, purpose, usedAt: null });

export { invalidCode };

// Tạo và kiểm tra mã xác minh (BR-S05). Dùng chung cho kích hoạt (UC11) và khôi phục mật khẩu (UC02).
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { VERIFICATION_CHANNELS } from '../../constants/enums.js';
import { VerificationCode } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';

export const OTP_TTL_MINUTES = 10;
export const DESK_CODE_TTL_HOURS = 48; // BR-S05
// Mã in tại quầy: 8 ký tự, bỏ chữ dễ nhầm (0/O, 1/I/L) vì người dùng tự gõ lại
const DESK_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const DESK_CODE_LENGTH = 8;
export const OTP_RESEND_SECONDS = 60;
const MAX_ATTEMPTS = 5;
// Mỗi mã chỉ thử được 5 lần, nên giới hạn số mã mỗi ngày để không đoán dần được bằng cách xin mã mới liên tục
export const OTP_DAILY_LIMIT = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

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
  const sentToday = await VerificationCode.countDocuments({
    userId,
    purpose,
    channel: VERIFICATION_CHANNELS.EMAIL_OTP,
    createdAt: { $gt: new Date(Date.now() - DAY_MS) },
  });
  if (sentToday >= OTP_DAILY_LIMIT) throw new ApiError('OTP_DAILY_LIMIT');

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
export async function checkCode(userId, purpose, input, { channel } = {}) {
  // Mã in có thể được gõ kèm khoảng trắng, gạch ngang, chữ thường
  const code = String(input).replace(/[\s-]/g, '').toUpperCase();
  const record = await VerificationCode.findOneAndUpdate(
    {
      userId,
      purpose,
      ...(channel && { channel }),
      usedAt: null,
      expiresAt: { $gt: new Date() },
      attempts: { $lt: MAX_ATTEMPTS },
    },
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

/** Mã in tại quầy (UC02): hủy mã cũ cùng mục đích, kể cả OTP email; trả mã gốc để in 1 lần */
export async function createDeskCode(userId, purpose, issuedBy) {
  await voidCodes(userId, purpose);
  const code = Array.from({ length: DESK_CODE_LENGTH }, () => DESK_ALPHABET[crypto.randomInt(DESK_ALPHABET.length)]).join('');
  const expiresAt = new Date(Date.now() + DESK_CODE_TTL_HOURS * 60 * 60 * 1000);
  await VerificationCode.create({
    userId,
    purpose,
    channel: VERIFICATION_CHANNELS.DESK_CODE,
    codeHash: await bcrypt.hash(code, 10),
    expiresAt,
    issuedBy,
  });
  return { code, expiresAt };
}

/** Đổi SĐT: mã đã in / đã gửi theo số cũ không còn dùng được */
export const voidAllCodes = (userId) => VerificationCode.updateMany({ userId, usedAt: null }, { usedAt: new Date() });

/** Gửi email thất bại: bỏ mã vừa tạo, người dùng được gửi lại ngay */
export const discardCodes = (userId, purpose) => VerificationCode.deleteMany({ userId, purpose, usedAt: null });

export { invalidCode };

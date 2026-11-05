import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGETS,
  CONSENT_POLICY_VERSION,
  ROLES,
  VERIFICATION_PURPOSES,
} from '../../constants/enums.js';
import { Apartment, Resident, User } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { sendMail } from '../../services/mail.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { withTransaction } from '../../utils/transaction.js';
import { findUserByPhone } from '../users/userLookup.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from './auth.tokens.js';
import { checkCode, claimCode, discardCodes, invalidCode, issueEmailOtp, OTP_RESEND_SECONDS, OTP_TTL_MINUTES } from './verification.service.js';

/**
 * Chuẩn hóa đối tượng user trả về cho client (không bao giờ lộ passwordHash, tokenVersion)
 */
export function toPublicUser(user) {
  if (!user) return null;
  return {
    id: String(user._id ?? user.id),
    _id: user._id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone ?? null,
    avatarUrl: user.avatarUrl ?? null,
    dateOfBirth: user.dateOfBirth ?? null,
    role: user.role,
    roleTitle: user.roleTitle ?? null,
    boardTitle: user.boardTitle ?? null,
    isActive: user.isActive,
    consentStatus: user.consents?.at(-1)?.action ?? null, // BR-X7
  };
}

/** Cư dân phải đang ở căn hộ có mã này */
async function livesInApartment(userId, apartmentCode) {
  const code = apartmentCode?.trim().toUpperCase();
  if (!code) return false;
  const residents = await Resident.find({ userId, isActive: true }).select('apartmentId').lean();
  return Apartment.exists({ _id: { $in: residents.map((r) => r.apartmentId) }, code });
}

/**
 * UC11 bước 1–2: khớp dữ liệu đăng ký trước thì gửi OTP (BR-S06). Mọi trường hợp không kích hoạt được
 * đều trả cùng một lỗi để không lộ SĐT nào có tài khoản hay đã kích hoạt.
 */
export async function startActivation({ phone, apartmentCode, email }) {
  const user = await findUserByPhone(phone).select('email role activatedAt isActive');
  const matched =
    user?.isActive &&
    !user.activatedAt &&
    user.email &&
    user.email === email.trim().toLowerCase() &&
    (user.role !== ROLES.RESIDENT || (await livesInApartment(user._id, apartmentCode)));
  if (!matched) throw new ApiError('ACTIVATION_DATA_MISMATCH');

  const code = await issueEmailOtp(user._id, VERIFICATION_PURPOSES.ACTIVATION);
  const text = `Mã xác minh của bạn là ${code}. Mã có hiệu lực trong ${OTP_TTL_MINUTES} phút.`;
  let sent = await sendMail({ to: user.email, subject: '[SAPMS] Mã kích hoạt tài khoản', text });
  // Máy dev chưa cấu hình SMTP: in mã ra console để vẫn thử được luồng
  if (!sent && env.isDev && !env.smtp.enabled) {
    console.log(`[dev] OTP kích hoạt của ${user.email}: ${code}`);
    sent = true;
  }
  if (!sent) {
    await discardCodes(user._id, VERIFICATION_PURPOSES.ACTIVATION);
    throw new ApiError('ACTIVATION_EMAIL_FAILED');
  }
  return { expiresInMinutes: OTP_TTL_MINUTES, resendAfterSeconds: OTP_RESEND_SECONDS };
}

/**
 * UC11 bước 3–5: nhận OTP hoặc mã in tại quầy, đặt mật khẩu, ghi quyết định về điều khoản.
 * Từ chối điều khoản vẫn kích hoạt được, chỉ bị giới hạn chức năng (BR-X7).
 */
export async function confirmActivation({ phone, code, password, consent }, { ip } = {}) {
  const user = await findUserByPhone(phone).select('role activatedAt isActive');
  if (!user?.isActive || user.activatedAt) throw invalidCode();

  const record = await checkCode(user._id, VERIFICATION_PURPOSES.ACTIVATION, code);
  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date();

  await withTransaction(async (session) => {
    await claimCode(record._id, session);
    const { modifiedCount } = await User.updateOne(
      { _id: user._id, activatedAt: null, isActive: true },
      {
        $set: { passwordHash, activatedAt: now },
        $inc: { tokenVersion: 1 },
        $push: { consents: { action: consent, policyVersion: CONSENT_POLICY_VERSION, createdAt: now } },
      },
      { session },
    );
    if (!modifiedCount) throw invalidCode();
    await logAudit(
      {
        action: AUDIT_ACTIONS.ACCOUNT_ACTIVATED,
        user: { id: user._id },
        targetType: AUDIT_TARGETS.USER,
        targetId: user._id,
        metadata: { channel: record.channel, consent, policyVersion: CONSENT_POLICY_VERSION },
        ip,
      },
      { session },
    );
  });
}

/**
 * UC-A02 — Đăng nhập hệ thống (Public)
 */
export async function login({ email, password }) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash +tokenVersion');

  // Chưa kích hoạt thì chưa có mật khẩu (UC01 sẽ chuyển sang trang kích hoạt)
  if (!user?.passwordHash) {
    throw new ApiError('AUTH_INVALID_CREDENTIALS');
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    throw new ApiError('AUTH_INVALID_CREDENTIALS');
  }

  if (!user.isActive) {
    throw new ApiError('FORBIDDEN_ROLE', 'Tài khoản đã bị khóa');
  }

  user.lastLoginAt = new Date();
  await user.save();

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  return {
    user: toPublicUser(user),
    accessToken,
    refreshToken,
  };
}

/**
 * Cấp mới cặp token bằng refresh token (Public)
 */
export async function refresh({ refreshToken }) {
  if (!refreshToken) {
    throw ApiError.unauthorized();
  }

  const decoded = verifyRefreshToken(refreshToken);
  if (!decoded || !decoded.sub) {
    throw ApiError.unauthorized();
  }

  const user = await User.findById(decoded.sub).select('+tokenVersion');
  if (!user || !user.isActive || user.tokenVersion !== decoded.tv) {
    throw ApiError.unauthorized();
  }

  const newAccessToken = signAccessToken(user);
  const newRefreshToken = signRefreshToken(user);

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  };
}

/**
 * Đăng xuất: tăng tokenVersion để thu hồi mọi refresh token của tài khoản (BR-S04).
 * Xác định người dùng bằng refresh token để vẫn thu hồi được khi access token đã hết hạn.
 * Token không hợp lệ hoặc đã bị thu hồi thì bỏ qua: không ảnh hưởng phiên mới hơn của tài khoản.
 */
export async function logout({ refreshToken }) {
  const decoded = verifyRefreshToken(refreshToken);
  if (!decoded?.sub) return;

  const user = await User.findById(decoded.sub).select('+tokenVersion');
  if (!user || user.tokenVersion !== decoded.tv) return;

  await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });
}

import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGETS,
  CONSENT_POLICY_VERSION,
  ROLES,
  VERIFICATION_CHANNELS,
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
  const user = await findUserByPhone(phone).select('role activatedAt isActive consents');
  if (!user?.isActive) throw invalidCode();
  // UC02 bước 7: trang kích hoạt cũng nhận mã đặt lại mật khẩu in tại quầy cho tài khoản đã kích hoạt
  if (user.activatedAt) {
    const record = await checkCode(user._id, VERIFICATION_PURPOSES.PASSWORD_RESET, code, {
      channel: VERIFICATION_CHANNELS.DESK_CODE,
    });
    await applyPasswordReset(user, record, password, { ip, consent });
    return { mode: 'PASSWORD_RESET' };
  }

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
  return { mode: 'ACTIVATED' };
}

/**
 * Đặt mật khẩu mới bằng mã còn hiệu lực, thu hồi mọi phiên (BR-S02). Quyết định về điều khoản
 * chỉ ghi thêm khi khác lần gần nhất (người được cấp mã tại quầy chọn lại ở trang kích hoạt).
 */
async function applyPasswordReset(user, record, password, { ip, consent } = {}) {
  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date();
  const consentChanged = consent && user.consents?.at(-1)?.action !== consent;

  await withTransaction(async (session) => {
    await claimCode(record._id, session);
    const { modifiedCount } = await User.updateOne(
      { _id: user._id, isActive: true, activatedAt: { $ne: null } },
      {
        $set: { passwordHash },
        $inc: { tokenVersion: 1 },
        ...(consentChanged && {
          $push: { consents: { action: consent, policyVersion: CONSENT_POLICY_VERSION, createdAt: now } },
        }),
      },
      { session },
    );
    if (!modifiedCount) throw invalidCode();
    await logAudit(
      {
        action: AUDIT_ACTIONS.PASSWORD_RESET,
        user: { id: user._id },
        targetType: AUDIT_TARGETS.USER,
        targetId: user._id,
        metadata: { channel: record.channel, ...(consentChanged && { consent }) },
        ip,
      },
      { session },
    );
  });
}

/**
 * UC02 bước 1–2: gửi OTP đặt lại mật khẩu nếu SĐT có tài khoản đã kích hoạt và có email.
 * Luôn trả cùng một kết quả (kể cả gửi quá sớm, quá số lần, lỗi email) để không dò được SĐT nào có tài khoản;
 * người không có email được hướng dẫn ra quầy (Step 2a).
 */
export async function forgotPassword({ phone }) {
  const user = await findUserByPhone(phone).select('email activatedAt isActive');
  if (user?.isActive && user.activatedAt && user.email) {
    try {
      const code = await issueEmailOtp(user._id, VERIFICATION_PURPOSES.PASSWORD_RESET);
      const text = `Mã đặt lại mật khẩu của bạn là ${code}. Mã có hiệu lực trong ${OTP_TTL_MINUTES} phút.`;
      let sent = await sendMail({ to: user.email, subject: '[SAPMS] Mã đặt lại mật khẩu', text });
      if (!sent && env.isDev && !env.smtp.enabled) {
        console.log(`[dev] OTP đặt lại mật khẩu của ${user.email}: ${code}`);
        sent = true;
      }
      if (!sent) await discardCodes(user._id, VERIFICATION_PURPOSES.PASSWORD_RESET);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    }
  }
  return { expiresInMinutes: OTP_TTL_MINUTES, resendAfterSeconds: OTP_RESEND_SECONDS };
}

/** UC02 bước 3–4: OTP email hoặc mã in tại quầy, mật khẩu mới, thu hồi mọi phiên (MSG-S10) */
export async function resetPassword({ phone, code, password }, { ip } = {}) {
  const user = await findUserByPhone(phone).select('activatedAt isActive consents');
  if (!user?.isActive || !user.activatedAt) throw invalidCode();
  const record = await checkCode(user._id, VERIFICATION_PURPOSES.PASSWORD_RESET, code);
  await applyPasswordReset(user, record, password, { ip });
}

/**
 * UC-A02 — Đăng nhập hệ thống (Public)
 */
export const MAX_FAILED_LOGINS = 5; // BR-S03
export const LOGIN_LOCK_MINUTES = 15;
// So mật khẩu với một hash giả khi không có tài khoản, để thời gian phản hồi không lộ SĐT nào tồn tại
const DUMMY_HASH = bcrypt.hashSync('khong-phai-mat-khau', 10);

/** Ghi 1 lần sai trong 1 lệnh cập nhật: đủ MAX_FAILED_LOGINS thì khóa tạm và đếm lại từ 0 */
async function recordFailedLogin(userId, now) {
  const next = { $add: [{ $ifNull: ['$failedLoginCount', 0] }, 1] };
  const reached = { $gte: [next, MAX_FAILED_LOGINS] };
  const updated = await User.findOneAndUpdate(
    { _id: userId },
    [
      {
        $set: {
          failedLoginCount: { $cond: [reached, 0, next] },
          lockedUntil: { $cond: [reached, new Date(now.getTime() + LOGIN_LOCK_MINUTES * 60 * 1000), '$lockedUntil'] },
        },
      },
    ],
    { new: true, updatePipeline: true },
  ).select('+lockedUntil');
  return updated?.lockedUntil > now;
}

/** Căn hộ đang ở của cư dân, để client biết có cần màn hình Chọn căn hộ không (UC01 bước 5) */
async function apartmentsOf(user) {
  if (user.role !== ROLES.RESIDENT) return [];
  const residents = await Resident.find({ userId: user._id, isActive: true })
    .select('apartmentId relationType')
    .populate({ path: 'apartmentId', select: 'code buildingId', populate: { path: 'buildingId', select: 'name' } })
    .lean();
  return residents
    .filter((r) => r.apartmentId)
    .map((r) => ({
      apartmentId: r.apartmentId._id,
      code: r.apartmentId.code,
      building: r.apartmentId.buildingId?.name ?? null,
      relationType: r.relationType,
    }));
}

/**
 * UC01: đăng nhập bằng SĐT + mật khẩu (BR-S01). Thứ tự kiểm tra:
 * tạm khóa → chưa kích hoạt (Step 2c) → mật khẩu (sai thì đếm, đủ 5 lần khóa 15 phút, BR-S03) → bị Trưởng BQL khóa (Step 3a).
 */
export async function login({ phone, password }, { now = new Date() } = {}) {
  const user = await findUserByPhone(phone).select('+passwordHash +tokenVersion +lockedUntil +failedLoginCount');
  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw new ApiError('AUTH_INVALID_CREDENTIALS');
  }
  if (user.lockedUntil > now) throw new ApiError('ACCOUNT_LOCKED_TEMP');
  if (!user.activatedAt || !user.passwordHash) throw new ApiError('ACCOUNT_NOT_ACTIVATED');

  if (!(await bcrypt.compare(password, user.passwordHash))) {
    throw new ApiError((await recordFailedLogin(user._id, now)) ? 'ACCOUNT_LOCKED_TEMP' : 'AUTH_INVALID_CREDENTIALS');
  }
  if (!user.isActive) throw new ApiError('FORBIDDEN_ROLE', 'Tài khoản đã bị khóa');

  await User.updateOne({ _id: user._id }, { $set: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now } });
  return {
    user: toPublicUser(user),
    apartments: await apartmentsOf(user),
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user),
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

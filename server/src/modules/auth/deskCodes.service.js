// UC02 bước 5–6: Lễ tân đối chiếu CCCD rồi cấp mã in tại quầy, hạn 48 giờ (BR-X4, BR-S05).
import { AUDIT_ACTIONS, AUDIT_TARGETS, ROLES, VERIFICATION_PURPOSES } from '../../constants/enums.js';
import { Apartment, Resident, User } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { findUserByPhone } from '../users/userLookup.js';
import { decryptIdNumber, maskIdNumber } from '../residents/idCrypto.js';
import { createDeskCode } from './verification.service.js';

/**
 * Ai được cấp mã cho ai. Mã tại quầy đặt lại được mật khẩu, nên phải chặn việc nhân viên
 * lấy quyền vào tài khoản có quyền cao hơn mình:
 * - Lễ tân chỉ cấp cho cư dân.
 * - Trưởng BQL cấp cho cư dân và nhân viên.
 * - Không ai cấp cho tài khoản Trưởng BQL: dùng Quên mật khẩu qua email hoặc `npm run db:set-manager`.
 */
function issueBlockReason(actor, target) {
  if (!target.isActive) return 'Tài khoản đang bị khóa, không cấp mã';
  if (target.role === ROLES.MANAGER) {
    return 'Không cấp mã tại quầy cho tài khoản Trưởng BQL. Dùng Quên mật khẩu qua email hoặc script cài đặt';
  }
  if (actor.role !== ROLES.MANAGER && target.role !== ROLES.RESIDENT) {
    return 'Lễ tân chỉ cấp mã cho cư dân. Tài khoản nhân viên do Trưởng BQL cấp';
  }
  return null;
}

const accountStatus = (user) => {
  if (!user.isActive) return 'LOCKED';
  return user.activatedAt ? 'ACTIVE' : 'PENDING';
};

/** Thông tin đã che để lễ tân đối chiếu với giấy tờ; không trả mã cũ */
export async function lookupForDeskCode(actor, phone) {
  const user = await findUserByPhone(phone).select('fullName phone email role roleTitle boardTitle activatedAt isActive').lean();
  if (!user) throw ApiError.notFound('Không có tài khoản với số điện thoại này');

  const residents = await Resident.find({ userId: user._id, isActive: true }).select('apartmentId idNumberEnc createdAt').lean();
  const apartments = await Apartment.find({ _id: { $in: residents.map((r) => r.apartmentId) } }).select('code').lean();
  const withId = residents.filter((r) => r.idNumberEnc).sort((a, b) => b.createdAt - a.createdAt)[0];
  const blockReason = issueBlockReason(actor, user);

  return {
    userId: user._id,
    phone: user.phone,
    fullName: user.fullName,
    role: user.role,
    roleTitle: user.roleTitle ?? null,
    boardTitle: user.boardTitle ?? null,
    status: accountStatus(user),
    hasEmail: Boolean(user.email),
    idNumber: maskIdNumber(decryptIdNumber(withId?.idNumberEnc)),
    apartments: apartments.map((a) => a.code).sort(),
    purpose: user.activatedAt ? VERIFICATION_PURPOSES.PASSWORD_RESET : VERIFICATION_PURPOSES.ACTIVATION,
    canIssue: !blockReason,
    blockReason,
  };
}

/** Cấp mã mới (hủy mã tại quầy và OTP cũ cùng mục đích). Mã gốc chỉ trả 1 lần ở đây để in */
export async function issueDeskCode(actor, userId, { ip } = {}) {
  const user = await User.findById(userId).select('fullName phone role activatedAt isActive').lean();
  if (!user) throw ApiError.notFound('Không tìm thấy tài khoản');
  const blockReason = issueBlockReason(actor, user);
  if (blockReason) {
    throw user.isActive ? ApiError.forbidden(blockReason) : new ApiError('STATUS_CONFLICT', blockReason);
  }

  const purpose = user.activatedAt ? VERIFICATION_PURPOSES.PASSWORD_RESET : VERIFICATION_PURPOSES.ACTIVATION;
  const { code, expiresAt } = await createDeskCode(user._id, purpose, actor.id);
  await logAudit({
    action: AUDIT_ACTIONS.ACTIVATION_CODE_ISSUED,
    user: actor,
    targetType: AUDIT_TARGETS.USER,
    targetId: user._id,
    metadata: { purpose, expiresAt },
    ip,
  });
  return { code, phone: user.phone, fullName: user.fullName, purpose, expiresAt };
}

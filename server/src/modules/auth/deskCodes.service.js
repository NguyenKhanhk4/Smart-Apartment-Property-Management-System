// UC02 bước 5–6: Lễ tân đối chiếu CCCD rồi cấp mã in tại quầy, hạn 48 giờ (BR-X4, BR-S05).
import { AUDIT_ACTIONS, AUDIT_TARGETS, CONTRACT_TYPES, ROLES, VERIFICATION_PURPOSES } from '../../constants/enums.js';
import { Apartment, Contract, Resident, User } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { findUserByPhone, phoneTakenError, uniqueConflictError } from '../users/userLookup.js';
import { recordContactChange } from '../users/contactChanges.js';
import { normalizePhone } from '../../utils/validators.js';
import { decryptIdNumber, maskIdNumber } from '../residents/idCrypto.js';
import { createDeskCode, voidAllCodes } from './verification.service.js';

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

async function activationBlockReason(actor, user, hasResidence) {
  const blocked = issueBlockReason(actor, user);
  if (blocked || user.role !== ROLES.RESIDENT || user.activatedAt) return blocked;
  const resident = hasResidence ?? await Resident.exists({ userId: user._id, isActive: true });
  if (!resident && await Contract.exists({ ownerId: user._id, type: CONTRACT_TYPES.SALE, ownerAccountPending: true })) {
    return 'Ban quản lý cần cấp tài khoản chủ sở hữu trước khi cấp mã kích hoạt';
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
  const blockReason = await activationBlockReason(actor, user, residents.length > 0);

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

/**
 * Đổi SĐT tại quầy sau khi đối chiếu CCCD. SĐT là tên đăng nhập và hệ thống không gửi SMS nên người dùng
 * không tự đổi được. Phân quyền giống cấp mã. Số mới đã có tài khoản thì từ chối, không gộp (BR-X5).
 * Thu hồi mọi phiên, hủy mã chưa dùng, ghi audit, báo cho người dùng. Mật khẩu giữ nguyên.
 */
export async function changePhoneAtDesk(actor, userId, phone, { ip } = {}) {
  const user = await User.findById(userId).select('+tokenVersion');
  if (!user) throw ApiError.notFound('Không tìm thấy tài khoản');
  const blockReason = issueBlockReason(actor, user);
  if (blockReason) throw user.isActive ? ApiError.forbidden(blockReason.replace('cấp mã', 'đổi số')) : new ApiError('STATUS_CONFLICT', blockReason);

  const nextPhone = normalizePhone(phone);
  if (nextPhone === user.phone) throw ApiError.field('phone', 'Số mới trùng với số hiện tại');
  if (await findUserByPhone(nextPhone)) throw phoneTakenError();

  const before = user.phone;
  user.phone = nextPhone;
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  await user.save().catch((err) => {
    throw uniqueConflictError(err) ?? err;
  });
  await voidAllCodes(user._id);
  await recordContactChange({ actor, user, field: 'phone', before, after: user.phone, ip });
  return lookupForDeskCode(actor, user.phone);
}

/** Cấp mã mới (hủy mã tại quầy và OTP cũ cùng mục đích). Mã gốc chỉ trả 1 lần ở đây để in */
export async function issueDeskCode(actor, userId, { ip } = {}) {
  const user = await User.findById(userId).select('fullName phone role activatedAt isActive').lean();
  if (!user) throw ApiError.notFound('Không tìm thấy tài khoản');
  const blockReason = await activationBlockReason(actor, user);
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

import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';
import { AUDIT_ACTIONS, AUDIT_TARGETS, BOARD_TITLES, CONSENT_ACTIONS, CONSENT_POLICY_VERSION, ROLES } from '../../constants/enums.js';
import { Resident, User } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { assertPhoneAndEmailFree, uniqueConflictError } from './userLookup.js';
import { escapeRegex, paginate } from '../../utils/pagination.js';
import { logAudit } from '../../services/auditLog.service.js';
import { sendMail } from '../../services/mail.service.js';
import { uploadToCloudinary } from '../../services/upload.service.js';
import { parseDateOfBirth, ensureCodes } from '../memberCodes/memberCodes.service.js';
import { toPublicUser, verifyCurrentPassword } from '../auth/auth.service.js';
import { voidAllCodes } from '../auth/verification.service.js';
import { recordContactChange } from './contactChanges.js';
import { signAccessToken, signRefreshToken } from '../auth/auth.tokens.js';

/**
 * UC-A03: Xem hồ sơ cá nhân
 */
export async function getMe(userId) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('Không tìm thấy tài khoản');
  return toPublicUser(user);
}

/**
 * UC-A03: Cập nhật hồ sơ cá nhân
 */
/** SĐT không sửa ở đây (là tên đăng nhập); email sửa được, bỏ trống thì xóa */
export async function updateMe(userId, { fullName, email, currentPassword, dateOfBirth }, { ip } = {}) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('Không tìm thấy tài khoản');
  const oldEmail = user.email ?? null;

  if (fullName !== undefined) user.fullName = fullName.trim();
  // Email là kênh khôi phục mật khẩu: đổi hoặc xóa phải nhập lại mật khẩu (chống chiếm tài khoản khi lộ phiên)
  if (email !== undefined && (email?.trim().toLowerCase() || null) !== oldEmail) {
    if (!currentPassword) throw ApiError.field('currentPassword', 'Nhập mật khẩu hiện tại để đổi email');
    await verifyCurrentPassword(userId, currentPassword);
    const nextEmail = email?.trim().toLowerCase() || null;
    if (nextEmail && nextEmail !== user.email && (await User.exists({ email: nextEmail, _id: { $ne: user._id } }))) {
      throw new ApiError('EMAIL_EXISTS', undefined, { details: [{ field: 'email', message: 'Email đã được sử dụng' }] });
    }
    user.email = nextEmail;
  }
  if (dateOfBirth !== undefined) {
    user.dateOfBirth = parseDateOfBirth(dateOfBirth);
  }

  await saveUnique(() => user.save());
  if ((user.email ?? null) !== oldEmail) {
    await recordContactChange({ actor: { id: userId }, user, field: 'email', before: oldEmail, after: user.email, ip });
  }
  return toPublicUser(user);
}

/**
 * BR-X7: đồng ý hoặc rút lại đồng ý trong hồ sơ. Giữ toàn bộ lịch sử, ghi audit log.
 * Đồng ý lại khi đang đồng ý thì không ghi thêm; chưa đồng ý thì không có gì để rút.
 */
export async function updateConsent(userId, { action }, { ip } = {}) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('Không tìm thấy tài khoản');
  const current = user.consents.at(-1)?.action;
  if (action === CONSENT_ACTIONS.WITHDRAWN && current !== CONSENT_ACTIONS.ACCEPTED) {
    throw new ApiError('STATUS_CONFLICT', 'Bạn chưa đồng ý với điều khoản nên không có gì để rút lại');
  }
  if (action === current) return toPublicUser(user);

  const entry = { action, policyVersion: CONSENT_POLICY_VERSION, createdAt: new Date() };
  await User.updateOne({ _id: userId }, { $push: { consents: entry } });
  await logAudit({
    action: AUDIT_ACTIONS.CONSENT_CHANGED,
    user: { id: userId },
    targetType: AUDIT_TARGETS.USER,
    targetId: userId,
    metadata: { action, policyVersion: CONSENT_POLICY_VERSION },
    ip,
  });
  return toPublicUser(await User.findById(userId));
}

/**
 * UC-A03: Cập nhật ảnh đại diện (avatar)
 */
export async function updateAvatar(userId, files) {
  if (!files || !files.length) {
    throw ApiError.badRequest('Vui lòng chọn ảnh đại diện');
  }

  const urls = await uploadToCloudinary(files, 'avatars');
  const avatarUrl = urls[0];

  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('Không tìm thấy tài khoản');

  user.avatarUrl = avatarUrl;
  await user.save();

  return toPublicUser(user);
}

/**
 * UC-A03: Đổi mật khẩu
 */
export async function changePassword(userId, { currentPassword, newPassword }) {
  // Sai mật khẩu hiện tại tính chung bộ đếm khóa với đăng nhập (BR-S03)
  await verifyCurrentPassword(userId, currentPassword);
  const user = await User.findById(userId).select('+passwordHash +tokenVersion');
  if (!user) throw ApiError.notFound('Không tìm thấy tài khoản');

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
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
 * UC-A04: Danh sách tài khoản nội bộ (Trưởng BQL)
 */
export async function listInternal(query = {}) {
  const filter = { role: { $ne: ROLES.RESIDENT } };

  if (query.role) filter.role = query.role;
  if (query.roleTitle) filter.roleTitle = query.roleTitle;
  if (query.boardTitle) filter.boardTitle = query.boardTitle;
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.status === 'LOCKED') filter.isActive = false;
  if (query.status === 'ACTIVE') Object.assign(filter, { isActive: true, activatedAt: { $ne: null } });
  if (query.status === 'PENDING') Object.assign(filter, { isActive: true, activatedAt: null });

  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    filter.$or = [{ fullName: rx }, { email: rx }, { phone: rx }];
  }

  const { items, pagination } = await paginate(User, filter, query, { select: '+lockedUntil' });
  const now = new Date();

  return {
    // Khóa tạm do nhập sai mật khẩu 5 lần (BR-S03): Trưởng BQL gỡ được bằng nút Mở khóa
    items: items.map((u) => ({ ...toPublicUser(u), tempLockedUntil: u.lockedUntil > now ? u.lockedUntil : null })),
    pagination,
  };
}

// ===== BR-R1 / BR-R2: chỉ 1 Trưởng BQL và 1 Trưởng BQT đang hoạt động =====
/** Kiểm tra trước khi ghi: `user` sẽ là MANAGER / CHAIRMAN đang hoạt động thì không được có người khác giữ vai trò đó */
async function assertSingleHolder({ role, boardTitle, excludeId = null }) {
  const notSelf = excludeId ? { _id: { $ne: excludeId } } : {};
  if (role === ROLES.MANAGER && (await User.exists({ role: ROLES.MANAGER, isActive: true, ...notSelf }))) {
    throw new ApiError('MANAGER_ALREADY_EXISTS');
  }
  if (
    role === ROLES.BOARD &&
    boardTitle === BOARD_TITLES.CHAIRMAN &&
    (await User.exists({ boardTitle: BOARD_TITLES.CHAIRMAN, isActive: true, ...notSelf }))
  ) {
    throw new ApiError('CHAIRMAN_ALREADY_EXISTS');
  }
}

/** Ghi user; lỗi trùng unique index (2 request đồng thời vượt qua bước kiểm tra) → mã lỗi nghiệp vụ */
async function saveUnique(write) {
  try {
    return await write();
  } catch (err) {
    if (err?.code !== 11000) throw err;
    if (err.keyPattern?.role || err.message?.includes('uniq_active_manager')) throw new ApiError('MANAGER_ALREADY_EXISTS');
    if (err.keyPattern?.boardTitle || err.message?.includes('uniq_active_chairman')) {
      throw new ApiError('CHAIRMAN_ALREADY_EXISTS');
    }
    throw uniqueConflictError(err) ?? err;
  }
}

/**
 * UC-A04: Tạo tài khoản nội bộ (Trưởng BQL). Mật khẩu tạm gửi qua email; chỉ trả về API khi gửi email thất bại.
 */
export async function createInternal(managerUser, { fullName, email, phone, role, roleTitle, boardTitle }, { ip } = {}) {
  const normalizedEmail = email?.trim().toLowerCase() || null;
  const titleForRole = role === ROLES.STAFF ? roleTitle : null;
  const boardForRole = role === ROLES.BOARD ? boardTitle : null;

  await assertSingleHolder({ role, boardTitle: boardForRole });
  await assertPhoneAndEmailFree({ phone, email: normalizedEmail });

  // UC03 bước 3: tạo ở trạng thái Chờ kích hoạt, không có mật khẩu (BR-S02); nhân viên tự đặt ở UC11
  const newUser = await saveUnique(async () =>
    User.create({
      fullName: fullName.trim(),
      email: normalizedEmail,
      phone,
      role,
      roleTitle: titleForRole,
      boardTitle: boardForRole,
      isActive: true,
    }),
  );

  await logAudit({
    action: AUDIT_ACTIONS.ROLE_ASSIGNED,
    user: managerUser,
    targetType: AUDIT_TARGETS.USER,
    targetId: newUser._id,
    metadata: { role, roleTitle: titleForRole, boardTitle: boardForRole },
    ip,
  });

  // Không có email thì Trưởng BQL cấp mã kích hoạt tại quầy (UC02)
  const inviteSent =
    Boolean(normalizedEmail) &&
    (await sendMail({
      to: normalizedEmail,
      subject: '[SAPMS] Kích hoạt tài khoản nhân viên',
      text:
        `Xin chào ${fullName.trim()},\n\nTài khoản SAPMS của bạn đã được tạo. Vui lòng kích hoạt và tự đặt mật khẩu tại: ` +
        `${env.clientUrls[0]}/activate\nKhi kích hoạt, nhập số điện thoại ${newUser.phone} và email này (nhân viên không cần mã căn hộ). ` +
        'Sau đó đăng nhập bằng số điện thoại.',
    }));

  return { user: toPublicUser(newUser), inviteSent };
}

/**
 * UC-A04: Cập nhật tài khoản nội bộ (Trưởng BQL). Không sửa tài khoản cư dân qua API này.
 * Đổi vai trò / chức danh → tăng tokenVersion để phiên đăng nhập cũ (quyền cũ) hết hiệu lực.
 */
export async function updateInternal(managerUser, targetId, { fullName, email, phone, role, roleTitle, boardTitle }, { ip } = {}) {
  const target = await User.findById(targetId).select('+tokenVersion');
  if (!target) throw ApiError.notFound('Không tìm thấy tài khoản');
  const before = { phone: target.phone, email: target.email ?? null };
  if (target.role === ROLES.RESIDENT) throw ApiError.badRequest('Không sửa tài khoản RESIDENT qua API này');

  const newRole = role ?? target.role;
  const newRoleTitle = newRole === ROLES.STAFF ? (roleTitle !== undefined ? roleTitle : target.roleTitle) : null;
  const newBoardTitle = newRole === ROLES.BOARD ? (boardTitle !== undefined ? boardTitle : target.boardTitle) : null;
  const roleChanged = newRole !== target.role;
  const titleChanged = newRoleTitle !== target.roleTitle || newBoardTitle !== target.boardTitle;

  // Không tự đổi vai trò của chính mình: Trưởng BQL là duy nhất, tự đổi sẽ không còn ai quản trị (BR-X2)
  const isSelf = String(managerUser.id ?? managerUser._id) === String(targetId);
  if (isSelf && (roleChanged || titleChanged)) {
    throw ApiError.badRequest('Không thể tự đổi vai trò của chính mình');
  }

  if (target.isActive && (roleChanged || titleChanged)) {
    await assertSingleHolder({ role: newRole, boardTitle: newBoardTitle, excludeId: target._id });
  }

  if (fullName !== undefined) target.fullName = fullName.trim();
  if (phone !== undefined) target.phone = phone;
  // UC03 bước 4: được sửa email; bỏ trống thì xóa email (người không có email kích hoạt bằng mã tại quầy)
  if (email !== undefined) {
    const nextEmail = email?.trim().toLowerCase() || null;
    if (nextEmail && nextEmail !== target.email && (await User.exists({ email: nextEmail, _id: { $ne: target._id } }))) {
      throw new ApiError('EMAIL_EXISTS', undefined, { details: [{ field: 'email', message: 'Email đã được sử dụng' }] });
    }
    target.email = nextEmail;
  }
  target.role = newRole;
  target.roleTitle = newRoleTitle;
  target.boardTitle = newBoardTitle;
  const phoneChanged = target.phone !== before.phone;
  // Đổi SĐT là đổi tên đăng nhập: thu hồi mọi phiên như khi đổi vai trò
  if (roleChanged || titleChanged || phoneChanged) target.tokenVersion = (target.tokenVersion ?? 0) + 1;

  await saveUnique(() => target.save());
  if (phoneChanged) {
    await voidAllCodes(target._id);
    await recordContactChange({ actor: managerUser, user: target, field: 'phone', before: before.phone, after: target.phone, ip });
  }
  if ((target.email ?? null) !== before.email) {
    await recordContactChange({ actor: managerUser, user: target, field: 'email', before: before.email, after: target.email, ip });
  }

  if (roleChanged || titleChanged) {
    await logAudit({
      action: AUDIT_ACTIONS.ROLE_ASSIGNED,
      user: managerUser,
      targetType: AUDIT_TARGETS.USER,
      targetId: target._id,
      metadata: { role: newRole, roleTitle: newRoleTitle, boardTitle: newBoardTitle },
      ip,
    });
  }

  return toPublicUser(target);
}

/**
 * UC-A04: Khóa / mở khóa tài khoản (Trưởng BQL)
 */
export async function setStatus(managerUser, targetId, { isActive }, { ip } = {}) {
  if (String(managerUser.id) === String(targetId)) {
    throw ApiError.badRequest('Không thể tự khóa tài khoản của chính mình');
  }

  const target = await User.findById(targetId).select('+tokenVersion');
  if (!target) throw ApiError.notFound('Không tìm thấy tài khoản');

  // Mở khóa MANAGER / CHAIRMAN: BR-R1/R2
  if (isActive && !target.isActive) {
    await assertSingleHolder({ role: target.role, boardTitle: target.boardTitle, excludeId: target._id });
  }
  // Khóa: tăng tokenVersion để vô hiệu hóa refresh token cũ
  if (!isActive) target.tokenVersion = (target.tokenVersion ?? 0) + 1;
  // Mở khóa thủ công cũng gỡ khóa tạm do nhập sai mật khẩu (BR-S03); audit ghi ở dưới
  if (isActive) target.set({ failedLoginCount: 0, lockedUntil: null });
  target.isActive = isActive;

  await saveUnique(() => target.save());

  await logAudit({
    action: isActive ? AUDIT_ACTIONS.ACCOUNT_UNLOCKED : AUDIT_ACTIONS.ACCOUNT_LOCKED,
    user: managerUser,
    targetType: AUDIT_TARGETS.USER,
    targetId: target._id,
    ip,
  });

  // Tài khoản cư dân: đồng bộ mã cư dân của các căn
  if (target.role === ROLES.RESIDENT) {
    const apartmentIds = await Resident.find({ userId: target._id }).distinct('apartmentId');
    for (const apartmentId of apartmentIds) {
      try {
        await ensureCodes(apartmentId);
      } catch (err) {
        console.error('[module-a] ensureCodes', apartmentId, err.message);
      }
    }
  }

  return toPublicUser(target);
}

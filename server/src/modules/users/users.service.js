import bcrypt from 'bcryptjs';
import { AUDIT_ACTIONS, AUDIT_TARGETS, BOARD_TITLES, ROLES } from '../../constants/enums.js';
import { Resident, User } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeRegex, paginate } from '../../utils/pagination.js';
import { logAudit } from '../../services/auditLog.service.js';
import { sendMail } from '../../services/mail.service.js';
import { uploadToCloudinary } from '../../services/upload.service.js';
import { parseDateOfBirth, ensureCodes } from '../memberCodes/memberCodes.service.js';
import { toPublicUser } from '../auth/auth.service.js';
import { signAccessToken, signRefreshToken } from '../auth/auth.tokens.js';
import { generateTemporaryPassword } from '../../utils/password.js';

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
export async function updateMe(userId, { fullName, phone, dateOfBirth }) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('Không tìm thấy tài khoản');

  if (fullName !== undefined) user.fullName = fullName.trim();
  if (phone !== undefined) user.phone = phone ? phone.trim() : null;
  if (dateOfBirth !== undefined) {
    user.dateOfBirth = parseDateOfBirth(dateOfBirth);
  }

  await user.save();
  return toPublicUser(user);
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
  const user = await User.findById(userId).select('+passwordHash +tokenVersion');
  if (!user) throw ApiError.notFound('Không tìm thấy tài khoản');

  const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isMatch) {
    throw ApiError.badRequest('Mật khẩu hiện tại không đúng', [
      { field: 'currentPassword', message: 'Mật khẩu hiện tại không đúng' },
    ]);
  }

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
 * UC-A04: Danh sách tài khoản nội bộ (Admin)
 */
export async function listInternal(query = {}) {
  const filter = { role: { $ne: ROLES.RESIDENT } };

  if (query.role) filter.role = query.role;
  if (query.roleTitle) filter.roleTitle = query.roleTitle;
  if (query.boardTitle) filter.boardTitle = query.boardTitle;
  if (query.isActive !== undefined) filter.isActive = query.isActive;

  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    filter.$or = [{ fullName: rx }, { email: rx }, { phone: rx }];
  }

  const { items, pagination } = await paginate(User, filter, query, {
    select: '-passwordHash',
  });

  return {
    items: items.map(toPublicUser),
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
    if (err.keyPattern?.email) throw new ApiError('EMAIL_EXISTS');
    throw err;
  }
}

/**
 * UC-A04: Tạo tài khoản nội bộ (Admin). Mật khẩu tạm gửi qua email; chỉ trả về API khi gửi email thất bại.
 */
export async function createInternal(adminUser, { fullName, email, phone, role, roleTitle, boardTitle }, { ip } = {}) {
  const normalizedEmail = email.trim().toLowerCase();
  const titleForRole = role === ROLES.STAFF ? roleTitle : null;
  const boardForRole = role === ROLES.BOARD ? boardTitle : null;

  await assertSingleHolder({ role, boardTitle: boardForRole });
  if (await User.exists({ email: normalizedEmail })) throw new ApiError('EMAIL_EXISTS');

  const temporaryPassword = generateTemporaryPassword();
  const newUser = await saveUnique(async () =>
    User.create({
      fullName: fullName.trim(),
      email: normalizedEmail,
      phone: phone?.trim() || null,
      passwordHash: await bcrypt.hash(temporaryPassword, 10),
      role,
      roleTitle: titleForRole,
      boardTitle: boardForRole,
      isActive: true,
    }),
  );

  await logAudit({
    action: AUDIT_ACTIONS.ROLE_ASSIGNED,
    user: adminUser,
    targetType: AUDIT_TARGETS.USER,
    targetId: newUser._id,
    metadata: { role, roleTitle: titleForRole, boardTitle: boardForRole },
    ip,
  });

  const emailSent = await sendMail({
    to: normalizedEmail,
    subject: 'Thông tin tài khoản nội bộ SAPMS',
    text: `Xin chào ${fullName},\n\nTài khoản của bạn đã được khởi tạo trong hệ thống SAPMS với vai trò ${role}.\nMật khẩu tạm thời: ${temporaryPassword}\n\nVui lòng đăng nhập và đổi mật khẩu ngay trong lần đầu tiên sử dụng.`,
  });

  return {
    user: toPublicUser(newUser),
    emailSent,
    ...(emailSent ? {} : { temporaryPassword }),
  };
}

/**
 * UC-A04: Cập nhật tài khoản nội bộ (Admin). Không sửa tài khoản cư dân / Admin khác qua API này.
 * Đổi vai trò / chức danh → tăng tokenVersion để phiên đăng nhập cũ (quyền cũ) hết hiệu lực.
 */
export async function updateInternal(adminUser, targetId, { fullName, phone, role, roleTitle, boardTitle }, { ip } = {}) {
  const target = await User.findById(targetId).select('+tokenVersion');
  if (!target) throw ApiError.notFound('Không tìm thấy tài khoản');
  if (target.role === ROLES.RESIDENT) throw ApiError.badRequest('Không sửa tài khoản RESIDENT qua API này');
  if (target.role === ROLES.ADMIN) throw ApiError.forbidden('Không được sửa tài khoản Quản trị viên khác');

  const newRole = role ?? target.role;
  const newRoleTitle = newRole === ROLES.STAFF ? (roleTitle !== undefined ? roleTitle : target.roleTitle) : null;
  const newBoardTitle = newRole === ROLES.BOARD ? (boardTitle !== undefined ? boardTitle : target.boardTitle) : null;
  const roleChanged = newRole !== target.role;
  const titleChanged = newRoleTitle !== target.roleTitle || newBoardTitle !== target.boardTitle;

  if (target.isActive && (roleChanged || titleChanged)) {
    await assertSingleHolder({ role: newRole, boardTitle: newBoardTitle, excludeId: target._id });
  }

  if (fullName !== undefined) target.fullName = fullName.trim();
  if (phone !== undefined) target.phone = phone ? phone.trim() : null;
  target.role = newRole;
  target.roleTitle = newRoleTitle;
  target.boardTitle = newBoardTitle;
  if (roleChanged || titleChanged) target.tokenVersion = (target.tokenVersion ?? 0) + 1;

  await saveUnique(() => target.save());

  if (roleChanged || titleChanged) {
    await logAudit({
      action: AUDIT_ACTIONS.ROLE_ASSIGNED,
      user: adminUser,
      targetType: AUDIT_TARGETS.USER,
      targetId: target._id,
      metadata: { role: newRole, roleTitle: newRoleTitle, boardTitle: newBoardTitle },
      ip,
    });
  }

  return toPublicUser(target);
}

/**
 * UC-A04: Khóa / mở khóa tài khoản (Admin)
 */
export async function setStatus(adminUser, targetId, { isActive }, { ip } = {}) {
  if (String(adminUser.id) === String(targetId)) {
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
  target.isActive = isActive;

  await saveUnique(() => target.save());

  await logAudit({
    action: isActive ? AUDIT_ACTIONS.ACCOUNT_UNLOCKED : AUDIT_ACTIONS.ACCOUNT_LOCKED,
    user: adminUser,
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

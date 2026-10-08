import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { AUDIT_ACTIONS, BOARD_TITLES, ROLES } from '../../constants/enums.js';
import { env } from '../../config/env.js';
import { Resident, User } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeRegex, paginate } from '../../utils/pagination.js';
import { logAudit } from '../../services/auditLog.service.js';
import { sendMail } from '../../services/mail.service.js';
import { uploadToCloudinary } from '../../services/upload.service.js';
import { parseDateOfBirth, ensureCodes } from '../memberCodes/memberCodes.service.js';
import { toPublicUser } from '../auth/auth.service.js';
import { signAccessToken, signRefreshToken } from '../auth/auth.tokens.js';

function generateTemporaryPassword(length = 10) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;

  const chars = [
    upper[crypto.randomInt(0, upper.length)],
    lower[crypto.randomInt(0, lower.length)],
    digits[crypto.randomInt(0, digits.length)],
  ];

  for (let i = 3; i < length; i += 1) {
    chars.push(all[crypto.randomInt(0, all.length)]);
  }

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

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

/**
 * UC-A04: Tạo tài khoản nội bộ (Admin)
 */
export async function createInternal(adminUser, { fullName, email, phone, role, roleTitle, boardTitle }, { ip } = {}) {
  const normalizedEmail = email.trim().toLowerCase();

  const titleForRole = role === ROLES.STAFF ? roleTitle : null;
  const boardForRole = role === ROLES.BOARD ? boardTitle : null;

  // Kiểm tra BR-R1 (duy nhất 1 MANAGER đang hoạt động)
  if (role === ROLES.MANAGER) {
    const activeManager = await User.findOne({ role: ROLES.MANAGER, isActive: true });
    if (activeManager) throw new ApiError('MANAGER_ALREADY_EXISTS');
  }

  // Kiểm tra BR-R2 (duy nhất 1 CHAIRMAN đang hoạt động)
  if (role === ROLES.BOARD && boardForRole === BOARD_TITLES.CHAIRMAN) {
    const activeChairman = await User.findOne({ boardTitle: BOARD_TITLES.CHAIRMAN, isActive: true });
    if (activeChairman) throw ApiError.badRequest('Đã có 1 Trưởng BQT đang hoạt động');
  }

  const temporaryPassword = generateTemporaryPassword(10);
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);

  let newUser;
  try {
    newUser = await User.create({
      fullName: fullName.trim(),
      email: normalizedEmail,
      phone: phone?.trim() || null,
      passwordHash,
      role,
      roleTitle: titleForRole,
      boardTitle: boardForRole,
      isActive: true,
    });
  } catch (err) {
    if (err.code === 11000) {
      if (err.keyPattern?.role || err.message?.includes('uniq_active_manager')) {
        throw new ApiError('MANAGER_ALREADY_EXISTS');
      }
      if (err.keyPattern?.boardTitle || err.message?.includes('uniq_active_chairman')) {
        throw ApiError.badRequest('Đã có 1 Trưởng BQT đang hoạt động');
      }
      throw ApiError.badRequest('Email đã được sử dụng', [
        { field: 'email', message: 'Email đã được sử dụng' },
      ]);
    }
    throw err;
  }

  // Ghi audit log
  await logAudit({
    action: AUDIT_ACTIONS.ROLE_ASSIGNED,
    user: adminUser,
    targetType: 'users',
    targetId: newUser._id,
    metadata: { role, roleTitle: titleForRole, boardTitle: boardForRole },
    ip,
  });

  if (env.isDev) {
    console.log('[module-a] mật khẩu tạm', normalizedEmail, temporaryPassword);
  }

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
 * UC-A04: Cập nhật tài khoản nội bộ (Admin)
 */
export async function updateInternal(adminUser, targetId, { fullName, phone, role, roleTitle, boardTitle }, { ip } = {}) {
  const target = await User.findById(targetId);
  if (!target) throw ApiError.notFound('Không tìm thấy tài khoản');
  if (target.role === ROLES.RESIDENT) {
    throw ApiError.badRequest('Không sửa tài khoản RESIDENT qua API này');
  }

  const roleChanged = role && role !== target.role;
  const newRole = role ?? target.role;
  const newRoleTitle = newRole === ROLES.STAFF ? (roleTitle !== undefined ? roleTitle : target.roleTitle) : null;
  const newBoardTitle = newRole === ROLES.BOARD ? (boardTitle !== undefined ? boardTitle : target.boardTitle) : null;

  // Kiểm tra BR-R1 nếu chuyển thành MANAGER hoặc kích hoạt MANAGER
  if (newRole === ROLES.MANAGER && (roleChanged || !target.isActive)) {
    const activeMgr = await User.findOne({ role: ROLES.MANAGER, isActive: true, _id: { $ne: target._id } });
    if (activeMgr) throw new ApiError('MANAGER_ALREADY_EXISTS');
  }

  // Kiểm tra BR-R2 nếu chuyển thành CHAIRMAN
  if (newRole === ROLES.BOARD && newBoardTitle === BOARD_TITLES.CHAIRMAN) {
    if (roleChanged || target.boardTitle !== BOARD_TITLES.CHAIRMAN || !target.isActive) {
      const activeChairman = await User.findOne({ boardTitle: BOARD_TITLES.CHAIRMAN, isActive: true, _id: { $ne: target._id } });
      if (activeChairman) throw ApiError.badRequest('Đã có 1 Trưởng BQT đang hoạt động');
    }
  }

  if (fullName !== undefined) target.fullName = fullName.trim();
  if (phone !== undefined) target.phone = phone ? phone.trim() : null;

  const titleChanged = newRoleTitle !== target.roleTitle || newBoardTitle !== target.boardTitle;

  target.role = newRole;
  target.roleTitle = newRoleTitle;
  target.boardTitle = newBoardTitle;

  try {
    await target.save();
  } catch (err) {
    if (err.code === 11000) {
      if (err.keyPattern?.role || err.message?.includes('uniq_active_manager')) {
        throw new ApiError('MANAGER_ALREADY_EXISTS');
      }
      if (err.keyPattern?.boardTitle || err.message?.includes('uniq_active_chairman')) {
        throw ApiError.badRequest('Đã có 1 Trưởng BQT đang hoạt động');
      }
    }
    throw err;
  }

  if (roleChanged || titleChanged) {
    await logAudit({
      action: AUDIT_ACTIONS.ROLE_ASSIGNED,
      user: adminUser,
      targetType: 'users',
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
  const currentAdminId = String(adminUser.id ?? adminUser._id);
  if (currentAdminId === String(targetId)) {
    throw ApiError.badRequest('Không thể tự khóa tài khoản của chính mình');
  }

  const target = await User.findById(targetId).select('+tokenVersion');
  if (!target) throw ApiError.notFound('Không tìm thấy tài khoản');

  // Mở khóa: Kiểm tra BR-R1/R2 nếu tài khoản được mở là MANAGER hoặc CHAIRMAN
  if (isActive && !target.isActive) {
    if (target.role === ROLES.MANAGER) {
      const activeMgr = await User.findOne({ role: ROLES.MANAGER, isActive: true, _id: { $ne: target._id } });
      if (activeMgr) throw new ApiError('MANAGER_ALREADY_EXISTS');
    }
    if (target.boardTitle === BOARD_TITLES.CHAIRMAN) {
      const activeChairman = await User.findOne({ boardTitle: BOARD_TITLES.CHAIRMAN, isActive: true, _id: { $ne: target._id } });
      if (activeChairman) throw ApiError.badRequest('Đã có 1 Trưởng BQT đang hoạt động');
    }
  }

  // Khóa: tăng tokenVersion để vô hiệu hóa refresh token cũ
  if (!isActive) {
    target.tokenVersion = (target.tokenVersion ?? 0) + 1;
  }

  target.isActive = isActive;

  try {
    await target.save();
  } catch (err) {
    if (err.code === 11000) {
      if (err.keyPattern?.role || err.message?.includes('uniq_active_manager')) {
        throw new ApiError('MANAGER_ALREADY_EXISTS');
      }
      if (err.keyPattern?.boardTitle || err.message?.includes('uniq_active_chairman')) {
        throw ApiError.badRequest('Đã có 1 Trưởng BQT đang hoạt động');
      }
    }
    throw err;
  }

  // Ghi log audit
  await logAudit({
    action: isActive ? AUDIT_ACTIONS.ACCOUNT_UNLOCKED : AUDIT_ACTIONS.ACCOUNT_LOCKED,
    user: adminUser,
    targetType: 'users',
    targetId: target._id,
    ip,
  });

  // Nếu là tài khoản RESIDENT: đồng bộ mã cư dân (ensureCodes) cho các căn của họ
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

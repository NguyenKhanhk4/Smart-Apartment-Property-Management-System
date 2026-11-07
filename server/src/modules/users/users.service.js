<<<<<<< HEAD
import bcrypt from 'bcryptjs';
import { AUDIT_ACTIONS, AUDIT_TARGETS, BOARD_TITLES, ROLES } from '../../constants/enums.js';
import { Resident, User } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { assertPhoneAndEmailFree, uniqueConflictError } from './userLookup.js';
=======
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { AUDIT_ACTIONS, BOARD_TITLES, ROLES } from '../../constants/enums.js';
import { env } from '../../config/env.js';
import { Resident, User } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
>>>>>>> origin/minh
import { escapeRegex, paginate } from '../../utils/pagination.js';
import { logAudit } from '../../services/auditLog.service.js';
import { sendMail } from '../../services/mail.service.js';
import { uploadToCloudinary } from '../../services/upload.service.js';
import { parseDateOfBirth, ensureCodes } from '../memberCodes/memberCodes.service.js';
import { toPublicUser } from '../auth/auth.service.js';
import { signAccessToken, signRefreshToken } from '../auth/auth.tokens.js';
<<<<<<< HEAD
import { generateTemporaryPassword } from '../../utils/password.js';
=======

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
>>>>>>> origin/minh

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
<<<<<<< HEAD
  if (phone !== undefined) user.phone = phone;
=======
  if (phone !== undefined) user.phone = phone ? phone.trim() : null;
>>>>>>> origin/minh
  if (dateOfBirth !== undefined) {
    user.dateOfBirth = parseDateOfBirth(dateOfBirth);
  }

<<<<<<< HEAD
  await saveUnique(() => user.save());
=======
  await user.save();
>>>>>>> origin/minh
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
<<<<<<< HEAD
 * UC-A04: Danh sách tài khoản nội bộ (Trưởng BQL)
=======
 * UC-A04: Danh sách tài khoản nội bộ (Admin)
>>>>>>> origin/minh
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

<<<<<<< HEAD
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
  const normalizedEmail = email.trim().toLowerCase();
  const titleForRole = role === ROLES.STAFF ? roleTitle : null;
  const boardForRole = role === ROLES.BOARD ? boardTitle : null;

  await assertSingleHolder({ role, boardTitle: boardForRole });
  await assertPhoneAndEmailFree({ phone, email: normalizedEmail });

  const temporaryPassword = generateTemporaryPassword();
  const newUser = await saveUnique(async () =>
    User.create({
      fullName: fullName.trim(),
      email: normalizedEmail,
      phone,
      passwordHash: await bcrypt.hash(temporaryPassword, 10),
      activatedAt: new Date(),
=======
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
>>>>>>> origin/minh
      role,
      roleTitle: titleForRole,
      boardTitle: boardForRole,
      isActive: true,
<<<<<<< HEAD
    }),
  );

  await logAudit({
    action: AUDIT_ACTIONS.ROLE_ASSIGNED,
    user: managerUser,
    targetType: AUDIT_TARGETS.USER,
=======
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
>>>>>>> origin/minh
    targetId: newUser._id,
    metadata: { role, roleTitle: titleForRole, boardTitle: boardForRole },
    ip,
  });

<<<<<<< HEAD
=======
  if (env.isDev) {
    console.log('[module-a] mật khẩu tạm', normalizedEmail, temporaryPassword);
  }

>>>>>>> origin/minh
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
<<<<<<< HEAD
 * UC-A04: Cập nhật tài khoản nội bộ (Trưởng BQL). Không sửa tài khoản cư dân qua API này.
 * Đổi vai trò / chức danh → tăng tokenVersion để phiên đăng nhập cũ (quyền cũ) hết hiệu lực.
 */
export async function updateInternal(managerUser, targetId, { fullName, phone, role, roleTitle, boardTitle }, { ip } = {}) {
  const target = await User.findById(targetId).select('+tokenVersion');
  if (!target) throw ApiError.notFound('Không tìm thấy tài khoản');
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
  target.role = newRole;
  target.roleTitle = newRoleTitle;
  target.boardTitle = newBoardTitle;
  if (roleChanged || titleChanged) target.tokenVersion = (target.tokenVersion ?? 0) + 1;

  await saveUnique(() => target.save());
=======
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
>>>>>>> origin/minh

  if (roleChanged || titleChanged) {
    await logAudit({
      action: AUDIT_ACTIONS.ROLE_ASSIGNED,
<<<<<<< HEAD
      user: managerUser,
      targetType: AUDIT_TARGETS.USER,
=======
      user: adminUser,
      targetType: 'users',
>>>>>>> origin/minh
      targetId: target._id,
      metadata: { role: newRole, roleTitle: newRoleTitle, boardTitle: newBoardTitle },
      ip,
    });
  }

  return toPublicUser(target);
}

/**
<<<<<<< HEAD
 * UC-A04: Khóa / mở khóa tài khoản (Trưởng BQL)
 */
export async function setStatus(managerUser, targetId, { isActive }, { ip } = {}) {
  if (String(managerUser.id) === String(targetId)) {
=======
 * UC-A04: Khóa / mở khóa tài khoản (Admin)
 */
export async function setStatus(adminUser, targetId, { isActive }, { ip } = {}) {
  const currentAdminId = String(adminUser.id ?? adminUser._id);
  if (currentAdminId === String(targetId)) {
>>>>>>> origin/minh
    throw ApiError.badRequest('Không thể tự khóa tài khoản của chính mình');
  }

  const target = await User.findById(targetId).select('+tokenVersion');
  if (!target) throw ApiError.notFound('Không tìm thấy tài khoản');

<<<<<<< HEAD
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
    user: managerUser,
    targetType: AUDIT_TARGETS.USER,
=======
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
>>>>>>> origin/minh
    targetId: target._id,
    ip,
  });

<<<<<<< HEAD
  // Tài khoản cư dân: đồng bộ mã cư dân của các căn
=======
  // Nếu là tài khoản RESIDENT: đồng bộ mã cư dân (ensureCodes) cho các căn của họ
>>>>>>> origin/minh
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

import bcrypt from 'bcryptjs';
import { ROLES } from '../../constants/enums.js';
import { User } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from './auth.tokens.js';

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
  };
}

/**
 * UC-A01 — Đăng ký tài khoản cư dân (Public)
 */
export async function register({ fullName, email, phone, password }) {
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    throw ApiError.badRequest('Email đã được sử dụng', [
      { field: 'email', message: 'Email đã được sử dụng' },
    ]);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const user = await User.create({
      fullName: fullName.trim(),
      email: normalizedEmail,
      phone: phone?.trim() || null,
      passwordHash,
      role: ROLES.RESIDENT,
    });

    return { user: toPublicUser(user) };
  } catch (err) {
    if (err.code === 11000) {
      throw ApiError.badRequest('Email đã được sử dụng', [
        { field: 'email', message: 'Email đã được sử dụng' },
      ]);
    }
    throw err;
  }
}

/**
 * UC-A02 — Đăng nhập hệ thống (Public)
 */
export async function login({ email, password }) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash +tokenVersion');

  if (!user) {
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

import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

/**
 * Ký Access Token cho user
 * Payload đúng định dạng mà middlewares/auth.js đọc: { sub, role, roleTitle, boardTitle }
 */
export function signAccessToken(user) {
  const payload = {
    sub: String(user._id ?? user.id),
    role: user.role,
    roleTitle: user.roleTitle ?? null,
    boardTitle: user.boardTitle ?? null,
  };

  return jwt.sign(payload, env.jwt.accessSecret, {
    algorithm: 'HS256',
    expiresIn: env.jwt.accessExpiresIn,
  });
}

/**
 * Ký Refresh Token cho user
 * Payload gồm { sub, tv: tokenVersion, type: 'refresh' }
 */
export function signRefreshToken(user) {
  const payload = {
    sub: String(user._id ?? user.id),
    tv: user.tokenVersion ?? 0,
    type: 'refresh',
  };

  return jwt.sign(payload, env.jwt.refreshSecret, {
    algorithm: 'HS256',
    expiresIn: env.jwt.refreshExpiresIn,
  });
}

/**
 * Xác thực Refresh Token
 * Chỉ chấp nhận HS256 và type === 'refresh'
 */
export function verifyRefreshToken(token) {
  try {
    const decoded = jwt.verify(token, env.jwt.refreshSecret, {
      algorithms: ['HS256'],
    });

    if (decoded.type !== 'refresh') {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}

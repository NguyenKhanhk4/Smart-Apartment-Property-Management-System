import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Đọc access token từ header `Authorization: Bearer <token>` (NFR-02) và gắn `req.user`.
 *
 * Module Auth khi ký access token PHẢI dùng env.jwt.accessSecret và payload đúng shape:
 *   { sub: <userId>, role: 'RESIDENT' | 'STAFF' | 'BOARD' | 'ADMIN', roleTitle: <ROLE_TITLES> | null }
 */
export function authenticate(req, _res, next) {
  const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
  if (!match) {
    return next(ApiError.unauthorized('Thiếu access token trong header Authorization'));
  }

  try {
    const payload = jwt.verify(match[1], env.jwt.accessSecret);
    req.user = { id: payload.sub, role: payload.role, roleTitle: payload.roleTitle ?? null };
    return next();
  } catch (err) {
    const message =
      err.name === 'TokenExpiredError' ? 'Access token đã hết hạn' : 'Access token không hợp lệ';
    return next(ApiError.unauthorized(message));
  }
}

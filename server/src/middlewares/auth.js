import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ROLES } from '../constants/enums.js';
import { ApiError } from '../utils/ApiError.js';

const VALID_ROLES = Object.values(ROLES);

/**
 * Đọc access token từ header `Authorization: Bearer <token>` (NFR-02) và gắn `req.user`.
 *
 * Module Auth khi ký access token PHẢI dùng env.jwt.accessSecret, thuật toán HS256 (mặc định của
 * jwt.sign) và payload đúng shape:
 *   { sub: <userId>, role: <ROLES>, roleTitle: <ROLE_TITLES> | null, boardTitle: <BOARD_TITLES> | null }
 * Token thiếu sub / role không thuộc ROLES bị coi là không hợp lệ (không tạo req.user rỗng).
 */
export function authenticate(req, _res, next) {
  const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
  if (!match) {
    return next(ApiError.unauthorized('Thiếu access token trong header Authorization'));
  }

  let payload;
  try {
    payload = jwt.verify(match[1], env.jwt.accessSecret, { algorithms: ['HS256'] });
  } catch (err) {
    const message =
      err.name === 'TokenExpiredError' ? 'Access token đã hết hạn' : 'Access token không hợp lệ';
    return next(ApiError.unauthorized(message));
  }

  if (typeof payload.sub !== 'string' || !payload.sub || !VALID_ROLES.includes(payload.role)) {
    return next(ApiError.unauthorized('Access token không hợp lệ'));
  }

  req.user = {
    id: payload.sub,
    role: payload.role,
    roleTitle: payload.roleTitle ?? null,
    boardTitle: payload.boardTitle ?? null,
  };
  return next();
}

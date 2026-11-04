import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Chống dò mật khẩu: giới hạn số request ghi (đăng nhập, đăng ký, làm mới token) theo IP
 * (AUTH_RATE_LIMIT_MAX lần / AUTH_RATE_LIMIT_WINDOW_MINUTES phút). GET /auth/me không bị tính.
 */
export const authLimiter = rateLimit({
  windowMs: env.authRateLimit.windowMs,
  limit: env.authRateLimit.max,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (req) => req.method === 'GET',
  handler: (_req, _res, next) => next(new ApiError('TOO_MANY_REQUESTS')),
});

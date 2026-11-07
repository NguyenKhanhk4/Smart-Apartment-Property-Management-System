import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

const common = {
  windowMs: env.authRateLimit.windowMs,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (req) => req.method === 'GET',
  handler: (_req, _res, next) => next(new ApiError('TOO_MANY_REQUESTS')),
};

/**
 * Chống dò mật khẩu cho các request ghi của /auth (đăng nhập, kích hoạt, quên mật khẩu, làm mới token).
 * - Theo IP + SĐT: AUTH_RATE_LIMIT_MAX lần THẤT BẠI / AUTH_RATE_LIMIT_WINDOW_MINUTES phút. Request thành công không bị
 *   tính, để người dùng thật kích hoạt, đăng nhập, đặt lại mật khẩu liền nhau không bị chặn nhầm.
 * - Theo IP: gấp 10 lần, để cả tòa nhà dùng chung 1 IP (wifi chung, ngày bàn giao) vẫn đăng nhập, kích hoạt được.
 * Khóa tài khoản sau 5 lần sai (BR-S03) nằm ở auth.service, không phụ thuộc IP.
 */
const perPhone = rateLimit({
  ...common,
  limit: env.authRateLimit.max,
  skipSuccessfulRequests: true,
  // 423 = tài khoản đang khóa tạm: không đoán được gì thêm nên không tính, để Trưởng BQL gỡ khóa là dùng được ngay
  requestWasSuccessful: (_req, res) => res.statusCode < 400 || res.statusCode === 423,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.phone ?? '').replace(/\D/g, '').slice(-9)}`,
});
const perIp = rateLimit({ ...common, limit: env.authRateLimit.max * 10 });

export const authLimiter = [perIp, perPhone];

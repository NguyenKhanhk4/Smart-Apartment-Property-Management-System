import { Router } from 'express';
import Joi from 'joi';
import { validate } from '../../middlewares/validate.js';
import { ok } from '../../utils/response.js';
import { CONSENT_ACTIONS } from '../../constants/enums.js';
import { phoneVn } from '../../utils/validators.js';
import * as authService from './auth.service.js';

// Người 1 — Vũ Việt. UC11 (Kích hoạt tài khoản), UC-A02 (Đăng nhập, làm mới token, đăng xuất)
const router = Router();

const activationStartBody = Joi.object({
  phone: phoneVn().required(),
  apartmentCode: Joi.string().trim().max(30).allow('', null), // Cư dân bắt buộc, kiểm tra ở service
  email: Joi.string().trim().lowercase().email().required(),
});

const activationConfirmBody = Joi.object({
  phone: phoneVn().required(),
  code: Joi.string().trim().max(20).required(),
  password: Joi.string()
    .min(8)
    .max(100)
    .pattern(/^(?=.*[A-Za-z])(?=.*\d)/)
    .required()
    .messages({
      'string.pattern.base': 'Mật khẩu phải có ít nhất 8 ký tự, gồm cả chữ và số',
      'string.min': 'Mật khẩu phải có ít nhất 8 ký tự, gồm cả chữ và số',
    }),
  confirmPassword: Joi.any().valid(Joi.ref('password')).required().messages({
    'any.only': 'Xác nhận mật khẩu không khớp',
  }),
  consent: Joi.string().valid(CONSENT_ACTIONS.ACCEPTED, CONSENT_ACTIONS.DECLINED).required(),
});

const loginBody = Joi.object({
  email: Joi.string().trim().lowercase().email().required(),
  password: Joi.string().required(),
});

const refreshBody = Joi.object({
  refreshToken: Joi.string().required(),
});

/**
 * @openapi
 * /auth/activation/start:
 *   post:
 *     tags: [Xác thực & Tài khoản]
 *     summary: Kiểm tra dữ liệu đăng ký trước, gửi OTP email — UC11
 *     security: []
 */
router.post('/activation/start', validate({ body: activationStartBody }), async (req, res) => {
  ok(res, await authService.startActivation(req.validated.body), 'Đã gửi mã xác minh tới email của bạn');
});

/**
 * @openapi
 * /auth/activation/confirm:
 *   post:
 *     tags: [Xác thực & Tài khoản]
 *     summary: Xác minh mã, đặt mật khẩu, ghi quyết định về điều khoản — UC11
 *     security: []
 */
router.post('/activation/confirm', validate({ body: activationConfirmBody }), async (req, res) => {
  await authService.confirmActivation(req.validated.body, { ip: req.ip });
  ok(res, null, 'Tài khoản đã được kích hoạt. Vui lòng đăng nhập');
});

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Xác thực & Tài khoản]
 *     summary: Đăng nhập hệ thống — UC-A02
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email, example: "manager@sapms.vn" }
 *               password: { type: string, example: "Sapms@123" }
 *     responses:
 *       200:
 *         description: Đăng nhập thành công, trả token và thông tin user
 */
router.post('/login', validate({ body: loginBody }), async (req, res) => {
  const result = await authService.login(req.validated.body);
  ok(res, result, 'Đăng nhập thành công');
});

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Xác thực & Tài khoản]
 *     summary: Cấp mới access token bằng refresh token — UC-A02
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200:
 *         description: Cấp cặp token mới thành công
 */
router.post('/refresh', validate({ body: refreshBody }), async (req, res) => {
  const result = await authService.refresh(req.validated.body);
  ok(res, result, 'Cấp mới token thành công');
});

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Xác thực & Tài khoản]
 *     summary: Đăng xuất, thu hồi refresh token trên mọi thiết bị — UC-A02
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200:
 *         description: Đăng xuất thành công (kể cả khi token đã hết hạn hoặc đã bị thu hồi)
 */
router.post('/logout', validate({ body: refreshBody }), async (req, res) => {
  await authService.logout(req.validated.body);
  ok(res, null, 'Đăng xuất thành công');
});

export default router;

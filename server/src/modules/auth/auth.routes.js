import { Router } from 'express';
import Joi from 'joi';
import { authenticate } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { created, ok } from '../../utils/response.js';
import * as authService from './auth.service.js';

// Module A — Vũ Việt. UC-A01 (Đăng ký), UC-A02 (Đăng nhập, làm mới token, đăng xuất)
const router = Router();

const registerBody = Joi.object({
  fullName: Joi.string().trim().min(2).max(100).required(),
  email: Joi.string().trim().lowercase().email().required(),
  phone: Joi.string().trim().pattern(/^(0|\+84)\d{9,10}$/).allow('', null),
  password: Joi.string()
    .min(8)
    .max(100)
    .pattern(/^(?=.*[A-Za-z])(?=.*\d)/)
    .required()
    .messages({
      'string.pattern.base': 'Mật khẩu phải chứa ít nhất 1 chữ cái và 1 chữ số',
      'string.min': 'Mật khẩu tối thiểu 8 ký tự',
    }),
  confirmPassword: Joi.any()
    .valid(Joi.ref('password'))
    .required()
    .messages({
      'any.only': 'Xác nhận mật khẩu không khớp',
    }),
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
 * /auth/register:
 *   post:
 *     tags: [Xác thực & Tài khoản]
 *     summary: Đăng ký tài khoản cư dân mới — UC-A01
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName, email, password, confirmPassword]
 *             properties:
 *               fullName: { type: string, example: "Nguyễn Văn A" }
 *               email: { type: string, format: email, example: "cudan@sapms.vn" }
 *               phone: { type: string, example: "0901234567" }
 *               password: { type: string, example: "Sapms@123" }
 *               confirmPassword: { type: string, example: "Sapms@123" }
 *     responses:
 *       201:
 *         description: Đăng ký thành công
 */
router.post('/register', validate({ body: registerBody }), async (req, res) => {
  const result = await authService.register(req.validated.body);
  created(res, result, 'Đăng ký tài khoản thành công');
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
 *     summary: Đăng xuất hệ thống — UC-A02
 *     responses:
 *       200:
 *         description: Đăng xuất thành công
 */
router.post('/logout', authenticate, (_req, res) => {
  ok(res, null, 'Đăng xuất thành công');
});

export default router;

import { Router } from 'express';
import Joi from 'joi';
import { BOARD_TITLES, ROLES, ROLE_TITLES, values } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { uploadImages } from '../../services/upload.service.js';
import { paginationQuery } from '../../utils/pagination.js';
import { created, ok, paginated } from '../../utils/response.js';
import { idParams } from '../../utils/validators.js';
import * as usersService from './users.service.js';

// Module A — Vũ Việt. UC-A03 (Hồ sơ cá nhân), UC-A04 (Quản lý tài khoản nội bộ)
const router = Router();

const updateMeBody = Joi.object({
  fullName: Joi.string().trim().min(2).max(100),
  phone: Joi.string().trim().pattern(/^(0|\+84)\d{9,10}$/).allow('', null),
  dateOfBirth: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow('', null),
}).min(1);

const changePasswordBody = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string()
    .min(8)
    .max(100)
    .pattern(/^(?=.*[A-Za-z])(?=.*\d)/)
    .required()
    .messages({
      'string.pattern.base': 'Mật khẩu mới phải chứa ít nhất 1 chữ cái và 1 chữ số',
      'string.min': 'Mật khẩu mới tối thiểu 8 ký tự',
    }),
  confirmPassword: Joi.any()
    .valid(Joi.ref('newPassword'))
    .required()
    .messages({
      'any.only': 'Xác nhận mật khẩu mới không khớp',
    }),
});

const listInternalQuery = Joi.object({
  ...paginationQuery,
  role: Joi.string().valid(...values(ROLES)),
  roleTitle: Joi.string().valid(...values(ROLE_TITLES)),
  boardTitle: Joi.string().valid(...values(BOARD_TITLES)),
  isActive: Joi.boolean(),
  q: Joi.string().trim().max(100),
});

const createInternalBody = Joi.object({
  fullName: Joi.string().trim().min(2).max(100).required(),
  email: Joi.string().trim().lowercase().email().required(),
  phone: Joi.string().trim().pattern(/^(0|\+84)\d{9,10}$/).allow('', null),
  role: Joi.string()
    .valid(ROLES.MANAGER, ROLES.ACCOUNTANT, ROLES.STAFF, ROLES.BOARD)
    .required(),
  roleTitle: Joi.when('role', {
    is: ROLES.STAFF,
    then: Joi.string().valid(...values(ROLE_TITLES)).required().messages({ 'any.required': 'Chức danh là bắt buộc với nhân viên' }),
    otherwise: Joi.valid(null).default(null),
  }),
  boardTitle: Joi.when('role', {
    is: ROLES.BOARD,
    then: Joi.string().valid(...values(BOARD_TITLES)).required().messages({ 'any.required': 'Chức danh là bắt buộc với ban quản trị' }),
    otherwise: Joi.valid(null).default(null),
  }),
});

const updateInternalBody = Joi.object({
  fullName: Joi.string().trim().min(2).max(100),
  phone: Joi.string().trim().pattern(/^(0|\+84)\d{9,10}$/).allow('', null),
  role: Joi.string().valid(ROLES.MANAGER, ROLES.ACCOUNTANT, ROLES.STAFF, ROLES.BOARD),
  roleTitle: Joi.string().valid(...values(ROLE_TITLES), null),
  boardTitle: Joi.string().valid(...values(BOARD_TITLES), null),
}).min(1);

const setStatusBody = Joi.object({
  isActive: Joi.boolean().required(),
});

// ===== Hồ sơ cá nhân (UC-A03) =====

/**
 * @openapi
 * /users/me:
 *   get:
 *     tags: [Xác thực & Tài khoản]
 *     summary: Thông tin hồ sơ của tài khoản đang đăng nhập — UC-A03
 *     responses:
 *       200:
 *         description: Thông tin hồ sơ
 */
router.get('/me', authenticate, async (req, res) => {
  const user = await usersService.getMe(req.user.id);
  ok(res, user);
});

/**
 * @openapi
 * /users/me:
 *   patch:
 *     tags: [Xác thực & Tài khoản]
 *     summary: Cập nhật thông tin cá nhân — UC-A03
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fullName: { type: string }
 *               phone: { type: string }
 *               dateOfBirth: { type: string, example: "1990-05-15" }
 *     responses:
 *       200:
 *         description: Hồ sơ đã được cập nhật
 */
router.patch('/me', authenticate, validate({ body: updateMeBody }), async (req, res) => {
  const user = await usersService.updateMe(req.user.id, req.validated.body);
  ok(res, user, 'Cập nhật thông tin thành công');
});

/**
 * @openapi
 * /users/me/avatar:
 *   patch:
 *     tags: [Xác thực & Tài khoản]
 *     summary: Cập nhật ảnh đại diện — UC-A03
 *     responses:
 *       200:
 *         description: Ảnh đại diện đã được cập nhật
 */
router.patch('/me/avatar', authenticate, uploadImages('avatar', 1), async (req, res) => {
  const user = await usersService.updateAvatar(req.user.id, req.files);
  ok(res, user, 'Cập nhật ảnh đại diện thành công');
});

/**
 * @openapi
 * /users/me/password:
 *   patch:
 *     tags: [Xác thực & Tài khoản]
 *     summary: Đổi mật khẩu cá nhân — UC-A03
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword, confirmPassword]
 *             properties:
 *               currentPassword: { type: string }
 *               newPassword: { type: string }
 *               confirmPassword: { type: string }
 *     responses:
 *       200:
 *         description: Đổi mật khẩu thành công, trả token mới
 */
router.patch('/me/password', authenticate, validate({ body: changePasswordBody }), async (req, res) => {
  const result = await usersService.changePassword(req.user.id, req.validated.body);
  ok(res, result, 'Đổi mật khẩu thành công');
});

// ===== Quản lý tài khoản nội bộ (UC-A04, ADMIN) =====

/**
 * @openapi
 * /users/internal:
 *   get:
 *     tags: [Tài khoản nội bộ]
 *     summary: Danh sách tài khoản nội bộ — UC-A04
 *     responses:
 *       200:
 *         description: Danh sách tài khoản phân trang
 */
router.get('/internal', authenticate, authorize('ADMIN'), validate({ query: listInternalQuery }), async (req, res) => {
  const { items, pagination } = await usersService.listInternal(req.validated.query);
  paginated(res, items, pagination);
});

/**
 * @openapi
 * /users/internal:
 *   post:
 *     tags: [Tài khoản nội bộ]
 *     summary: Tạo tài khoản nội bộ mới — UC-A04
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName, email, role]
 *             properties:
 *               fullName: { type: string }
 *               email: { type: string }
 *               phone: { type: string }
 *               role: { type: string, enum: [MANAGER, ACCOUNTANT, STAFF, BOARD] }
 *               roleTitle: { type: string, enum: [RECEPTIONIST, SECURITY, TECHNICIAN] }
 *               boardTitle: { type: string, enum: [CHAIRMAN, MEMBER] }
 *     responses:
 *       201:
 *         description: Tài khoản đã được tạo
 */
router.post('/internal', authenticate, authorize('ADMIN'), validate({ body: createInternalBody }), async (req, res) => {
  const result = await usersService.createInternal(req.user, req.validated.body, { ip: req.ip });
  created(res, result, 'Tạo tài khoản nội bộ thành công');
});

/**
 * @openapi
 * /users/internal/{id}:
 *   patch:
 *     tags: [Tài khoản nội bộ]
 *     summary: Chỉnh sửa thông tin tài khoản nội bộ — UC-A04
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Thông tin tài khoản đã được cập nhật
 */
router.patch('/internal/:id', authenticate, authorize('ADMIN'), validate({ params: idParams, body: updateInternalBody }), async (req, res) => {
  const user = await usersService.updateInternal(req.user, req.validated.params.id, req.validated.body, { ip: req.ip });
  ok(res, user, 'Cập nhật tài khoản thành công');
});

/**
 * @openapi
 * /users/{id}/status:
 *   patch:
 *     tags: [Tài khoản nội bộ]
 *     summary: Khóa / mở khóa tài khoản người dùng — UC-A04
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [isActive]
 *             properties:
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Trạng thái tài khoản đã được cập nhật
 */
router.patch('/:id/status', authenticate, authorize('ADMIN'), validate({ params: idParams, body: setStatusBody }), async (req, res) => {
  const user = await usersService.setStatus(req.user, req.validated.params.id, req.validated.body, { ip: req.ip });
  ok(res, user, user.isActive ? 'Mở khóa tài khoản thành công' : 'Đã khóa tài khoản');
});

export default router;

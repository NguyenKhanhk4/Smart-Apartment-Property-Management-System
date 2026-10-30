import { Router } from 'express';
import Joi from 'joi';
import { DUTY_ROLE_TITLES, values } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { created, ok } from '../../utils/response.js';
import { idParams, objectId } from '../../utils/validators.js';
import * as service from './dutyShifts.service.js';

// Người 4 — Lịch ca trực Kỹ thuật viên / Bảo vệ (X6). Trưởng BQL xếp / hủy ca; nhân viên xem lịch và ai đang trực.
const router = Router();
const VIEWERS = ['MANAGER', 'STAFF'];
const roleTitle = () => Joi.string().valid(...values(DUTY_ROLE_TITLES));

/**
 * @openapi
 * /duty-shifts:
 *   get:
 *     tags: [Ca trực]
 *     summary: Ca trực giao với khoảng [from, to) — mặc định 7 ngày từ hôm nay
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date-time } }
 *       - { in: query, name: to, schema: { type: string, format: date-time } }
 *       - { in: query, name: roleTitle, schema: { type: string, enum: [TECHNICIAN, SECURITY] } }
 *       - { in: query, name: userId, schema: { type: string } }
 *   post:
 *     tags: [Ca trực]
 *     summary: Trưởng BQL xếp ca (lặp repeatDays ngày liên tiếp). Trùng giờ với ca khác của cùng người → DUTY_SHIFT_OVERLAP
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [roleTitle, userId, startAt, endAt]
 *             properties:
 *               roleTitle: { type: string, enum: [TECHNICIAN, SECURITY] }
 *               userId: { type: string }
 *               startAt: { type: string, format: date-time }
 *               endAt: { type: string, format: date-time }
 *               isBackup: { type: boolean, description: 'Người trực dự phòng nhận cảnh báo khẩn' }
 *               repeatDays: { type: integer, minimum: 1, maximum: 31 }
 *               note: { type: string }
 */
router.get(
  '/',
  authenticate,
  authorize(...VIEWERS),
  validate({
    query: Joi.object({
      from: Joi.date().iso(),
      to: Joi.date().iso().greater(Joi.ref('from')),
      roleTitle: roleTitle(),
      userId: objectId(),
    }),
  }),
  async (req, res) => ok(res, await service.listShifts(req.validated.query)),
);

router.post(
  '/',
  authenticate,
  authorize('MANAGER'),
  validate({
    body: Joi.object({
      roleTitle: roleTitle().required(),
      userId: objectId().required(),
      startAt: Joi.date().iso().required(),
      endAt: Joi.date().iso().required(),
      isBackup: Joi.boolean().default(false),
      repeatDays: Joi.number().integer().min(1).max(31).default(1),
      note: Joi.string().trim().max(300).allow(''),
    }),
  }),
  async (req, res) => created(res, await service.createShifts(req.user, req.body), 'Đã xếp ca trực'),
);

/**
 * @openapi
 * /duty-shifts/on-duty:
 *   get:
 *     tags: [Ca trực]
 *     summary: Ai đang trực lúc này — { primary[], backup[], hasSchedule }
 *     parameters: [{ in: query, name: roleTitle, required: true, schema: { type: string, enum: [TECHNICIAN, SECURITY] } }]
 */
router.get(
  '/on-duty',
  authenticate,
  authorize(...VIEWERS),
  validate({ query: Joi.object({ roleTitle: roleTitle().required() }) }),
  async (req, res) => ok(res, await service.getOnDuty(req.validated.query.roleTitle)),
);

/**
 * @openapi
 * /duty-shifts/staff:
 *   get:
 *     tags: [Ca trực]
 *     summary: Nhân viên đang hoạt động theo chức danh — để chọn người khi xếp ca
 *     parameters: [{ in: query, name: roleTitle, required: true, schema: { type: string, enum: [TECHNICIAN, SECURITY] } }]
 */
router.get(
  '/staff',
  authenticate,
  authorize('MANAGER'),
  validate({ query: Joi.object({ roleTitle: roleTitle().required() }) }),
  async (req, res) => ok(res, await service.listDutyStaff(req.validated.query.roleTitle)),
);

/**
 * @openapi
 * /duty-shifts/{id}:
 *   delete:
 *     tags: [Ca trực]
 *     summary: Hủy ca chưa kết thúc (ca đã qua giữ lại để tra cứu)
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 */
router.delete('/:id', authenticate, authorize('MANAGER'), validate({ params: idParams }), async (req, res) =>
  ok(res, await service.deleteShift(req.user, req.params.id), 'Đã hủy ca trực'),
);

export default router;

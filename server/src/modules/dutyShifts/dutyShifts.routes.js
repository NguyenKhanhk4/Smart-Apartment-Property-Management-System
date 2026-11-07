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
const VIEWERS = ['MANAGER', 'STAFF:TECHNICIAN', 'STAFF:SECURITY'];
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
 *     summary: Trưởng BQL xếp ca cho 1 hoặc nhiều người cùng khung giờ (lặp repeatDays ngày liên tiếp). Có người trùng giờ với ca khác của chính họ → DUTY_SHIFT_OVERLAP, không tạo ca nào
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [roleTitle, userIds, startAt, endAt]
 *             properties:
 *               roleTitle: { type: string, enum: [TECHNICIAN, SECURITY] }
 *               userIds: { type: array, items: { type: string }, description: '1 ca có thể nhiều người trực' }
 *               startAt: { type: string, format: date-time }
 *               endAt: { type: string, format: date-time }
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
      userIds: Joi.array().items(objectId()).min(1).max(30).required(),
      startAt: Joi.date().iso().required(),
      endAt: Joi.date().iso().required(),
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
 *     summary: Ai đang trực lúc này — { onDuty[], hasSchedule }
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

import { Router } from 'express';
import Joi from 'joi';
import {
  ROLE_TITLES,
  ROLES,
  VEHICLE_STATUS,
  VEHICLE_TYPES,
  values,
} from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { paginationQuery, sortable } from '../../utils/pagination.js';
import { created, ok, paginated } from '../../utils/response.js';
import { idParams, objectId } from '../../utils/validators.js';
import * as service from './vehicles.service.js';

// Module A — Vũ Việt. UC-A09, UC-A10: Phương tiện & duyệt phương tiện
const router = Router();

const STAFF_VIEWERS = [ROLES.MANAGER, `STAFF:${ROLE_TITLES.RECEPTIONIST}`];
const RECEPTIONIST_ONLY = [`STAFF:${ROLE_TITLES.RECEPTIONIST}`];

const registerVehicleBody = Joi.object({
  apartmentId: objectId(),
  type: Joi.string().valid(...values(VEHICLE_TYPES)).required(),
  plateNumber: Joi.string().trim().allow('', null).optional(),
  brand: Joi.string().trim().allow('', null).optional(),
  color: Joi.string().trim().allow('', null).optional(),
});

const staffQuerySchema = Joi.object({
  ...paginationQuery,
  sort: sortable('createdAt', 'status', 'type'),
  status: Joi.string().valid(...values(VEHICLE_STATUS)),
  type: Joi.string().valid(...values(VEHICLE_TYPES)),
  apartmentId: objectId(),
  cancelRequested: Joi.boolean(),
  q: Joi.string().trim().max(50).allow(''),
});

const mineQuerySchema = Joi.object({
  apartmentId: objectId(),
  status: Joi.string().valid(...values(VEHICLE_STATUS)),
});

const rejectBodySchema = Joi.object({
  reason: Joi.string()
    .trim()
    .min(1)
    .max(500)
    .required()
    .messages({
      'string.empty': 'Lý do từ chối là bắt buộc',
      'any.required': 'Lý do từ chối là bắt buộc',
    }),
});

/**
 * @openapi
 * /vehicles/mine:
 *   get:
 *     tags: [Phương tiện]
 *     summary: Danh sách xe của căn hộ cư dân đang ở — UC-A09
 *     parameters:
 *       - { in: query, name: apartmentId, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string, enum: [PENDING, APPROVED, REJECTED, CANCELLED] } }
 *     responses:
 *       200:
 *         description: Danh sách xe của cư dân
 */
router.get(
  '/mine',
  authenticate,
  authorize(ROLES.RESIDENT),
  validate({ query: mineQuerySchema }),
  async (req, res) => {
    const data = await service.listMine(req.user, req.validated.query);
    ok(res, data);
  },
);

/**
 * @openapi
 * /vehicles:
 *   post:
 *     tags: [Phương tiện]
 *     summary: Cư dân đăng ký gửi xe (chỉ OWNER/TENANT) — UC-A09
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type]
 *             properties:
 *               apartmentId: { type: string }
 *               type: { type: string, enum: [BICYCLE, MOTORBIKE, CAR] }
 *               plateNumber: { type: string }
 *               brand: { type: string }
 *               color: { type: string }
 *     responses:
 *       201:
 *         description: Đăng ký thành công, trạng thái PENDING
 */
router.post(
  '/',
  authenticate,
  authorize(ROLES.RESIDENT),
  validate({ body: registerVehicleBody }),
  async (req, res) => {
    const data = await service.register(req.validated.body, req.user);
    created(res, data);
  },
);

/**
 * @openapi
 * /vehicles/{id}/cancel-request:
 *   patch:
 *     tags: [Phương tiện]
 *     summary: Cư dân hủy hoặc yêu cầu hủy vé gửi xe — UC-A09
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Hủy thành công hoặc đã ghi nhận yêu cầu hủy
 */
router.patch(
  '/:id/cancel-request',
  authenticate,
  authorize(ROLES.RESIDENT),
  validate({ params: idParams }),
  async (req, res) => {
    const data = await service.requestCancel(req.params.id, req.user);
    ok(res, data);
  },
);

/**
 * @openapi
 * /vehicles:
 *   get:
 *     tags: [Phương tiện]
 *     summary: BQL xem danh sách xe / yêu cầu gửi xe — UC-A10
 *     parameters:
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *       - { in: query, name: status, schema: { type: string, enum: [PENDING, APPROVED, REJECTED, CANCELLED] } }
 *       - { in: query, name: type, schema: { type: string, enum: [BICYCLE, MOTORBIKE, CAR] } }
 *       - { in: query, name: apartmentId, schema: { type: string } }
 *       - { in: query, name: cancelRequested, schema: { type: boolean } }
 *       - { in: query, name: q, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Danh sách phân trang
 */
router.get(
  '/',
  authenticate,
  authorize(...STAFF_VIEWERS),
  validate({ query: staffQuerySchema }),
  async (req, res) => {
    const { items, pagination } = await service.listForStaff(req.validated.query);
    paginated(res, items, pagination);
  },
);

/**
 * @openapi
 * /vehicles/{id}/approve:
 *   patch:
 *     tags: [Phương tiện]
 *     summary: Lễ tân duyệt đăng ký gửi xe — UC-A10
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Duyệt thành công
 */
router.patch(
  '/:id/approve',
  authenticate,
  authorize(...RECEPTIONIST_ONLY),
  validate({ params: idParams }),
  async (req, res) => {
    const data = await service.approve(req.params.id, req.user);
    ok(res, data);
  },
);

/**
 * @openapi
 * /vehicles/{id}/reject:
 *   patch:
 *     tags: [Phương tiện]
 *     summary: Lễ tân từ chối đăng ký gửi xe — UC-A10
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: Từ chối thành công
 */
router.patch(
  '/:id/reject',
  authenticate,
  authorize(...RECEPTIONIST_ONLY),
  validate({ params: idParams, body: rejectBodySchema }),
  async (req, res) => {
    const data = await service.reject(req.params.id, req.user, req.validated.body);
    ok(res, data);
  },
);

/**
 * @openapi
 * /vehicles/{id}/confirm-cancel:
 *   patch:
 *     tags: [Phương tiện]
 *     summary: Lễ tân xác nhận hủy vé gửi xe — UC-A10
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Xác nhận hủy thành công
 */
router.patch(
  '/:id/confirm-cancel',
  authenticate,
  authorize(...RECEPTIONIST_ONLY),
  validate({ params: idParams }),
  async (req, res) => {
    const data = await service.confirmCancel(req.params.id, req.user);
    ok(res, data);
  },
);

export default router;

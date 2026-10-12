import { Router } from 'express';
import Joi from 'joi';
import { AMENITY_PASS_STATUS, values } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { MAX_LIMIT, paginationQuery, sortable } from '../../utils/pagination.js';
import { created, ok, paginated } from '../../utils/response.js';
import { idParams, objectId, period } from '../../utils/validators.js';
import * as service from './amenityPasses.service.js';

// Module D — Thanh Bình. UC-D09: chủ hộ mua gói tháng tiện ích cho mình hoặc thành viên; hủy; danh sách.
// Thứ tự khai báo: đường dẫn cố định (/mine, /options) phải đứng TRƯỚC /:id.
const router = Router();
const STATUSES = values(AMENITY_PASS_STATUS);

const listQuery = Joi.object({
  ...paginationQuery,
  limit: Joi.number().integer().min(1).max(MAX_LIMIT).default(20),
  sort: sortable('createdAt', 'month', 'fee').default('-month'),
  month: period(),
  amenityId: objectId(),
  apartmentId: objectId(),
  userId: objectId(),
  status: Joi.string().valid(...STATUSES),
  invoiced: Joi.boolean(),
});
const mineQuery = Joi.object({ apartmentId: objectId(), month: period(), status: Joi.string().valid(...STATUSES) });
const optionsQuery = Joi.object({ apartmentId: objectId(), month: period() });
const purchaseBody = Joi.object({
  apartmentId: objectId().required(),
  userId: objectId().required(),
  amenityId: objectId().required(),
  month: period().required(),
});
const cancelBody = Joi.object({ reason: Joi.string().trim().min(5).max(500).allow('') });

/**
 * @openapi
 * /amenity-passes/mine:
 *   get:
 *     tags: [Gói tháng tiện ích]
 *     summary: Gói tháng của hộ (chủ hộ thấy cả hộ, thành viên thấy gói của mình). Mặc định chỉ gói ACTIVE
 *     parameters:
 *       - { in: query, name: apartmentId, schema: { type: string } }
 *       - { in: query, name: month, schema: { type: string, example: '2026-10' } }
 *       - { in: query, name: status, schema: { type: string, enum: [ACTIVE, CANCELLED] } }
 */
router.get('/mine', authenticate, authorize('RESIDENT'), validate({ query: mineQuery }), async (req, res) => {
  ok(res, await service.listMyPasses(req.user, req.validated.query));
});

/**
 * @openapi
 * /amenity-passes/options:
 *   get:
 *     tags: [Gói tháng tiện ích]
 *     summary: Chủ hộ xem tiện ích có bán gói và giá theo nhóm tuổi của từng thành viên (tính tại ngày 1 của tháng gói)
 *     parameters:
 *       - { in: query, name: apartmentId, schema: { type: string } }
 *       - { in: query, name: month, schema: { type: string }, description: 'Tháng này hoặc tháng sau; mặc định tháng này' }
 */
router.get('/options', authenticate, authorize('RESIDENT'), validate({ query: optionsQuery }), async (req, res) => {
  ok(res, await service.getPurchaseOptions(req.user, req.validated.query));
});

/**
 * @openapi
 * /amenity-passes:
 *   get:
 *     tags: [Gói tháng tiện ích]
 *     summary: Trưởng BQL / Lễ tân xem mọi gói tháng, lọc theo tháng, tiện ích, căn, người dùng, trạng thái
 *     parameters:
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *       - { in: query, name: month, schema: { type: string } }
 *       - { in: query, name: amenityId, schema: { type: string } }
 *       - { in: query, name: apartmentId, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string, enum: [ACTIVE, CANCELLED] } }
 *       - { in: query, name: invoiced, schema: { type: boolean }, description: 'true = đã gộp hóa đơn' }
 *   post:
 *     tags: [Gói tháng tiện ích]
 *     summary: Chủ hộ mua gói tháng cho mình hoặc thành viên (tháng này hoặc tháng sau; giá snapshot theo nhóm tuổi tại ngày 1 của tháng)
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [apartmentId, userId, amenityId, month]
 *             properties:
 *               apartmentId: { type: string }
 *               userId: { type: string }
 *               amenityId: { type: string }
 *               month: { type: string, example: '2026-10' }
 */
router.get(
  '/',
  authenticate,
  authorize('MANAGER', 'STAFF:RECEPTIONIST'),
  validate({ query: listQuery }),
  async (req, res) => {
    const { items, pagination } = await service.listPasses(req.user, req.validated.query);
    paginated(res, items, pagination);
  },
);

router.post('/', authenticate, authorize('RESIDENT'), validate({ body: purchaseBody }), async (req, res) =>
  created(res, await service.purchasePass(req.user, req.body), 'Đã mua gói tháng'),
);

/**
 * @openapi
 * /amenity-passes/{id}/cancel:
 *   patch:
 *     tags: [Gói tháng tiện ích]
 *     summary: Hủy gói. Chủ hộ chỉ hủy gói tháng SAU; Trưởng BQL hủy gói bất kỳ chưa gộp hóa đơn (bắt buộc lý do, ghi audit)
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { reason: { type: string, example: 'Cư dân đề nghị hủy tại quầy' } } }
 */
router.patch(
  '/:id/cancel',
  authenticate,
  authorize('RESIDENT', 'MANAGER'),
  validate({ params: idParams, body: cancelBody }),
  async (req, res) => ok(res, await service.cancelPass(req.user, req.params.id, req.body), 'Đã hủy gói tháng'),
);

export default router;

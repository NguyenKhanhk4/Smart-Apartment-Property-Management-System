import { Router } from 'express';
import Joi from 'joi';
import { VISIT_CHARGE_TYPES, VISIT_STATUS } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { MAX_LIMIT, paginationQuery, sortable } from '../../utils/pagination.js';
import { created, ok, paginated } from '../../utils/response.js';
import { idParams, objectId } from '../../utils/validators.js';
import * as service from './amenityVisits.service.js';

// Module D — Thanh Bình. UC-D10: Quầy tiện ích — ghi lượt vào tiện ích WALK_IN (gói tháng / vé lẻ / miễn phí), hủy lượt.
// Thứ tự khai báo: /occupancy đứng TRƯỚC /:id.
const router = Router();
const VIEWERS = ['STAFF:RECEPTIONIST', 'MANAGER'];

const YMD = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).messages({ 'string.pattern.base': '{{#label}} phải có dạng YYYY-MM-DD' });
const createBody = Joi.object({
  amenityId: objectId().required(),
  code: Joi.string().trim().min(1).max(300).required(), // mã cư dân của người vào
  escortCode: Joi.string().trim().min(1).max(300).allow(''), // mã người lớn đi kèm (bắt buộc với trẻ em)
  accompaniedChildren: Joi.number().integer().min(0).max(20).default(0), // số trẻ dưới 6 tuổi đi kèm
});
const listQuery = Joi.object({
  ...paginationQuery,
  limit: Joi.number().integer().min(1).max(MAX_LIMIT).default(50),
  sort: sortable('visitedAt').default('-visitedAt'),
  date: YMD,
  amenityId: objectId(),
  apartmentId: objectId(),
  chargeType: Joi.string().valid(...Object.values(VISIT_CHARGE_TYPES)),
  status: Joi.string().valid(...Object.values(VISIT_STATUS)),
});

/**
 * @openapi
 * /amenity-visits:
 *   post:
 *     tags: [Tiện ích & đặt chỗ]
 *     summary: Lễ tân ghi lượt vào tiện ích WALK_IN. Gói tháng còn hiệu lực → PASS (0đ), không có → vé lẻ theo nhóm tuổi (SINGLE) hoặc FREE nếu giá 0. Trẻ 6–11 tuổi cần escortCode; trẻ dưới 6 tuổi ghi vào lượt người lớn (accompaniedChildren).
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amenityId, code]
 *             properties:
 *               amenityId: { type: string }
 *               code: { type: string, example: 'A-0501-01', description: 'Mã cư dân' }
 *               escortCode: { type: string, example: 'A-0501' }
 *               accompaniedChildren: { type: integer, example: 1 }
 */
router.post('/', authenticate, authorize('STAFF:RECEPTIONIST'), validate({ body: createBody }), async (req, res) =>
  created(res, await service.createVisit(req.user, { ...req.body, escortCode: req.body.escortCode || undefined }), 'Đã ghi lượt vào'),
);

/**
 * @openapi
 * /amenity-visits:
 *   get:
 *     tags: [Tiện ích & đặt chỗ]
 *     summary: Danh sách lượt vào (Lễ tân, Trưởng BQL) — lọc ngày (mặc định hôm nay), tiện ích, căn, loại (PASS/SINGLE/FREE), trạng thái
 *     parameters:
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *       - { in: query, name: date, schema: { type: string, example: '2026-10-09' } }
 *       - { in: query, name: amenityId, schema: { type: string } }
 *       - { in: query, name: apartmentId, schema: { type: string } }
 *       - { in: query, name: chargeType, schema: { type: string, enum: [PASS, SINGLE, FREE] } }
 *       - { in: query, name: status, schema: { type: string, enum: [VALID, CANCELLED] } }
 */
router.get('/', authenticate, authorize(...VIEWERS), validate({ query: listQuery }), async (req, res) => {
  const { items, pagination } = await service.listVisits(req.user, req.validated.query);
  paginated(res, items, pagination);
});

/**
 * @openapi
 * /amenity-visits/occupancy:
 *   get:
 *     tags: [Tiện ích & đặt chỗ]
 *     summary: Số người "đang trong tiện ích" của từng tiện ích WALK_IN (lượt VALID trong WALK_IN_VISIT_MINUTES gần nhất, mỗi lượt = 1 + trẻ nhỏ đi kèm) so với maxConcurrent
 */
router.get('/occupancy', authenticate, authorize(...VIEWERS), async (req, res) => ok(res, await service.getOccupancy(req.user)));

/**
 * @openapi
 * /amenity-visits/{id}/cancel:
 *   patch:
 *     tags: [Tiện ích & đặt chỗ]
 *     summary: Hủy lượt vào (Lễ tân, Trưởng BQL) — bắt buộc reason, chỉ khi chưa gộp hóa đơn (VISIT_ALREADY_BILLED), ghi audit AMENITY_VISIT_CANCELLED
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 */
router.patch(
  '/:id/cancel',
  authenticate,
  authorize(...VIEWERS),
  validate({ params: idParams, body: Joi.object({ reason: Joi.string().trim().max(500).allow('') }) }),
  async (req, res) => ok(res, await service.cancelVisit(req.user, req.params.id, req.body), 'Đã hủy lượt vào'),
);

export default router;

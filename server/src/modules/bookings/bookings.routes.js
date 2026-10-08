import { Router } from 'express';
import Joi from 'joi';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { MAX_LIMIT, paginationQuery } from '../../utils/pagination.js';
import { created, ok, paginated } from '../../utils/response.js';
import { idParams, objectId } from '../../utils/validators.js';
import { HHMM } from '../amenities/slot.utils.js';
import * as service from './bookings.service.js';

// Module D — Thanh Bình. UC-D06: đặt tiện ích (chỉ accessMode = BOOKING, tự xác nhận), xem lịch sử, hủy.
// Lưới slot nằm ở GET /amenities/:id/slots. Thứ tự khai báo: /mine đứng TRƯỚC /:id.
const router = Router();

const YMD = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).messages({ 'string.pattern.base': '{{#label}} phải có dạng YYYY-MM-DD' });
const createBody = Joi.object({
  apartmentId: objectId().required(),
  amenityId: objectId().required(),
  date: YMD.required(),
  slotStart: Joi.string().pattern(HHMM).required().messages({ 'string.pattern.base': '{{#label}} phải có dạng HH:mm' }),
});
const mineQuery = Joi.object({
  ...paginationQuery,
  limit: Joi.number().integer().min(1).max(MAX_LIMIT).default(20),
  apartmentId: objectId(),
  scope: Joi.string().valid('upcoming', 'past').default('upcoming'),
});

/**
 * @openapi
 * /bookings:
 *   post:
 *     tags: [Tiện ích & đặt chỗ]
 *     summary: Cư dân đặt slot tiện ích BOOKING (tự xác nhận APPROVED). Kiểm tra theo thứ tự — tiện ích, slot/ngày, nợ quá hạn, giới hạn booking chưa dùng, trùng slot, còn chỗ, phí/quyền phát sinh phí
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [apartmentId, amenityId, date, slotStart]
 *             properties:
 *               apartmentId: { type: string }
 *               amenityId: { type: string }
 *               date: { type: string, example: '2026-10-09' }
 *               slotStart: { type: string, example: '18:00' }
 */
router.post('/', authenticate, authorize('RESIDENT'), validate({ body: createBody }), async (req, res) =>
  created(res, await service.createBooking(req.user, req.body), 'Đặt tiện ích thành công'),
);

/**
 * @openapi
 * /bookings/mine:
 *   get:
 *     tags: [Tiện ích & đặt chỗ]
 *     summary: Lịch sử đặt của tôi (chủ hộ thấy cả hộ, thành viên thấy booking mình đặt). scope=upcoming | past
 *     parameters:
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *       - { in: query, name: apartmentId, schema: { type: string } }
 *       - { in: query, name: scope, schema: { type: string, enum: [upcoming, past], default: upcoming } }
 */
router.get('/mine', authenticate, authorize('RESIDENT'), validate({ query: mineQuery }), async (req, res) => {
  const { items, pagination } = await service.listMyBookings(req.user, req.validated.query);
  paginated(res, items, pagination);
});

/**
 * @openapi
 * /bookings/{id}/cancel:
 *   patch:
 *     tags: [Tiện ích & đặt chỗ]
 *     summary: Cư dân hủy booking APPROVED của căn mình trước giờ bắt đầu (miễn phí). Sau giờ → BOOKING_CANCEL_TOO_LATE
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 */
router.patch(
  '/:id/cancel',
  authenticate,
  authorize('RESIDENT'),
  validate({ params: idParams, body: Joi.object({ reason: Joi.string().trim().max(500).allow('') }) }),
  async (req, res) => ok(res, await service.cancelBooking(req.user, req.params.id, req.body), 'Đã hủy booking'),
);

export default router;

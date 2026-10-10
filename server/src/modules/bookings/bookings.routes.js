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
// UC-D07: lịch trong ngày, check-in (lễ tân / bảo vệ), lễ tân hủy kèm lý do, lễ tân đặt hộ tại quầy.
// Lưới slot nằm ở GET /amenities/:id/slots. Thứ tự khai báo: /mine, /schedule, /counter đứng TRƯỚC /:id.
const router = Router();
const SCHEDULE_ROLES = ['MANAGER', 'STAFF:RECEPTIONIST', 'STAFF:SECURITY'];

const YMD = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).messages({ 'string.pattern.base': '{{#label}} phải có dạng YYYY-MM-DD' });
const createBody = Joi.object({
  apartmentId: objectId().required(),
  amenityId: objectId().required(),
  date: YMD.required(),
  slotStart: Joi.string().pattern(HHMM).required().messages({ 'string.pattern.base': '{{#label}} phải có dạng HH:mm' }),
});
const counterBody = Joi.object({
  memberCode: Joi.string().trim().min(1).max(300).required(), // mã cư dân của người được đặt hộ
  payerCode: Joi.string().trim().min(1).max(300), // mã của chủ hộ / thành viên có quyền phí cùng căn (khi người đặt không có quyền phí)
  amenityId: objectId().required(),
  date: YMD.required(),
  slotStart: Joi.string().pattern(HHMM).required().messages({ 'string.pattern.base': '{{#label}} phải có dạng HH:mm' }),
  checkInNow: Joi.boolean().default(false),
});
const scheduleQuery = Joi.object({
  date: YMD,
  amenityId: objectId(),
  q: Joi.string().trim().max(100).allow(''),
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
 * /bookings/schedule:
 *   get:
 *     tags: [Tiện ích & đặt chỗ]
 *     summary: Lịch đặt trong ngày (Lễ tân, Bảo vệ, Trưởng BQL) — { date, serverTime, rules, bookings[] }, mỗi booking kèm mốc mở/đóng check-in. q = mã căn / mã cư dân / tên / SĐT
 *     parameters:
 *       - { in: query, name: date, schema: { type: string, example: '2026-10-09' }, description: 'Mặc định hôm nay (giờ VN)' }
 *       - { in: query, name: amenityId, schema: { type: string } }
 *       - { in: query, name: q, schema: { type: string } }
 */
router.get('/schedule', authenticate, authorize(...SCHEDULE_ROLES), validate({ query: scheduleQuery }), async (req, res) =>
  ok(res, await service.getSchedule(req.user, req.validated.query)),
);

/**
 * @openapi
 * /bookings/counter:
 *   post:
 *     tags: [Tiện ích & đặt chỗ]
 *     summary: Lễ tân đặt hộ tại quầy — dùng đủ kiểm tra của POST /bookings với người được đặt hộ. Phí > 0 mà người đó không có quyền phí thì cần payerCode của chủ hộ / thành viên có quyền phí cùng căn
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [memberCode, amenityId, date, slotStart]
 *             properties:
 *               memberCode: { type: string, example: 'A-0501-01' }
 *               payerCode: { type: string, example: 'A-0501' }
 *               amenityId: { type: string }
 *               date: { type: string, example: '2026-10-09' }
 *               slotStart: { type: string, example: '18:00' }
 *               checkInNow: { type: boolean, description: 'Đang trong khung check-in thì vào thẳng CHECKED_IN' }
 */
router.post('/counter', authenticate, authorize('STAFF:RECEPTIONIST'), validate({ body: counterBody }), async (req, res) =>
  created(res, await service.createCounterBooking(req.user, req.body), 'Đã đặt tiện ích giúp cư dân'),
);

/**
 * @openapi
 * /bookings/{id}/check-in:
 *   patch:
 *     tags: [Tiện ích & đặt chỗ]
 *     summary: Lễ tân / Bảo vệ check-in booking APPROVED trong khung [max(startAt − CHECKIN_EARLY_MINUTES, giờ lễ tân mở cửa), startAt + NO_SHOW_GRACE_MINUTES]. Gửi kèm code (mã cư dân) để kiểm tra người đến đúng căn
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 */
router.patch(
  '/:id/check-in',
  authenticate,
  authorize('STAFF:RECEPTIONIST', 'STAFF:SECURITY'),
  validate({ params: idParams, body: Joi.object({ code: Joi.string().trim().min(1).max(300).allow('') }) }),
  async (req, res) => ok(res, await service.checkInBooking(req.user, req.params.id, { code: req.body.code || undefined }), 'Đã check-in'),
);

/**
 * @openapi
 * /bookings/{id}/cancel:
 *   patch:
 *     tags: [Tiện ích & đặt chỗ]
 *     summary: Cư dân hủy booking APPROVED của căn mình trước giờ bắt đầu (miễn phí; sau giờ → BOOKING_CANCEL_TOO_LATE). Lễ tân hủy booking APPROVED bất kỳ — bắt buộc reason, người đặt không bị tính phí, ghi audit BOOKING_CANCELLED_BY_STAFF
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 */
router.patch(
  '/:id/cancel',
  authenticate,
  authorize('RESIDENT', 'STAFF:RECEPTIONIST'),
  validate({ params: idParams, body: Joi.object({ reason: Joi.string().trim().max(500).allow('') }) }),
  async (req, res) => ok(res, await service.cancelBooking(req.user, req.params.id, req.body), 'Đã hủy booking'),
);

export default router;

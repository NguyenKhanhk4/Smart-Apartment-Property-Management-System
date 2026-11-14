// Module 7: API vận hành mở rộng trên router sổ khách, phân quyền và kiểm tra dữ liệu trước mọi thao tác.
import { Router } from 'express';
import Joi from 'joi';
import { GUEST_STATUS, values } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { paginationQuery, sortable } from '../../utils/pagination.js';
import { created, ok, paginated } from '../../utils/response.js';
import { ApiError } from '../../utils/ApiError.js';
import { csvEnum, idParams, objectId } from '../../utils/validators.js';
import { uploadImages, uploadToCloudinary } from '../../services/upload.service.js';
import * as service from './guests.service.js';

const router = Router();
const GATE = ['STAFF:SECURITY'];
const VIEWERS = ['RESIDENT', 'STAFF:SECURITY', 'STAFF:RECEPTIONIST', 'MANAGER'];
const identityFields = {
  idType: Joi.string().valid('CCCD', 'CMND', 'PASSPORT', 'OTHER'),
  idNumber: Joi.string().trim().pattern(/^[A-Za-z0-9-]{6,30}$/),
};

router.get('/alerts', authenticate, authorize(...VIEWERS, 'STAFF:TECHNICIAN'), async (req, res) => ok(res, await service.activeAlerts(req.user)));
router.get('/operations/summary', authenticate, authorize('MANAGER', 'BOARD'), validate({ query: Joi.object({
  from: Joi.date(), to: Joi.date().when('from', { is: Joi.exist(), then: Joi.date().min(Joi.ref('from')) }),
}) }), async (req, res) => ok(res, await service.operationsSummary(req.user, req.validated.query)));
router.get('/operations/:kind', authenticate, authorize(...VIEWERS), validate({
  params: Joi.object({ kind: Joi.string().valid('parcels', 'checkpoints', 'tours', 'incidents').required() }),
  query: Joi.object({ ...paginationQuery, apartmentId: objectId(), status: Joi.string().valid('STORED', 'AWAITING_RETURN', 'COLLECTED', 'RETURNED', 'OPEN'),
    from: Joi.date(), to: Joi.date() }),
}), async (req, res) => {
  const { items, pagination } = await service.listOperations(req.user, req.params.kind, req.validated.query);
  paginated(res, items, pagination);
});
router.post('/parcels', authenticate, authorize('STAFF:RECEPTIONIST'), uploadImages('images', 3), validate({ body: Joi.object({
  apartmentId: objectId().required(), trackingCode: Joi.string().trim().min(2).max(80).required(), carrier: Joi.string().trim().max(100).required(),
}) }), async (req, res) => {
  if (!req.files?.length) throw ApiError.badRequest('Cần chụp ảnh bưu kiện');
  const urls = await uploadToCloudinary(req.files, 'parcels');
  created(res, await service.receiveParcel(req.user, req.body, urls));
});
router.get('/parcels/:id/recipients', authenticate, authorize('STAFF:RECEPTIONIST'), validate({ params: idParams }),
  async (req, res) => ok(res, await service.parcelRecipients(req.user, req.params.id)));
router.get('/parcels/:id/receipt', authenticate, authorize('STAFF:RECEPTIONIST', 'MANAGER'), validate({ params: idParams }),
  async (req, res) => ok(res, await service.parcelReceipt(req.user, req.params.id)));
router.patch('/parcels/:id/handover', authenticate, authorize('STAFF:RECEPTIONIST'), validate({ params: idParams, body: Joi.object({
  returned: Joi.boolean().default(false), recipientId: objectId().when('returned', { is: false, then: Joi.required() }),
  signature: Joi.string().max(150000).when('returned', { is: false, then: Joi.required() }),
}) }), async (req, res) => ok(res, await service.handOverParcel(req.user, req.params.id, req.body)));
router.post('/checkpoints', authenticate, authorize('MANAGER'), validate({ body: Joi.object({
  name: Joi.string().trim().max(100).required(), location: Joi.string().trim().max(200).required(),
}) }), async (req, res) => created(res, await service.createCheckpoint(req.user, req.body)));
router.patch('/checkpoints/:id', authenticate, authorize('MANAGER'), validate({ params: idParams, body: Joi.object({ active: Joi.boolean().required() }) }),
  async (req, res) => ok(res, await service.updateCheckpoint(req.user, req.params.id, req.body.active)));
router.post('/tours', authenticate, authorize('MANAGER'), validate({ body: Joi.object({
  name: Joi.string().trim().max(100).required(), shiftId: objectId().required(), startAt: Joi.date().required(),
  endAt: Joi.date().greater(Joi.ref('startAt')).required(), checkpointIds: Joi.array().items(objectId().required()).unique().min(1).max(50).required(),
}) }), async (req, res) => created(res, await service.createTour(req.user, req.body)));
router.patch('/tours/:id/scan', authenticate, authorize(...GATE), validate({ params: idParams, body: Joi.object({
  code: Joi.string().pattern(/^CP1\.[0-9a-f-]{36}$/).required(), latitude: Joi.number().min(-90).max(90), longitude: Joi.number().min(-180).max(180),
}).and('latitude', 'longitude') }), async (req, res) => ok(res, await service.scanCheckpoint(req.user, req.params.id, req.body)));
router.post('/incidents', authenticate, authorize(...GATE), uploadImages('images', 3), validate({ body: Joi.object({
  requestId: Joi.string().guid({ version: 'uuidv4' }).required(), type: Joi.string().valid('FIRE', 'SECURITY', 'COLLISION', 'TECHNICAL').required(),
  location: Joi.string().trim().max(200).required(), description: Joi.string().trim().min(5).max(2000).required(),
}) }), async (req, res) => {
  if (!req.files?.length) throw ApiError.badRequest('Cần ít nhất một ảnh hiện trường để báo sự cố khẩn');
  created(res, await service.reportIncident(req.user, req.body, await uploadToCloudinary(req.files, 'security-incidents')));
});
router.patch('/incidents/:id/acknowledge', authenticate, authorize('MANAGER', 'STAFF:SECURITY', 'STAFF:TECHNICIAN'), validate({ params: idParams }),
  async (req, res) => ok(res, await service.acknowledgeIncident(req.user, req.params.id)));
router.patch('/incidents/:id/broadcast', authenticate, authorize('MANAGER'), validate({ params: idParams }),
  async (req, res) => ok(res, await service.broadcastIncident(req.user, req.params.id)));
router.patch('/incidents/:id/end-broadcast', authenticate, authorize('MANAGER'), validate({ params: idParams }),
  async (req, res) => ok(res, await service.endBroadcast(req.user, req.params.id)));
router.patch('/:id/confirm', authenticate, authorize('RESIDENT'), validate({ params: idParams, body: Joi.object({ confirmed: Joi.boolean().required() }) }),
  async (req, res) => ok(res, await service.confirmGuest(req.user, req.params.id, req.body.confirmed)));

const guestFields = {
  guestName: Joi.string().trim().min(2).max(100).required(),
  guestPhone: Joi.string()
    .trim()
    .pattern(/^[0-9+\s-]{8,15}$/)
    .allow(''),
  numberOfGuests: Joi.number().integer().min(1).max(50),
  purpose: Joi.string().trim().max(200).allow(''),
  note: Joi.string().trim().max(500).allow(''),
};

/**
 * @openapi
 * /guests:
 *   get:
 *     tags: [Sổ khách]
 *     summary: Sổ khách (cư dân → căn mình; bảo vệ/lễ tân/manager → tất cả). ?date=YYYY-MM-DD lọc theo ngày
 *     parameters:
 *       - { in: query, name: date, schema: { type: string, format: date } }
 *       - { in: query, name: status, schema: { type: string, example: 'EXPECTED,CHECKED_IN' } }
 *       - { in: query, name: q, schema: { type: string }, description: 'Tên khách / SĐT / mã căn' }
 *   post:
 *     tags: [Sổ khách]
 *     summary: Cư dân đăng ký khách trước (UC-E07)
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [guestName, expectedTime]
 *             properties:
 *               guestName: { type: string }
 *               guestPhone: { type: string }
 *               expectedTime: { type: string, format: date-time }
 *               numberOfGuests: { type: integer }
 *               purpose: { type: string }
 *               apartmentId: { type: string }
 */
router.get(
  '/',
  authenticate,
  authorize(...VIEWERS),
  validate({
    query: Joi.object({
      ...paginationQuery,
      sort: sortable('createdAt', 'expectedTime', 'checkInTime', 'checkOutTime'),
      date: Joi.date(),
      status: csvEnum(values(GUEST_STATUS)),
      apartmentId: objectId(),
      q: Joi.string().trim().max(100),
    }),
  }),
  async (req, res) => {
    const { items, pagination } = await service.listGuests(req.user, req.validated.query);
    paginated(res, items, pagination);
  },
);

router.post(
  '/',
  authenticate,
  authorize('RESIDENT'),
  validate({
    body: Joi.object({ ...guestFields, expectedTime: Joi.date().required(), apartmentId: objectId() }),
  }),
  async (req, res) => created(res, await service.registerGuest(req.user, req.body), 'Đã đăng ký khách'),
);

/**
 * @openapi
 * /guests/walk-in:
 *   post:
 *     tags: [Sổ khách]
 *     summary: UC50 — Bảo vệ đang trực đối chiếu giấy tờ và ghi nhận khách vào
 */
router.post(
  '/walk-in',
  authenticate,
  authorize(...GATE),
  validate({
    body: Joi.object({
      ...guestFields,
      apartmentId: objectId().required(),
      idType: identityFields.idType.required(),
      idNumber: identityFields.idNumber.required(),
    }),
  }),
  async (req, res) => created(res, await service.walkIn(req.user, req.body), 'Đã ghi nhận khách vào'),
);

/**
 * @openapi
 * /guests/{id}/check-in:
 *   patch:
 *     tags: [Sổ khách]
 *     summary: Bảo vệ ghi giờ khách đến (UC-E08)
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 * /guests/{id}/check-out:
 *   patch:
 *     tags: [Sổ khách]
 *     summary: Bảo vệ ghi giờ khách rời (UC-E08)
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 * /guests/{id}:
 *   delete:
 *     tags: [Sổ khách]
 *     summary: Cư dân hủy đăng ký khách chưa đến
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 */
router.patch(
  '/:id/check-in',
  authenticate,
  authorize(...GATE),
  validate({ params: idParams, body: Joi.object({ note: guestFields.note, ...identityFields }) }),
  async (req, res) => ok(res, await service.checkIn(req.user, req.params.id, req.body ?? {}), 'Đã ghi nhận khách đến'),
);

router.patch(
  '/:id/check-out',
  authenticate,
  authorize(...GATE),
  validate({ params: idParams }),
  async (req, res) => ok(res, await service.checkOut(req.user, req.params.id), 'Đã ghi nhận khách rời'),
);

router.delete(
  '/:id',
  authenticate,
  authorize('RESIDENT'),
  validate({ params: idParams }),
  async (req, res) => ok(res, await service.cancelRegistration(req.user, req.params.id)),
);

export default router;

import { Router } from 'express';
import Joi from 'joi';
import { GUEST_STATUS, values } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { paginationQuery, sortable } from '../../utils/pagination.js';
import { created, ok, paginated } from '../../utils/response.js';
import { csvEnum, idParams, objectId } from '../../utils/validators.js';
import * as service from './guests.service.js';

const router = Router();
const GATE = ['STAFF:SECURITY'];
const VIEWERS = ['RESIDENT', 'STAFF:SECURITY', 'STAFF:RECEPTIONIST', 'MANAGER'];

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
 *     summary: Bảo vệ ghi khách vãng lai chưa đăng ký — bắt buộc tên + căn hộ (UC-E08, BR-O10)
 */
router.post(
  '/walk-in',
  authenticate,
  authorize(...GATE),
  validate({
    body: Joi.object({
      ...guestFields,
      apartmentId: objectId().required(),
      idNumber: Joi.string().trim().max(20).allow(''),
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
  validate({ params: idParams, body: Joi.object({ note: guestFields.note }) }),
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

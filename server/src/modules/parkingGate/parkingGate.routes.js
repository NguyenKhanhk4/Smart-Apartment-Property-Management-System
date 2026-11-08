import { Router } from 'express';
import Joi from 'joi';
import { ROLE_TITLES, ROLES, values } from '../../constants/enums.js';
import { PARKING_VEHICLE_TYPES } from '../../models/ParkingSession.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginationQuery } from '../../utils/pagination.js';
import { created, ok, paginated } from '../../utils/response.js';
import { idParams, ymd } from '../../utils/validators.js';
import * as service from './parkingGate.service.js';

const router = Router();
const security = `STAFF:${ROLE_TITLES.SECURITY}`;
const cardNumber = Joi.string().trim().uppercase().max(50).required();
const newGuestCardNumber = cardNumber.pattern(/^[A-Z0-9]+(?:[-_][A-Z0-9]+)*$/).messages({
  'string.pattern.base': 'Mã thẻ dùng chữ, số, dấu gạch ngang hoặc gạch dưới, ví dụ KH-01.',
});
const plate = Joi.string().trim().max(30).pattern(/^(?=.*\d)[A-Z0-9]+(?:[ .-]+[A-Z0-9]+)*$/i).messages({
  'string.pattern.base': 'Nhập biển số hợp lệ, ví dụ 51A-123.45 hoặc 51A12345.',
});
const vehicleIdentity = { cardNumber, plateNumber: plate.allow('', null) };

router.use(authenticate);

router.get('/history', authorize(security, ROLES.MANAGER), validate({ query: Joi.object({
  ...paginationQuery, plate, from: ymd(), to: ymd(),
}) }), async (req, res) => {
  const query = req.validated.query;
  if (query.from && query.to && query.from > query.to) throw ApiError.field('to', 'Đến ngày phải từ ngày bắt đầu trở đi');
  const { items, pagination } = await service.listSessions(query);
  return paginated(res, items, pagination);
});

router.get('/lookup', authorize(security, ROLES.MANAGER), validate({ query: Joi.object({ plate: plate.required() }) }), async (req, res) => {
  return ok(res, await service.lookupPlate(req.validated.query.plate));
});

router.post('/resident', authorize(security), validate({ body: Joi.object({
  ...vehicleIdentity, direction: Joi.string().valid('IN', 'OUT').required(),
}) }), async (req, res) => {
  return ok(res, await service.recordResidentPassage(req.validated.body, req.user));
});

router.post('/guests', authorize(security), validate({ body: Joi.object({
  ...vehicleIdentity, cardNumber: newGuestCardNumber,
  vehicleType: Joi.string().valid(...values(PARKING_VEHICLE_TYPES)).required(),
}) }), async (req, res) => {
  return created(res, await service.admitGuest(req.validated.body, req.user));
});

router.post('/guests/quote', authorize(security), validate({ body: Joi.object(vehicleIdentity) }), async (req, res) => {
  return ok(res, await service.quoteGuestExit(req.validated.body));
});

router.post('/guests/:id/close', authorize(security), validate({ params: idParams, body: Joi.object({
  ...vehicleIdentity, expectedFee: Joi.number().integer().min(0).required(),
}) }), async (req, res) => {
  return ok(res, await service.completeGuestExit(req.validated.params.id, req.validated.body, req.user));
});

export default router;

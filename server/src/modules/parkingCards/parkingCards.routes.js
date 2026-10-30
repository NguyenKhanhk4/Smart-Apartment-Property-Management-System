import { Router } from 'express';
import Joi from 'joi';
import {
  PARKING_CARD_STATUS,
  ROLE_TITLES,
  ROLES,
  values,
} from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { paginationQuery } from '../../utils/pagination.js';
import { ok, paginated } from '../../utils/response.js';
import { idParams, objectId } from '../../utils/validators.js';
import * as service from './parkingCards.service.js';

const router = Router();

const VIEWERS = [`STAFF:${ROLE_TITLES.RECEPTIONIST}`, ROLES.MANAGER];
const RECEPTIONIST_ONLY = [`STAFF:${ROLE_TITLES.RECEPTIONIST}`];

const listQuerySchema = Joi.object({
  ...paginationQuery,
  status: Joi.string().valid(...values(PARKING_CARD_STATUS)),
  apartmentId: objectId(),
  vehicleId: objectId(),
  q: Joi.string().trim().max(50).allow(''),
});

const noteBodySchema = Joi.object({
  note: Joi.string().trim().max(500).allow('', null).optional(),
});

const statusBodySchema = Joi.object({
  status: Joi.string()
    .valid(PARKING_CARD_STATUS.RETURNED, PARKING_CARD_STATUS.LOST)
    .required(),
  note: Joi.string().trim().max(500).allow('', null).optional(),
});

/**
 * GET /parking-cards — Danh sách thẻ gửi xe (Lễ tân / Trưởng BQL)
 */
router.get(
  '/',
  authenticate,
  authorize(...VIEWERS),
  validate({ query: listQuerySchema }),
  async (req, res) => {
    const { items, pagination } = await service.listParkingCards(req.validated.query);
    return paginated(res, items, pagination);
  },
);

/**
 * PATCH /parking-cards/:id/collect — Lễ tân xác nhận đã thu hồi thẻ (RETURNED)
 */
router.patch(
  '/:id/collect',
  authenticate,
  authorize(...RECEPTIONIST_ONLY),
  validate({ params: idParams, body: noteBodySchema }),
  async (req, res) => {
    const data = await service.closeParkingCard(
      req.validated.params.id,
      { status: PARKING_CARD_STATUS.RETURNED, note: req.validated.body?.note },
      req.user,
      req.ip,
    );
    return ok(res, data, 'Đã ghi nhận thu hồi thẻ gửi xe');
  },
);

/**
 * PATCH /parking-cards/:id/lost — Lễ tân ghi nhận mất thẻ (LOST)
 */
router.patch(
  '/:id/lost',
  authenticate,
  authorize(...RECEPTIONIST_ONLY),
  validate({ params: idParams, body: noteBodySchema }),
  async (req, res) => {
    const data = await service.closeParkingCard(
      req.validated.params.id,
      { status: PARKING_CARD_STATUS.LOST, note: req.validated.body?.note },
      req.user,
      req.ip,
    );
    return ok(res, data, 'Đã ghi nhận mất thẻ gửi xe');
  },
);

/**
 * PATCH /parking-cards/:id/status — Cập nhật trạng thái đóng thẻ (RETURNED / LOST)
 */
router.patch(
  '/:id/status',
  authenticate,
  authorize(...RECEPTIONIST_ONLY),
  validate({ params: idParams, body: statusBodySchema }),
  async (req, res) => {
    const data = await service.closeParkingCard(
      req.validated.params.id,
      req.validated.body,
      req.user,
      req.ip,
    );
    return ok(res, data, 'Đã cập nhật trạng thái thẻ gửi xe');
  },
);

export default router;

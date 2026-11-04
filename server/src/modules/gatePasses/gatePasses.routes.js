import { Router } from 'express';
import Joi from 'joi';
import {
  GATE_PASS_DIRECTIONS,
  GATE_PASS_STATUS,
  ROLE_TITLES,
  ROLES,
  values,
} from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { paginationQuery } from '../../utils/pagination.js';
import { created, ok, paginated } from '../../utils/response.js';
import { hhmm, idParams, objectId } from '../../utils/validators.js';
import * as service from './gatePasses.service.js';

const router = Router();
export const platesRouter = Router();

const VIEWERS = [
  ROLES.RESIDENT,
  ROLES.MANAGER,
  `STAFF:${ROLE_TITLES.SECURITY}`,
  `STAFF:${ROLE_TITLES.RECEPTIONIST}`,
];
const SECURITY_AND_MANAGER = [`STAFF:${ROLE_TITLES.SECURITY}`, ROLES.MANAGER];
const SECURITY_ONLY = [`STAFF:${ROLE_TITLES.SECURITY}`];
const MANAGER_ONLY = [ROLES.MANAGER];

const createBodySchema = Joi.object({
  apartmentId: objectId(),
  direction: Joi.string()
    .valid(...values(GATE_PASS_DIRECTIONS))
    .required(),
  scheduledDate: Joi.date().iso().required(),
  timeSlot: Joi.object({
    from: hhmm()
      .required(),
    to: hhmm()
      .required(),
  }).required(),
  items: Joi.array()
    .items(
      Joi.object({
        name: Joi.string().trim().min(1).max(200).required(),
        quantity: Joi.number().integer().min(1).required(),
      }),
    )
    .min(1)
    .required(),
  truckPlate: Joi.string().trim().min(1).max(30).required(),
  driverPhone: Joi.string().trim().allow('', null).max(25).optional(),
});

const listQuerySchema = Joi.object({
  ...paginationQuery,
  apartmentId: objectId(),
  buildingId: objectId(),
  status: Joi.string().valid(...values(GATE_PASS_STATUS)),
  direction: Joi.string().valid(...values(GATE_PASS_DIRECTIONS)),
  today: Joi.boolean(),
  date: Joi.date().iso(),
  search: Joi.string().trim().max(50).allow(''),
});

const todayQuerySchema = Joi.object({
  includeUsed: Joi.boolean().default(false),
  search: Joi.string().trim().max(50).allow(''),
});

const ownerDecisionBodySchema = Joi.object({
  approved: Joi.boolean().required(),
  rejectReason: Joi.string().trim().max(500).allow('', null).optional(),
});

const reviewBodySchema = Joi.object({
  approved: Joi.boolean().required(),
  rejectReason: Joi.when('approved', {
    is: false,
    then: Joi.string().trim().min(1).max(500).required().messages({
      'string.empty': 'Lý do từ chối là bắt buộc',
      'any.required': 'Lý do từ chối là bắt buộc',
    }),
    otherwise: Joi.string().trim().max(500).allow('', null).optional(),
  }),
});

const rejectOnlyBodySchema = Joi.object({
  rejectReason: Joi.string().trim().min(1).max(500).required().messages({
    'string.empty': 'Lý do từ chối là bắt buộc',
    'any.required': 'Lý do từ chối là bắt buộc',
  }),
});

const plateLookupQuerySchema = Joi.object({
  plate: Joi.string().trim().min(1).max(30).required(),
});

/**
 * GET /plates/lookup?plate= — UC62: Bảo vệ / Trưởng BQL tra cứu biển số
 */
platesRouter.get(
  '/lookup',
  authenticate,
  authorize(...SECURITY_AND_MANAGER),
  validate({ query: plateLookupQuerySchema }),
  async (req, res) => {
    const data = await service.lookupPlate(req.validated.query.plate);
    return ok(res, data);
  },
);

/**
 * GET /gate-passes/lookup-plate?plate= — alias tra biển số
 */
router.get(
  '/lookup-plate',
  authenticate,
  authorize(...SECURITY_AND_MANAGER),
  validate({ query: plateLookupQuerySchema }),
  async (req, res) => {
    const data = await service.lookupPlate(req.validated.query.plate);
    return ok(res, data);
  },
);

/**
 * GET /gate-passes/today — UC54: Bảo vệ xem danh sách Gate Pass đã duyệt trong ngày hôm nay
 */
router.get(
  '/today',
  authenticate,
  authorize(...SECURITY_AND_MANAGER),
  validate({ query: todayQuerySchema }),
  async (req, res) => {
    const data = await service.listTodayGatePassesForSecurity(req.validated.query);
    return ok(res, data);
  },
);

/**
 * GET /gate-passes — Danh sách đơn chuyển đồ
 */
router.get(
  '/',
  authenticate,
  authorize(...VIEWERS),
  validate({ query: listQuerySchema }),
  async (req, res) => {
    const { items, pagination } = await service.listGatePasses(req.user, req.validated.query);
    return paginated(res, items, pagination);
  },
);

/**
 * GET /gate-passes/:id — Chi tiết đơn chuyển đồ (đơn OUT có kèm currentDebt)
 */
router.get(
  '/:id',
  authenticate,
  authorize(...VIEWERS),
  validate({ params: idParams }),
  async (req, res) => {
    const data = await service.getGatePassById(req.user, req.validated.params.id);
    return ok(res, data);
  },
);

/**
 * POST /gate-passes — UC52: Cư dân tạo đơn chuyển đồ
 */
router.post(
  '/',
  authenticate,
  authorize(ROLES.RESIDENT),
  validate({ body: createBodySchema }),
  async (req, res) => {
    const data = await service.createGatePass(req.user, req.validated.body, req.ip);
    return created(res, data, 'Đã tạo đơn chuyển đồ thành công');
  },
);

/**
 * PATCH /gate-passes/:id/owner-decision — UC52: Chủ hộ xác nhận hoặc từ chối đơn của khách thuê
 */
router.patch(
  '/:id/owner-decision',
  authenticate,
  authorize(ROLES.RESIDENT),
  validate({ params: idParams, body: ownerDecisionBodySchema }),
  async (req, res) => {
    const data = await service.ownerDecision(
      req.user,
      req.validated.params.id,
      req.validated.body,
      req.ip,
    );
    return ok(res, data, 'Đã cập nhật xác nhận của chủ hộ');
  },
);

/**
 * PATCH /gate-passes/:id/review — UC53: Trưởng BQL duyệt hoặc từ chối đơn PENDING
 */
router.patch(
  '/:id/review',
  authenticate,
  authorize(...MANAGER_ONLY),
  validate({ params: idParams, body: reviewBodySchema }),
  async (req, res) => {
    const data = await service.reviewGatePass(
      req.user,
      req.validated.params.id,
      req.validated.body,
      req.ip,
    );
    return ok(res, data, 'Đã xử lý đơn chuyển đồ');
  },
);

/**
 * PATCH /gate-passes/:id/approve — UC53: Trưởng BQL duyệt đơn PENDING
 */
router.patch(
  '/:id/approve',
  authenticate,
  authorize(...MANAGER_ONLY),
  validate({ params: idParams }),
  async (req, res) => {
    const data = await service.reviewGatePass(
      req.user,
      req.validated.params.id,
      { approved: true },
      req.ip,
    );
    return ok(res, data, 'Đã duyệt đơn chuyển đồ');
  },
);

/**
 * PATCH /gate-passes/:id/reject — UC53: Trưởng BQL từ chối đơn PENDING (bắt buộc lý do)
 */
router.patch(
  '/:id/reject',
  authenticate,
  authorize(...MANAGER_ONLY),
  validate({ params: idParams, body: rejectOnlyBodySchema }),
  async (req, res) => {
    const data = await service.reviewGatePass(
      req.user,
      req.validated.params.id,
      { approved: false, rejectReason: req.validated.body.rejectReason },
      req.ip,
    );
    return ok(res, data, 'Đã từ chối đơn chuyển đồ');
  },
);

/**
 * PATCH /gate-passes/:id/mark-used — UC54: Bảo vệ đánh dấu đã sử dụng (Used)
 */
router.patch(
  '/:id/mark-used',
  authenticate,
  authorize(...SECURITY_ONLY),
  validate({ params: idParams }),
  async (req, res) => {
    const data = await service.markGatePassUsed(req.user, req.validated.params.id, req.ip);
    return ok(res, data, 'Đã đánh dấu đơn chuyển đồ đã sử dụng');
  },
);

export default router;

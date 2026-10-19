import { Router } from 'express';
import Joi from 'joi';
import { FEE_CALC_METHODS, FEE_CATEGORIES, VEHICLE_TYPES, values } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { created, ok } from '../../utils/response.js';
import { idParams, period } from '../../utils/validators.js';
import * as service from './feeTypes.service.js';

// Module B — UC-B01: Danh mục phí & đơn giá theo thời gian. Trưởng BQL cấu hình, Kế toán xem.
// Thứ tự khai báo: /current đứng TRƯỚC /:id.
const router = Router();

// Phí tiện ích do Module D định giá trên amenities, không khai ở đây
const FEE_TYPE_CATEGORIES = [FEE_CATEGORIES.CLEANING, FEE_CATEGORIES.PARKING];

const code = Joi.string()
  .trim()
  .uppercase()
  .pattern(/^[A-Z0-9_]{2,40}$/)
  .messages({ 'string.pattern.base': '{{#label}} chỉ gồm chữ in hoa, số và dấu _ (2–40 ký tự)' });
const unitPrice = Joi.number().integer().min(0).max(1_000_000_000);
const name = Joi.string().trim().min(1).max(100);

const listQuery = Joi.object({
  code,
  feeCategory: Joi.string().valid(...FEE_TYPE_CATEGORIES),
  state: Joi.string().valid(...values(service.FEE_TYPE_STATES)),
});
const createBody = Joi.object({
  code: code.required(),
  name,
  feeCategory: Joi.string().valid(...FEE_TYPE_CATEGORIES),
  calcMethod: Joi.string().valid(...values(FEE_CALC_METHODS)),
  vehicleType: Joi.string().valid(...values(VEHICLE_TYPES)).allow(null),
  unitPrice: unitPrice.required(),
  effectiveFrom: period().required(), // kỳ bắt đầu áp dụng 'YYYY-MM'
});
const updateBody = Joi.object({ name, unitPrice })
  .min(1)
  .messages({ 'object.min': 'Cần gửi ít nhất name hoặc unitPrice' });
const endBody = Joi.object({ effectiveTo: period().required() }); // kỳ bắt đầu ngừng thu

/**
 * @openapi
 * /fee-types:
 *   get:
 *     tags: [Phí & hóa đơn]
 *     summary: Danh sách mức giá theo thời gian (mới nhất trước trong từng mã phí). Mỗi bản ghi kèm fromPeriod, endPeriod (kỳ cuối, null = chưa kết thúc), state (ACTIVE / UPCOMING / ENDED) và inUse (đã dùng lập hóa đơn → khóa sửa giá/xóa)
 *     parameters:
 *       - { in: query, name: code, schema: { type: string }, example: PARKING_MOTORBIKE }
 *       - { in: query, name: feeCategory, schema: { type: string, enum: [CLEANING, PARKING] } }
 *       - { in: query, name: state, schema: { type: string, enum: [ACTIVE, UPCOMING, ENDED] } }
 */
router.get('/', authenticate, authorize('MANAGER', 'ACCOUNTANT'), validate({ query: listQuery }), async (req, res) =>
  ok(res, await service.listFeeTypes(req.validated.query)),
);

/**
 * @openapi
 * /fee-types/current:
 *   get:
 *     tags: [Phí & hóa đơn]
 *     summary: Bảng giá đang áp dụng kỳ hiện tại (mọi người dùng đã đăng nhập)
 */
router.get('/current', authenticate, async (_req, res) => ok(res, await service.getCurrentPrices()));

/**
 * @openapi
 * /fee-types:
 *   post:
 *     tags: [Phí & hóa đơn]
 *     summary: Tạo mức giá từ kỳ effectiveFrom. Mã phí mới cần name, feeCategory, calcMethod (+ vehicleType nếu gửi xe). Mã đã có = đổi giá, mức đang mở tự kết thúc trước kỳ mới. Không áp dụng cho kỳ đã qua hoặc đã lập hóa đơn (FEE_PERIOD_BILLED); trùng khoảng → FEE_TYPE_OVERLAP
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, unitPrice, effectiveFrom]
 *             properties:
 *               code: { type: string, example: PARKING_MOTORBIKE }
 *               name: { type: string, example: Vé xe máy }
 *               feeCategory: { type: string, enum: [CLEANING, PARKING] }
 *               calcMethod: { type: string, enum: [PER_M2, PER_APARTMENT, PER_VEHICLE] }
 *               vehicleType: { type: string, enum: [BICYCLE, MOTORBIKE, CAR] }
 *               unitPrice: { type: integer, example: 150000 }
 *               effectiveFrom: { type: string, example: '2026-11' }
 */
router.post('/', authenticate, authorize('MANAGER'), validate({ body: createBody }), async (req, res) =>
  created(res, await service.createFeeType(req.user, req.body), 'Đã lưu mức giá'),
);

/**
 * @openapi
 * /fee-types/{id}:
 *   patch:
 *     tags: [Phí & hóa đơn]
 *     summary: Đổi tên (áp dụng cho mọi mức giá cùng mã) và/hoặc sửa đơn giá của mức chưa dùng lập hóa đơn (FEE_TYPE_IN_USE)
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               unitPrice: { type: integer }
 */
router.patch('/:id', authenticate, authorize('MANAGER'), validate({ params: idParams, body: updateBody }), async (req, res) =>
  ok(res, await service.updateFeeType(req.user, req.params.id, req.body), 'Đã cập nhật mức giá'),
);

/**
 * @openapi
 * /fee-types/{id}/end:
 *   patch:
 *     tags: [Phí & hóa đơn]
 *     summary: Ngừng thu phí từ kỳ effectiveTo (kỳ trước đó là kỳ cuối còn tính). Chỉ mức giá chưa có kỳ kết thúc
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [effectiveTo]
 *             properties:
 *               effectiveTo: { type: string, example: '2027-01' }
 */
router.patch('/:id/end', authenticate, authorize('MANAGER'), validate({ params: idParams, body: endBody }), async (req, res) =>
  ok(res, await service.endFeeType(req.user, req.params.id, req.body), 'Đã đặt kỳ ngừng thu'),
);

/**
 * @openapi
 * /fee-types/{id}:
 *   delete:
 *     tags: [Phí & hóa đơn]
 *     summary: Xóa mức giá chưa dùng lập hóa đơn (FEE_TYPE_IN_USE). Mức giá liền trước được nối dài để bảng giá không bị hở
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 */
router.delete('/:id', authenticate, authorize('MANAGER'), validate({ params: idParams }), async (req, res) =>
  ok(res, await service.deleteFeeType(req.user, req.params.id), 'Đã xóa mức giá'),
);

export default router;

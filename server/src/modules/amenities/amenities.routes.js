import { Router } from 'express';
import Joi from 'joi';
import { AMENITY_ACCESS_MODES } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { uploadImages } from '../../services/upload.service.js';
import { MAX_LIMIT, paginationQuery, sortable } from '../../utils/pagination.js';
import { created, ok, paginated } from '../../utils/response.js';
import { idParams, objectId } from '../../utils/validators.js';
import * as service from './amenities.service.js';
import { HHMM } from './slot.utils.js';

const MODES = Object.values(AMENITY_ACCESS_MODES);
const { WALK_IN, BOOKING } = AMENITY_ACCESS_MODES;

// Module D — Thanh Bình. UC-D05: Quản lý tiện ích theo kiểu (tự do / vào cửa / đặt chỗ): giờ mở cửa, slot, sức chứa,
// giá theo nhóm tuổi, gói tháng, ngừng/kích hoạt.
const router = Router();
const VIEWERS = ['MANAGER', 'STAFF:RECEPTIONIST', 'RESIDENT'];

const listQuery = Joi.object({
  ...paginationQuery,
  limit: Joi.number().integer().min(1).max(MAX_LIMIT).default(50),
  sort: sortable('name', 'createdAt', 'feePerBooking').default('name'),
  isActive: Joi.boolean(),
  accessMode: Joi.string().valid(...MODES),
  buildingId: objectId(),
  q: Joi.string().trim().max(100),
});

const time = () => Joi.string().pattern(HHMM).messages({ 'string.pattern.base': '{{#label}} phải có dạng HH:mm' });

// multipart: số đến dạng chuỗi, Joi convert sang number. Trường tùy chọn cho phép '' = xóa giá trị (null)
const money = () => Joi.number().integer().min(0).max(100000000);
const fields = {
  name: Joi.string().trim().min(2).max(100),
  accessMode: Joi.string().valid(...MODES),
  buildingId: objectId().allow('', null), // trống = dùng chung toàn khu
  location: Joi.string().trim().max(200).allow(''),
  description: Joi.string().trim().max(1000).allow(''),
  openTime: time().allow('', null), // FREE: tùy chọn; WALK_IN/BOOKING: bắt buộc (kiểm tra ở service khi sửa)
  closeTime: time().allow('', null),
  slotDurationMinutes: Joi.number().integer().min(15).max(720),
  capacityPerSlot: Joi.number().integer().min(1).max(1000),
  feePerBooking: money(),
  perVisitFeeAdult: money(),
  perVisitFeeChild: money(),
  maxConcurrent: Joi.number().integer().min(1).max(10000).allow('', null),
  monthlyPassFeeAdult: money().allow('', null),
  monthlyPassFeeChild: money().allow('', null),
};

// Trường bắt buộc theo kiểu (bỏ qua nếu kiểu không dùng). accessMode mặc định BOOKING để tương thích client cũ
const requiredWhen = (schema, modes) =>
  schema.when('accessMode', { is: Joi.valid(...modes), then: Joi.required(), otherwise: Joi.optional() });

const createBody = Joi.object({
  ...fields,
  name: fields.name.required(),
  accessMode: fields.accessMode.default(BOOKING),
  openTime: requiredWhen(fields.openTime, [WALK_IN, BOOKING]),
  closeTime: requiredWhen(fields.closeTime, [WALK_IN, BOOKING]),
  slotDurationMinutes: requiredWhen(fields.slotDurationMinutes, [BOOKING]),
  capacityPerSlot: requiredWhen(fields.capacityPerSlot, [BOOKING]),
  feePerBooking: fields.feePerBooking.default(0),
  perVisitFeeAdult: requiredWhen(fields.perVisitFeeAdult, [WALK_IN]),
  perVisitFeeChild: requiredWhen(fields.perVisitFeeChild, [WALK_IN]),
});
const updateBody = Joi.object(fields);

/**
 * @openapi
 * /amenities:
 *   get:
 *     tags: [Tiện ích & đặt chỗ]
 *     summary: Danh sách tiện ích (UC-D05), mỗi mục có accessMode và priceSummary tính sẵn. Cư dân thấy cả 3 kiểu nhưng chỉ tiện ích đang hoạt động, dùng chung hoặc thuộc tòa mình
 *     parameters:
 *       - $ref: '#/components/parameters/page'
 *       - { in: query, name: limit, schema: { type: integer, default: 50 } }
 *       - { in: query, name: sort, schema: { type: string, enum: [name, -name, createdAt, -createdAt, feePerBooking, -feePerBooking] } }
 *       - { in: query, name: isActive, schema: { type: boolean } }
 *       - { in: query, name: accessMode, schema: { type: string, enum: [FREE, WALK_IN, BOOKING] } }
 *       - { in: query, name: buildingId, schema: { type: string } }
 *       - { in: query, name: q, schema: { type: string } }
 *   post:
 *     tags: [Tiện ích & đặt chỗ]
 *     summary: Thêm tiện ích theo kiểu accessMode (FREE / WALK_IN / BOOKING; mặc định BOOKING). WALK_IN và BOOKING áp BR-O15 (giờ mở cửa trong giờ lễ tân); BOOKING vừa ≥ 1 slot
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [name]
 *             description: 'FREE: giờ mở cửa tùy chọn. WALK_IN: openTime, closeTime, perVisitFeeAdult, perVisitFeeChild bắt buộc. BOOKING: openTime, closeTime, slotDurationMinutes, capacityPerSlot bắt buộc.'
 *             properties:
 *               name: { type: string, example: 'Phòng gym' }
 *               accessMode: { type: string, enum: [FREE, WALK_IN, BOOKING], default: BOOKING }
 *               buildingId: { type: string, description: 'Để trống = dùng chung toàn khu' }
 *               location: { type: string }
 *               description: { type: string }
 *               openTime: { type: string, example: '08:00' }
 *               closeTime: { type: string, example: '17:00' }
 *               slotDurationMinutes: { type: integer, example: 60 }
 *               capacityPerSlot: { type: integer, example: 10 }
 *               feePerBooking: { type: integer, example: 50000, description: 'BOOKING: phí mỗi lượt đặt, 0 = miễn phí' }
 *               perVisitFeeAdult: { type: integer, example: 50000, description: 'WALK_IN: vé lẻ người lớn' }
 *               perVisitFeeChild: { type: integer, example: 30000, description: 'WALK_IN: vé lẻ trẻ em' }
 *               maxConcurrent: { type: integer, description: 'WALK_IN: số người tối đa cùng lúc, để trống = không giới hạn' }
 *               monthlyPassFeeAdult: { type: integer, example: 400000, description: 'WALK_IN/BOOKING: gói tháng người lớn; để trống cả hai giá gói = không bán gói' }
 *               monthlyPassFeeChild: { type: integer, example: 250000 }
 *               image: { type: string, format: binary, description: 'jpg/png ≤ 5MB' }
 */
router.get('/', authenticate, authorize(...VIEWERS), validate({ query: listQuery }), async (req, res) => {
  const { items, pagination } = await service.listAmenities(req.user, req.validated.query);
  paginated(res, items, pagination);
});

router.post(
  '/',
  authenticate,
  authorize('MANAGER'),
  uploadImages('image', 1),
  validate({ body: createBody }),
  async (req, res) => created(res, await service.createAmenity(req.user, req.body, req.files), 'Đã thêm tiện ích'),
);

/**
 * @openapi
 * /amenities/{id}:
 *   get:
 *     tags: [Tiện ích & đặt chỗ]
 *     summary: Chi tiết tiện ích (cư dân xem tiện ích không được dùng → 404)
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *   put:
 *     tags: [Tiện ích & đặt chỗ]
 *     summary: Sửa tiện ích — chỉ áp dụng cho booking mới; đổi bất kỳ trường phí nào ghi audit AMENITY_FEE_CHANGED { name, changes }; đổi accessMode khi còn booking sắp tới → AMENITY_HAS_ACTIVE_BOOKINGS
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema: { type: object, description: 'Các field như POST, đều tùy chọn' }
 */
router.get('/:id', authenticate, authorize(...VIEWERS), validate({ params: idParams }), async (req, res) =>
  ok(res, await service.getAmenity(req.user, req.params.id)),
);

router.put(
  '/:id',
  authenticate,
  authorize('MANAGER'),
  uploadImages('image', 1),
  validate({ params: idParams, body: updateBody }),
  async (req, res) => ok(res, await service.updateAmenity(req.user, req.params.id, req.body, req.files), 'Đã cập nhật tiện ích'),
);

/**
 * @openapi
 * /amenities/{id}/status:
 *   patch:
 *     tags: [Tiện ích & đặt chỗ]
 *     summary: Ngừng / kích hoạt lại tiện ích. Còn booking sắp tới → AMENITY_HAS_ACTIVE_BOOKINGS (BR-O19)
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, required: [isActive], properties: { isActive: { type: boolean } } }
 */
router.patch(
  '/:id/status',
  authenticate,
  authorize('MANAGER'),
  validate({ params: idParams, body: Joi.object({ isActive: Joi.boolean().required() }) }),
  async (req, res) =>
    ok(
      res,
      await service.setAmenityStatus(req.params.id, req.body.isActive),
      req.body.isActive ? 'Đã kích hoạt lại tiện ích' : 'Đã ngừng tiện ích',
    ),
);

export default router;

import { Router } from 'express';
import Joi from 'joi';
import { ASSET_CATEGORIES, CYCLE_UNITS, values } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { paginationQuery, sortable } from '../../utils/pagination.js';
import { created, ok, paginated } from '../../utils/response.js';
import { csvEnum, idParams, objectId } from '../../utils/validators.js';
import * as service from './assets.service.js';

// Người 1 — Vũ Việt (Mô đun 10). UC07: Quản lý thiết bị, chu kỳ, mẫu checklist, mã QR, lịch sử bảo trì.
const router = Router();
const VIEWERS = ['MANAGER', 'STAFF:TECHNICIAN'];

const listQuery = Joi.object({
  ...paginationQuery,
  sort: sortable('createdAt', 'code', 'name', 'nextMaintenanceDate', 'lastMaintenanceDate', 'warrantyEnd'),
  buildingId: objectId(),
  category: csvEnum(values(ASSET_CATEGORIES)),
  isActive: Joi.boolean(),
  dueWithinDays: Joi.number().integer().min(0).max(365),
  q: Joi.string().trim().max(100),
});

// Mục checklist (BR-E02): mục đo có đơn vị / khoảng cho phép; mục tick để trống các trường đó
const checklistItem = Joi.object({
  label: Joi.string().trim().min(1).max(200).required(),
  unit: Joi.string().trim().max(20).allow('', null).empty('').default(null),
  minValue: Joi.number().allow(null).default(null),
  maxValue: Joi.number().allow(null).default(null),
  required: Joi.boolean().default(true),
});

const fields = {
  buildingId: objectId(),
  // Mã thiết bị: chữ, số, gạch ngang (in trên nhãn QR); lưu chữ hoa
  code: Joi.string().trim().uppercase().pattern(/^[A-Z0-9][A-Z0-9-]{1,29}$/)
    .messages({ 'string.pattern.base': 'Mã thiết bị gồm 2–30 ký tự chữ, số hoặc dấu gạch ngang' }),
  name: Joi.string().trim().min(2).max(150),
  category: Joi.string().valid(...values(ASSET_CATEGORIES)),
  location: Joi.string().trim().max(200).allow(''),
  manufacturer: Joi.string().trim().max(150).allow('', null),
  installDate: Joi.date().allow(null),
  warrantyEnd: Joi.date().allow(null),
  vendorName: Joi.string().trim().max(150).allow('', null),
  vendorPhone: Joi.string().trim().max(30).pattern(/^[0-9+().\s-]*$/).allow('', null)
    .messages({ 'string.pattern.base': 'Số điện thoại nhà cung cấp không hợp lệ' }),
  cycleValue: Joi.number().integer().min(1).max(3650),
  cycleUnit: Joi.string().valid(...values(CYCLE_UNITS)),
  checklist: Joi.array().items(checklistItem).max(50),
  lastMaintenanceDate: Joi.date().allow(null),
  note: Joi.string().trim().max(1000).allow(''),
};

const createBody = Joi.object({
  ...fields,
  buildingId: fields.buildingId.required(),
  code: fields.code.required(),
  name: fields.name.required(),
  category: fields.category.required(),
  cycleValue: fields.cycleValue.required(),
  cycleUnit: fields.cycleUnit.required(),
  checklist: fields.checklist.required(),
});
const updateBody = Joi.object(fields).min(1);

/**
 * @openapi
 * /assets:
 *   get:
 *     tags: [Thiết bị & bảo trì]
 *     summary: Danh sách thiết bị (lọc tòa/loại/trạng thái, sắp đến hạn) — UC-D01
 *     parameters:
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *       - { in: query, name: buildingId, schema: { type: string } }
 *       - { in: query, name: category, schema: { type: string }, description: 'ELEVATOR,PUMP,...' }
 *       - { in: query, name: isActive, schema: { type: boolean } }
 *       - { in: query, name: dueWithinDays, schema: { type: integer }, description: 'Đến hạn trong N ngày tới (0 = đến hạn/quá hạn)' }
 *       - { in: query, name: q, schema: { type: string } }
 *   post:
 *     tags: [Thiết bị & bảo trì]
 *     summary: Thêm thiết bị, tự tính nextMaintenanceDate (BR-O18) — UC-D01
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [buildingId, code, name, category, cycleValue, cycleUnit, checklist]
 *             properties:
 *               buildingId: { type: string }
 *               code: { type: string, example: 'TM-A01' }
 *               name: { type: string, example: 'Thang máy số 1' }
 *               category: { type: string, enum: [ELEVATOR, PUMP, FIRE_SYSTEM, OTHER] }
 *               location: { type: string }
 *               manufacturer: { type: string }
 *               installDate: { type: string, format: date }
 *               warrantyEnd: { type: string, format: date }
 *               vendorName: { type: string }
 *               vendorPhone: { type: string }
 *               cycleValue: { type: integer, example: 1 }
 *               cycleUnit: { type: string, enum: [DAY, MONTH, QUARTER] }
 *               checklist: { type: array, items: { type: object, properties: { label: { type: string }, unit: { type: string }, minValue: { type: number }, maxValue: { type: number }, required: { type: boolean } } } }
 *               lastMaintenanceDate: { type: string, format: date }
 *               note: { type: string }
 */
router.get(
  '/',
  authenticate,
  authorize(...VIEWERS),
  validate({ query: listQuery }),
  async (req, res) => {
    const { items, pagination } = await service.listAssets(req.validated.query);
    paginated(res, items, pagination);
  },
);

router.post(
  '/',
  authenticate,
  authorize('MANAGER'),
  validate({ body: createBody }),
  async (req, res) =>
    created(res, await service.createAsset(req.user, req.body, { ip: req.ip }), 'Đã lưu thiết bị. Bạn có thể in mã QR.'), // MSG-E02
);

/**
 * @openapi
 * /assets/{id}:
 *   get:
 *     tags: [Thiết bị & bảo trì]
 *     summary: Chi tiết thiết bị + work order đang mở + số lần đã bảo trì (UC-D01 bước 6)
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *   put:
 *     tags: [Thiết bị & bảo trì]
 *     summary: Sửa thiết bị; đổi chu kỳ/ngày gần nhất → tính lại ngày bảo trì kế tiếp
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             minProperties: 1
 *             properties:
 *               buildingId: { type: string }
 *               name: { type: string }
 *               category: { type: string, enum: [ELEVATOR, PUMP, FIRE_SYSTEM, OTHER] }
 *               location: { type: string }
 *               code: { type: string }
 *               cycleValue: { type: integer }
 *               cycleUnit: { type: string, enum: [DAY, MONTH, QUARTER] }
 *               checklist: { type: array, items: { type: object }, description: 'Đổi mẫu không ảnh hưởng phiếu đã tạo' }
 *               manufacturer: { type: string }
 *               installDate: { type: string, format: date }
 *               warrantyEnd: { type: string, format: date }
 *               vendorName: { type: string }
 *               vendorPhone: { type: string }
 *               lastMaintenanceDate: { type: string, format: date, nullable: true }
 *               note: { type: string }
 */
router.get(
  '/:id',
  authenticate,
  authorize(...VIEWERS),
  validate({ params: idParams }),
  async (req, res) => ok(res, await service.getAsset(req.params.id)),
);

router.put(
  '/:id',
  authenticate,
  authorize('MANAGER'),
  validate({ params: idParams, body: updateBody }),
  async (req, res) =>
    ok(res, await service.updateAsset(req.params.id, req.body, { user: req.user, ip: req.ip }), 'Đã cập nhật thiết bị'),
);

/**
 * @openapi
 * /assets/{id}/status:
 *   patch:
 *     tags: [Thiết bị & bảo trì]
 *     summary: Ngừng theo dõi / kích hoạt lại thiết bị (BR-O19)
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
      await service.setAssetStatus(req.params.id, req.body.isActive, { user: req.user, ip: req.ip }),
      req.body.isActive ? 'Đã kích hoạt lại thiết bị' : 'Đã ngừng theo dõi thiết bị',
    ),
);

/**
 * @openapi
 * /assets/{id}/history:
 *   get:
 *     tags: [Thiết bị & bảo trì]
 *     summary: Lịch sử bảo trì — work order DONE, mới nhất trước, có cờ đúng hạn/trễ hạn
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 */
router.get(
  '/:id/history',
  authenticate,
  authorize(...VIEWERS),
  validate({ params: idParams, query: Joi.object(paginationQuery) }),
  async (req, res) => {
    const { items, pagination } = await service.getAssetHistory(req.params.id, req.validated.query);
    paginated(res, items, pagination);
  },
);

export default router;

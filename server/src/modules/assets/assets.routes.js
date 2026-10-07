import { Router } from 'express';
import Joi from 'joi';
import { ASSET_CATEGORIES, values } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { paginationQuery, sortable } from '../../utils/pagination.js';
import { created, ok, paginated } from '../../utils/response.js';
import { csvEnum, idParams, objectId } from '../../utils/validators.js';
import * as service from './assets.service.js';

// Module D — Thanh Bình. UC-D01: Quản lý tài sản chung, chu kỳ & lịch sử bảo trì.
const router = Router();
const VIEWERS = ['MANAGER', 'STAFF:TECHNICIAN'];

const listQuery = Joi.object({
  ...paginationQuery,
  sort: sortable('createdAt', 'name', 'nextMaintenanceDate', 'lastMaintenanceDate'),
  buildingId: objectId(),
  category: csvEnum(values(ASSET_CATEGORIES)),
  isActive: Joi.boolean(),
  dueWithinDays: Joi.number().integer().min(0).max(365),
  q: Joi.string().trim().max(100),
});

const fields = {
  buildingId: objectId(),
  name: Joi.string().trim().min(2).max(150),
  category: Joi.string().valid(...values(ASSET_CATEGORIES)),
  location: Joi.string().trim().max(200).allow(''),
  maintenanceCycleDays: Joi.number().integer().min(1).max(3650),
  lastMaintenanceDate: Joi.date().allow(null),
  note: Joi.string().trim().max(1000).allow(''),
};

const createBody = Joi.object({
  ...fields,
  buildingId: fields.buildingId.required(),
  name: fields.name.required(),
  category: fields.category.required(),
  maintenanceCycleDays: fields.maintenanceCycleDays.required(),
});
const updateBody = Joi.object(fields).min(1);

/**
 * @openapi
 * /assets:
 *   get:
 *     tags: [Tài sản & bảo trì]
 *     summary: Danh sách tài sản (lọc tòa/loại/trạng thái, sắp đến hạn) — UC-D01
 *     parameters:
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *       - { in: query, name: buildingId, schema: { type: string } }
 *       - { in: query, name: category, schema: { type: string }, description: 'ELEVATOR,PUMP,...' }
 *       - { in: query, name: isActive, schema: { type: boolean } }
 *       - { in: query, name: dueWithinDays, schema: { type: integer }, description: 'Đến hạn trong N ngày tới (0 = đến hạn/quá hạn)' }
 *       - { in: query, name: q, schema: { type: string } }
 *   post:
 *     tags: [Tài sản & bảo trì]
 *     summary: Thêm tài sản, tự tính nextMaintenanceDate (BR-O18) — UC-D01
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [buildingId, name, category, maintenanceCycleDays]
 *             properties:
 *               buildingId: { type: string }
 *               name: { type: string, example: 'Thang máy số 1' }
 *               category: { type: string, enum: [ELEVATOR, PUMP, FIRE_SYSTEM, OTHER] }
 *               location: { type: string }
 *               maintenanceCycleDays: { type: integer, example: 30 }
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
  async (req, res) => created(res, await service.createAsset(req.user, req.body), 'Đã thêm tài sản'),
);

/**
 * @openapi
 * /assets/{id}:
 *   get:
 *     tags: [Tài sản & bảo trì]
 *     summary: Chi tiết tài sản + work order đang mở + số lần đã bảo trì (UC-D01 bước 6)
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *   put:
 *     tags: [Tài sản & bảo trì]
 *     summary: Sửa tài sản; đổi chu kỳ/ngày gần nhất → tính lại ngày bảo trì kế tiếp
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
 *               maintenanceCycleDays: { type: integer }
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
  async (req, res) => ok(res, await service.updateAsset(req.params.id, req.body), 'Đã cập nhật tài sản'),
);

/**
 * @openapi
 * /assets/{id}/status:
 *   patch:
 *     tags: [Tài sản & bảo trì]
 *     summary: Ngừng theo dõi / kích hoạt lại tài sản (BR-O19)
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
      await service.setAssetStatus(req.params.id, req.body.isActive),
      req.body.isActive ? 'Đã kích hoạt lại tài sản' : 'Đã ngừng theo dõi tài sản',
    ),
);

/**
 * @openapi
 * /assets/{id}/history:
 *   get:
 *     tags: [Tài sản & bảo trì]
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

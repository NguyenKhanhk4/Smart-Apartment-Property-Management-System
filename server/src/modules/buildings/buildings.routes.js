import { Router } from 'express';
import Joi from 'joi';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { created, ok } from '../../utils/response.js';
import { idParams, objectId } from '../../utils/validators.js';
import * as service from './buildings.service.js';
import * as inventory from './inventory.service.js';
import { sourceReference, changeReason, floorInventory, inventoryRows, inventoryBody } from './inventory.rules.js';

// Module A — UC13: Quản lý tòa nhà, block và sơ đồ tầng
const router = Router();
const VIEWERS = ['MANAGER', 'STAFF:RECEPTIONIST'];

const buildingFields = {
  code: Joi.string().trim().uppercase().pattern(/^[A-Z0-9_-]+$/).max(20),
  name: Joi.string().trim().min(1).max(100),
  address: Joi.string().trim().max(200).allow(''),
  totalFloors: Joi.number().integer().min(1).max(200),
};

const createBuildingBody = Joi.object({
  code: buildingFields.code.required(),
  name: buildingFields.name.required(),
  address: Joi.string().trim().min(1).max(200).required(),
  totalFloors: buildingFields.totalFloors.required(),
  sourceReference: sourceReference.required(),
  floors: floorInventory,
  apartments: inventoryRows,
});

const updateBuildingBody = Joi.object({ ...buildingFields,
  reason: changeReason.required(), sourceReference: sourceReference.required(),
}).min(3);

/**
 * @openapi
 * /buildings:
 *   get:
 *     tags: [Tòa nhà & Căn hộ]
 *     summary: Danh sách tòa nhà kèm số lượng căn hộ mỗi tòa — UC-A05
 *     responses:
 *       200:
 *         description: Danh sách tòa nhà
 */
router.get('/', authenticate, authorize(...VIEWERS), async (_req, res) => {
  const buildings = await service.listBuildings();
  ok(res, buildings);
});

/**
 * @openapi
 * /buildings/{id}:
 *   get:
 *     tags: [Tòa nhà & Căn hộ]
 *     summary: Chi tiết một tòa nhà — UC-A05
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 */
router.get('/:id', authenticate, authorize(...VIEWERS), validate({ params: idParams }), async (req, res) => {
  const building = await service.getBuildingById(req.validated.params.id);
  ok(res, building);
});

/**
 * @openapi
 * /buildings:
 *   post:
 *     tags: [Tòa nhà & Căn hộ]
 *     summary: Tạo mới tòa nhà (Trưởng BQL) — UC-A05
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, name, totalFloors]
 *             properties:
 *               code: { type: string, example: "A" }
 *               name: { type: string, example: "Tòa A - Diamond" }
 *               address: { type: string, example: "123 Đường Nguyễn Trãi" }
 *               totalFloors: { type: integer, example: 25 }
 */
router.post(
  '/',
  authenticate,
  authorize('MANAGER'),
  validate({ body: createBuildingBody }),
  async (req, res) => {
    const building = await service.createBuilding(req.validated.body, req.user, req.ip);
    created(res, building);
  },
);

/**
 * @openapi
 * /buildings/{id}:
 *   put:
 *     tags: [Tòa nhà & Căn hộ]
 *     summary: Cập nhật thông tin tòa nhà (Trưởng BQL) — UC-A05
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 */
router.put(
  '/:id',
  authenticate,
  authorize('MANAGER'),
  validate({ params: idParams, body: updateBuildingBody }),
  async (req, res) => {
    const building = await service.updateBuilding(
      req.validated.params.id,
      req.validated.body,
      req.user,
      req.ip,
    );
    ok(res, building);
  },
);

/**
 * @openapi
 * /buildings/{id}:
 *   delete:
 *     tags: [Tòa nhà & Căn hộ]
 *     summary: Xóa tòa nhà chưa có căn hộ (Trưởng BQL) — UC-A05
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 */
router.delete(
  '/:id',
  authenticate,
  authorize('MANAGER'),
  validate({ params: idParams }),
  async (req, res) => {
    const result = await service.deleteBuilding(req.validated.params.id, req.user, req.ip);
    ok(res, result);
  },
);

const blockBody = Joi.object({
  code: Joi.string().trim().uppercase().pattern(/^[A-Z0-9_-]+$/).max(20).required(),
  name: Joi.string().trim().max(100).required(),
});

router.get(
  '/:id/floor-plan',
  authenticate,
  authorize(...VIEWERS),
  validate({
    params: idParams,
    query: Joi.object({ floor: Joi.number().integer().min(1).required(), blockId: objectId() }),
  }),
  async (req, res) => {
    ok(res, await service.getFloorPlan(req.validated.params.id, req.validated.query));
  },
);

router.post(
  '/:id/blocks',
  authenticate,
  authorize('MANAGER'),
  validate({ params: idParams, body: blockBody }),
  async (req, res) => {
    created(res, await service.saveBlock(req.validated.params.id, null, req.validated.body, req.user, req.ip));
  },
);

router.put(
  '/:id/blocks/:blockId',
  authenticate,
  authorize('MANAGER'),
  validate({ params: Joi.object({ id: objectId().required(), blockId: objectId().required() }), body: blockBody }),
  async (req, res) => {
    const { id, blockId } = req.validated.params;
    ok(res, await service.saveBlock(id, blockId, req.validated.body, req.user, req.ip));
  },
);

router.get('/:id/inventory', authenticate, authorize(...VIEWERS), validate({ params: idParams }), async (req, res) => {
  ok(res, await inventory.getInventory(req.validated.params.id));
});
router.post('/:id/inventory/confirm', authenticate, authorize('MANAGER'),
  validate({ params: idParams, body: inventoryBody }), async (req, res) => {
    ok(res, await inventory.confirmInventory(req.validated.params.id, req.validated.body, req.user, req.ip));
  });
router.get('/:id/inventory/history', authenticate, authorize('MANAGER'), validate({ params: idParams }), async (req, res) => {
  ok(res, await inventory.inventoryHistory(req.validated.params.id));
});

export default router;

import { Router } from 'express';
import Joi from 'joi';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { created, ok } from '../../utils/response.js';
import { idParams } from '../../utils/validators.js';
import * as service from './buildings.service.js';

// Module A — Vũ Việt. UC-A05: Quản lý tòa nhà (Block)
const router = Router();
const VIEWERS = ['ADMIN', 'MANAGER', 'STAFF:RECEPTIONIST'];

const buildingFields = {
  code: Joi.string().trim().uppercase().max(20),
  name: Joi.string().trim().min(1).max(100),
  address: Joi.string().trim().max(200).allow(''),
  totalFloors: Joi.number().integer().min(1).max(200),
};

const createBuildingBody = Joi.object({
  code: buildingFields.code.required(),
  name: buildingFields.name.required(),
  address: buildingFields.address,
  totalFloors: buildingFields.totalFloors.required(),
});

const updateBuildingBody = Joi.object(buildingFields).min(1);

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
 *     summary: Tạo mới tòa nhà (Admin) — UC-A05
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
  authorize('ADMIN'),
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
 *     summary: Cập nhật thông tin tòa nhà (Admin) — UC-A05
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 */
router.put(
  '/:id',
  authenticate,
  authorize('ADMIN'),
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
 *     summary: Xóa tòa nhà chưa có căn hộ (Admin) — UC-A05
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 */
router.delete(
  '/:id',
  authenticate,
  authorize('ADMIN'),
  validate({ params: idParams }),
  async (req, res) => {
    const result = await service.deleteBuilding(req.validated.params.id, req.user, req.ip);
    ok(res, result);
  },
);

export default router;

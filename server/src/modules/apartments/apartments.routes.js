import { Router } from 'express';
import Joi from 'joi';
import { APARTMENT_STATUS, values } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { paginationQuery, sortable } from '../../utils/pagination.js';
import { created, ok, paginated } from '../../utils/response.js';
import { idParams, objectId } from '../../utils/validators.js';
import * as service from './apartments.service.js';

// Module A — Vũ Việt. UC-A05: Quản lý căn hộ
const router = Router();
const VIEWERS = ['ADMIN', 'MANAGER', 'STAFF:RECEPTIONIST'];

const listQuery = Joi.object({
  ...paginationQuery,
  sort: sortable('code', 'floor', 'area', 'createdAt'),
  buildingId: objectId(),
  floor: Joi.number().integer().min(1),
  status: Joi.string().valid(...values(APARTMENT_STATUS)),
  q: Joi.string().trim().max(50),
});

const apartmentFields = {
  buildingId: objectId(),
  code: Joi.string().trim().uppercase().max(20),
  floor: Joi.number().integer().min(1),
  area: Joi.number().positive(),
  status: Joi.string(), // Sẽ bị chặn trong service/validator nếu gửi lên PUT
};

const createApartmentBody = Joi.object({
  buildingId: apartmentFields.buildingId.required(),
  code: apartmentFields.code.required(),
  floor: apartmentFields.floor.required(),
  area: apartmentFields.area.required(),
});

const updateApartmentBody = Joi.object({
  code: apartmentFields.code,
  floor: apartmentFields.floor,
  area: apartmentFields.area,
  status: apartmentFields.status,
}).min(1);

/**
 * @openapi
 * /apartments:
 *   get:
 *     tags: [Tòa nhà & Căn hộ]
 *     summary: Danh sách căn hộ (phân trang, lọc theo tòa/tầng/trạng thái/mã) — UC-A05
 *     parameters:
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *       - { in: query, name: buildingId, schema: { type: string } }
 *       - { in: query, name: floor, schema: { type: integer } }
 *       - { in: query, name: status, schema: { type: string, enum: [VACANT, OWNED, RENTED] } }
 *       - { in: query, name: q, schema: { type: string }, description: 'Tìm theo mã căn' }
 */
router.get('/', authenticate, authorize(...VIEWERS), validate({ query: listQuery }), async (req, res) => {
  const { items, pagination } = await service.listApartments(req.validated.query);
  paginated(res, items, pagination);
});

/**
 * @openapi
 * /apartments/{id}:
 *   get:
 *     tags: [Tòa nhà & Căn hộ]
 *     summary: Chi tiết căn hộ kèm hợp đồng ACTIVE, số cư dân và số xe APPROVED — UC-A05
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 */
router.get('/:id', authenticate, authorize(...VIEWERS), validate({ params: idParams }), async (req, res) => {
  const apartment = await service.getApartmentById(req.validated.params.id);
  ok(res, apartment);
});

/**
 * @openapi
 * /apartments:
 *   post:
 *     tags: [Tòa nhà & Căn hộ]
 *     summary: Tạo mới căn hộ với trạng thái VACANT (Admin) — UC-A05
 */
router.post(
  '/',
  authenticate,
  authorize('ADMIN'),
  validate({ body: createApartmentBody }),
  async (req, res) => {
    const apartment = await service.createApartment(req.validated.body, req.user, req.ip);
    created(res, apartment);
  },
);

/**
 * @openapi
 * /apartments/{id}:
 *   put:
 *     tags: [Tòa nhà & Căn hộ]
 *     summary: Cập nhật thông tin căn hộ (Admin, không cho sửa status) — UC-A05
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 */
router.put(
  '/:id',
  authenticate,
  authorize('ADMIN'),
  validate({ params: idParams, body: updateApartmentBody }),
  async (req, res) => {
    const apartment = await service.updateApartment(
      req.validated.params.id,
      req.validated.body,
      req.user,
      req.ip,
    );
    ok(res, apartment);
  },
);

/**
 * @openapi
 * /apartments/{id}:
 *   delete:
 *     tags: [Tòa nhà & Căn hộ]
 *     summary: Xóa căn hộ chưa có hợp đồng/cư dân/xe (Admin) — UC-A05
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 */
router.delete(
  '/:id',
  authenticate,
  authorize('ADMIN'),
  validate({ params: idParams }),
  async (req, res) => {
    const result = await service.deleteApartment(req.validated.params.id, req.user, req.ip);
    ok(res, result);
  },
);

export default router;

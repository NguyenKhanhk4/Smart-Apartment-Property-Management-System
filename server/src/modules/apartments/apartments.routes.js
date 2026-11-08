import { Router } from 'express';
import Joi from 'joi';
import { APARTMENT_OCCUPANCY, APARTMENT_STATUS, APARTMENT_TYPES, values } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { paginationQuery, sortable } from '../../utils/pagination.js';
import { created, ok, paginated } from '../../utils/response.js';
import { idParams, objectId, phoneVn, ymd } from '../../utils/validators.js';
import * as service from './apartments.service.js';
import { listApartmentResidents } from '../residents/residents.service.js';
import { issueOwnerAccount } from '../contracts/contracts.service.js';

// Module A — Vũ Việt. UC-A05, UC-A07: Quản lý căn hộ & Cư dân
const router = Router();
const VIEWERS = ['MANAGER', 'STAFF:RECEPTIONIST'];

const listQuery = Joi.object({
  ...paginationQuery,
  sort: sortable('code', 'floor', 'area', 'createdAt'),
  buildingId: objectId(),
  floor: Joi.number().integer().min(1),
  status: Joi.string().valid(...values(APARTMENT_STATUS)),
  occupancyStatus: Joi.string().valid(...values(APARTMENT_OCCUPANCY)),
  q: Joi.string().trim().max(50),
});

const apartmentFields = {
  buildingId: objectId(),
  code: Joi.string().trim().uppercase().max(20),
  floor: Joi.number().integer().min(1),
  area: Joi.number().min(1),
  status: Joi.string(), // Sẽ bị chặn trong service/validator nếu gửi lên PUT
};

const propertyFields = {
  blockId: objectId().allow(null),
  type: Joi.string().valid(...values(APARTMENT_TYPES)),
  grossArea: Joi.number().positive(),
  netArea: Joi.number().min(1),
  technicalShaft: Joi.string().trim().max(200).allow(''),
  handoverDate: ymd().allow(null),
};

const createApartmentBody = Joi.object({
  ...propertyFields,
  buildingId: apartmentFields.buildingId.required(),
  code: apartmentFields.code.required(),
  floor: apartmentFields.floor.required(),
  area: apartmentFields.area.when('netArea', {
    is: Joi.exist(),
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),
});

const updateApartmentBody = Joi.object({
  ...propertyFields,
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
 * /apartments/{id}/residents:
 *   get:
 *     tags: [Tòa nhà & Căn hộ, Cư dân]
 *     summary: Danh sách hồ sơ trong căn hộ — UC-A07, UC-A08
 *     description: occupancyRole đánh dấu chủ hộ và thành viên đang ở theo UC21.
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 */
router.get(
  '/:id/residents',
  authenticate,
  authorize('STAFF:RECEPTIONIST', 'MANAGER', 'RESIDENT'),
  validate({ params: idParams }),
  async (req, res) => {
    const residents = await listApartmentResidents(req.validated.params.id, req.user);
    ok(res, residents);
  },
);

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
 *     summary: Tạo căn hộ và ghi nhận ngày bàn giao (Trưởng BQL) — UC13
 */
router.post(
  '/',
  authenticate,
  authorize('MANAGER'),
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
 *     summary: Cập nhật thông tin căn hộ (Trưởng BQL, không cho sửa status) — UC-A05
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 */
router.put(
  '/:id',
  authenticate,
  authorize('MANAGER'),
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

/** UC22 — Trưởng Ban quản lý cấp quyền theo hồ sơ mua bán của căn. */
router.post(
  '/:id/owner-account',
  authenticate,
  authorize('MANAGER'),
  validate({
    params: idParams,
    body: Joi.object({
      contractId: objectId().required(),
      phone: phoneVn().required(),
      email: Joi.string().trim().email().max(254).allow('', null),
      identityVerified: Joi.boolean().valid(true).required(),
    }),
  }),
  async (req, res) => {
    const { params, body } = req.validated;
    created(res, await issueOwnerAccount(params.id, body, req.user, req.ip));
  },
);

router.patch(
  '/:id/confirm-move-in',
  authenticate,
  authorize('STAFF:RECEPTIONIST'),
  validate({ params: idParams }),
  async (req, res) => {
    ok(res, await service.confirmMoveIn(req.validated.params.id, req.user, req.ip));
  },
);

router.patch(
  '/:id/occupancy-status',
  authenticate,
  authorize('MANAGER'),
  validate({
    params: idParams,
    body: Joi.object({
      status: Joi.string().valid(
        APARTMENT_OCCUPANCY.VACANT,
        APARTMENT_OCCUPANCY.OWNER_OCCUPIED,
        APARTMENT_OCCUPANCY.RENTED,
        APARTMENT_OCCUPANCY.UNDER_REPAIR,
      ).required(),
      reason: Joi.string().trim().max(500).required(),
    }),
  }),
  async (req, res) => {
    const { params, body } = req.validated;
    ok(res, await service.setOccupancyStatus(params.id, body, req.user, req.ip));
  },
);

/**
 * @openapi
 * /apartments/{id}:
 *   delete:
 *     tags: [Tòa nhà & Căn hộ]
 *     summary: Xóa căn hộ chưa có hợp đồng/cư dân/xe (Trưởng BQL) — UC-A05
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 */
router.delete(
  '/:id',
  authenticate,
  authorize('MANAGER'),
  validate({ params: idParams }),
  async (req, res) => {
    const result = await service.deleteApartment(req.validated.params.id, req.user, req.ip);
    ok(res, result);
  },
);

export default router;

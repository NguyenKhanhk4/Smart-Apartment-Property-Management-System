import { Router } from 'express';
import Joi from 'joi';
import {
  CONTRACT_STATUS,
  CONTRACT_TYPES,
  values,
} from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { uploadImages } from '../../services/upload.service.js';
import { paginationQuery, sortable } from '../../utils/pagination.js';
import { created, ok, paginated } from '../../utils/response.js';
import { ApiError } from '../../utils/ApiError.js';
import { idParams, objectId } from '../../utils/validators.js';
import * as service from './contracts.service.js';

// Module A — Vũ Việt. UC-A06: Quản lý hợp đồng (Contracts)
const router = Router();
const VIEWERS = ['STAFF:RECEPTIONIST', 'MANAGER'];

const listQuery = Joi.object({
  ...paginationQuery,
  sort: sortable('startDate', 'endDate', 'createdAt'),
  buildingId: objectId(),
  apartmentId: objectId(),
  type: Joi.string().valid(...values(CONTRACT_TYPES)),
  status: Joi.string().valid(...values(CONTRACT_STATUS)),
  endingWithinDays: Joi.number().integer().min(0).max(365),
});

const personSchema = Joi.object({
  userId: objectId(),
  fullName: Joi.string().trim().min(2).max(100),
  email: Joi.string().trim().email(),
  phone: Joi.string().trim().allow('', null),
  idNumber: Joi.string().trim().allow('', null),
  dateOfBirth: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow('', null),
});

const createContractBody = Joi.object({
  apartmentId: objectId().required(),
  type: Joi.string().valid(...values(CONTRACT_TYPES)).required(),
  startDate: Joi.date().required(),
  endDate: Joi.date().allow(null, ''),
  tenantPaysFees: Joi.boolean().default(false),
  owner: personSchema.when('type', {
    is: CONTRACT_TYPES.SALE,
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  tenant: personSchema.when('type', {
    is: CONTRACT_TYPES.LEASE,
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
});

const updateContractBody = Joi.object({
  endDate: Joi.date().allow(null, ''),
  tenantPaysFees: Joi.boolean(),
});

// Middleware tiền xử lý nếu dữ liệu gửi dưới dạng multipart/form-data
const parseMultipartContract = (req, _res, next) => {
  if (req.body) {
    if (typeof req.body.owner === 'string') {
      try {
        req.body.owner = JSON.parse(req.body.owner);
      } catch {
        // Giữ nguyên chuỗi
      }
    }
    if (typeof req.body.tenant === 'string') {
      try {
        req.body.tenant = JSON.parse(req.body.tenant);
      } catch {
        // Giữ nguyên chuỗi
      }
    }
    if (typeof req.body.tenantPaysFees === 'string') {
      req.body.tenantPaysFees = req.body.tenantPaysFees === 'true';
    }
  }
  next();
};

/**
 * @openapi
 * /contracts:
 *   get:
 *     tags: [Hợp đồng]
 *     summary: Danh sách hợp đồng (phân trang, lọc theo tòa/căn/loại/trạng thái/hạn) — UC-A06
 */
router.get('/', authenticate, authorize(...VIEWERS), validate({ query: listQuery }), async (req, res) => {
  const { items, pagination } = await service.listContracts(req.validated.query);
  paginated(res, items, pagination);
});

/**
 * @openapi
 * /contracts/{id}:
 *   get:
 *     tags: [Hợp đồng]
 *     summary: Chi tiết một hợp đồng — UC-A06
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 */
router.get('/:id', authenticate, authorize(...VIEWERS), validate({ params: idParams }), async (req, res) => {
  const contract = await service.getContractById(req.validated.params.id);
  ok(res, contract);
});

/**
 * @openapi
 * /contracts:
 *   post:
 *     tags: [Hợp đồng]
 *     summary: Lễ tân tạo mới hợp đồng mua bán hoặc cho thuê — UC-A06
 */
router.post(
  '/',
  authenticate,
  authorize('STAFF:RECEPTIONIST'),
  uploadImages('file', 1),
  parseMultipartContract,
  validate({ body: createContractBody }),
  async (req, res) => {
    const result = await service.createContract(
      req.user,
      req.validated.body,
      req.files?.[0],
      req.ip,
    );
    created(res, result);
  },
);

/**
 * @openapi
 * /contracts/{id}:
 *   patch:
 *     tags: [Hợp đồng]
 *     summary: Gia hạn hợp đồng hoặc cập nhật người chịu phí — UC-A06
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 */
router.patch(
  '/:id',
  authenticate,
  authorize('STAFF:RECEPTIONIST'),
  uploadImages('file', 1),
  parseMultipartContract,
  validate({ params: idParams, body: updateContractBody }),
  async (req, res) => {
    if (!req.files?.[0] && Object.keys(req.validated.body).length === 0) {
      throw ApiError.badRequest('Cần cung cấp ít nhất một thông tin cần cập nhật');
    }
    const contract = await service.updateContract(
      req.validated.params.id,
      req.validated.body,
      req.files?.[0],
      req.user,
      req.ip,
    );
    ok(res, contract);
  },
);

/**
 * @openapi
 * /contracts/{id}/terminate:
 *   patch:
 *     tags: [Hợp đồng]
 *     summary: Chấm dứt sớm hợp đồng (Lễ tân) — UC-A06
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 */
router.patch(
  '/:id/terminate',
  authenticate,
  authorize('STAFF:RECEPTIONIST'),
  validate({ params: idParams }),
  async (req, res) => {
    const result = await service.terminateContract(req.validated.params.id, req.user, req.ip);
    ok(res, result);
  },
);

export default router;

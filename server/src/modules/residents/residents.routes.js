import { Router } from 'express';
import Joi from 'joi';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { created, ok } from '../../utils/response.js';
import { idParams, objectId } from '../../utils/validators.js';
import * as occupantReportsService from '../occupantReports/occupantReports.service.js';
import * as service from './residents.service.js';

// Module A — Vũ Việt. UC-A07, UC-A08: Quản lý cư dân & Căn hộ của tôi
const router = Router();

const addMemberBody = Joi.object({
  apartmentId: objectId().required(),
  email: Joi.string().trim().lowercase().email().required(),
  fullName: Joi.string().trim().min(2).max(100).required(),
  phone: Joi.string().trim().allow('', null),
  idNumber: Joi.string().trim().allow('', null),
  dateOfBirth: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow('', null),
});

const updateMemberBody = Joi.object({
  idNumber: Joi.string().trim().allow('', null),
  dateOfBirth: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow('', null),
}).min(1);

const changesQuerySchema = Joi.object({
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().optional(),
  format: Joi.string().valid('json', 'xlsx').optional(),
});

/**
 * GET /residents/changes — UC21: Xem trước hoặc xuất Excel biến động nhân khẩu
 */
router.get(
  '/changes',
  authenticate,
  authorize('STAFF:RECEPTIONIST', 'MANAGER'),
  validate({ query: changesQuerySchema }),
  async (req, res) => {
    if (req.validated.query.format === 'xlsx') {
      const { buffer, filename } = await occupantReportsService.exportResidentChangesExcel(
        req.validated.query,
        req.user,
        req.ip,
      );
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(Buffer.from(buffer));
    }
    const list = await occupantReportsService.listResidentChanges(req.validated.query);
    return ok(res, list);
  },
);

/**
 * GET /residents/changes/export — UC21: Xuất Excel biến động nhân khẩu
 */
router.get(
  '/changes/export',
  authenticate,
  authorize('STAFF:RECEPTIONIST', 'MANAGER'),
  validate({ query: changesQuerySchema }),
  async (req, res) => {
    const { buffer, filename } = await occupantReportsService.exportResidentChangesExcel(
      req.validated.query,
      req.user,
      req.ip,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(Buffer.from(buffer));
  },
);

/**
 * @openapi
 * /residents/me/apartments:
 *   get:
 *     tags: [Cư dân]
 *     summary: Danh sách căn hộ tôi đang ở (Cư dân) — UC-A08
 */
router.get(
  '/me/apartments',
  authenticate,
  authorize('RESIDENT'),
  async (req, res) => {
    const list = await service.myApartments(req.user.id || req.user._id);
    ok(res, list);
  },
);

/**
 * @openapi
 * /residents:
 *   post:
 *     tags: [Cư dân]
 *     summary: Thêm thành viên vào hộ gia đình (Lễ tân) — UC-A07
 */
router.post(
  '/',
  authenticate,
  authorize('STAFF:RECEPTIONIST'),
  validate({ body: addMemberBody }),
  async (req, res) => {
    const result = await service.addMember(req.user, req.validated.body, req.ip);
    created(res, result);
  },
);

/**
 * @openapi
 * /residents/{id}:
 *   patch:
 *     tags: [Cư dân]
 *     summary: Sửa thông tin thành viên (CCCD, ngày sinh) (Lễ tân) — UC-A07
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 */
router.patch(
  '/:id',
  authenticate,
  authorize('STAFF:RECEPTIONIST'),
  validate({ params: idParams, body: updateMemberBody }),
  async (req, res) => {
    const resident = await service.updateMember(
      req.validated.params.id,
      req.validated.body,
      req.user,
      req.ip,
    );
    ok(res, resident);
  },
);

/**
 * @openapi
 * /residents/{id}/remove:
 *   patch:
 *     tags: [Cư dân]
 *     summary: Gỡ thành viên hộ gia đình khỏi căn hộ (Lễ tân) — UC-A07
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 */
router.patch(
  '/:id/remove',
  authenticate,
  authorize('STAFF:RECEPTIONIST'),
  validate({ params: idParams }),
  async (req, res) => {
    const result = await service.removeMember(
      req.validated.params.id,
      req.user,
      req.ip,
    );
    ok(res, result);
  },
);

/**
 * GET /residents/:id/id-number — Xem đầy đủ CCCD (chỉ STAFF:RECEPTIONIST và MANAGER, ghi audit)
 */
router.get(
  '/:id/id-number',
  authenticate,
  authorize('STAFF:RECEPTIONIST', 'MANAGER'),
  validate({ params: idParams }),
  async (req, res) => {
    const result = await service.revealResidentIdNumber(
      req.validated.params.id,
      req.user,
      req.ip,
    );
    return ok(res, result);
  },
);

export default router;

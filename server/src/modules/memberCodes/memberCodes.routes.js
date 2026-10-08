import { Router } from 'express';
import Joi from 'joi';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { ok } from '../../utils/response.js';
import { objectId } from '../../utils/validators.js';
import * as service from './memberCodes.service.js';

// Module D — Thanh Bình. UC-D11: Thẻ cư dân (mã chữ theo căn hộ), quyền tiện ích của thành viên, tra mã tại quầy.
// Thứ tự khai báo: đường dẫn cố định (/mine, /household, /lookup) đứng trước đường dẫn có :userId.
const router = Router();
const STAFF_LOOKUP = ['MANAGER', 'STAFF:RECEPTIONIST', 'STAFF:SECURITY'];

const apartmentQuery = Joi.object({ apartmentId: objectId() });
const userParams = Joi.object({ userId: objectId().required() });
// 'YYYY-MM-DD' hoặc null (xóa). Ngày không có thật / ở tương lai bị service từ chối (400, details theo field)
const dateOfBirth = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .allow(null, '')
  .messages({ 'string.pattern.base': 'Ngày sinh phải có dạng YYYY-MM-DD' });

/**
 * @openapi
 * /member-codes/mine:
 *   get:
 *     tags: [Thẻ cư dân]
 *     summary: Mã của tôi trong từng căn có quyền (UC-D11). Chủ sở hữu căn đang cho thuê (không ở) không có mã
 */
router.get('/mine', authenticate, authorize('RESIDENT'), async (req, res) => {
  ok(res, await service.getMyCodes(req.user.id));
});

/**
 * @openapi
 * /member-codes/household:
 *   get:
 *     tags: [Thẻ cư dân]
 *     summary: Chủ hộ xem thành viên của hộ kèm mã, ngày sinh, nhóm tuổi, quyền phát sinh phí (BR-O26)
 *     parameters: [{ in: query, name: apartmentId, schema: { type: string } }]
 */
router.get('/household', authenticate, authorize('RESIDENT'), validate({ query: apartmentQuery }), async (req, res) => {
  ok(res, await service.getHouseholdView(req.user.id, req.validated.query.apartmentId));
});

/**
 * @openapi
 * /member-codes/household/{userId}:
 *   patch:
 *     tags: [Thẻ cư dân]
 *     summary: Chủ hộ bật/tắt "được phát sinh phí tiện ích" và sửa ngày sinh của thành viên
 *     parameters:
 *       - { in: path, name: userId, required: true, schema: { type: string } }
 *       - { in: query, name: apartmentId, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               canIncurCharges: { type: boolean }
 *               dateOfBirth: { type: string, example: '2020-05-12', nullable: true, description: 'Không được ở tương lai; null = xóa' }
 */
router.patch(
  '/household/:userId',
  authenticate,
  authorize('RESIDENT'),
  validate({
    params: userParams,
    query: apartmentQuery,
    body: Joi.object({ canIncurCharges: Joi.boolean(), dateOfBirth }).or('canIncurCharges', 'dateOfBirth'),
  }),
  async (req, res) =>
    ok(res, await service.updateMember(req.user.id, req.validated.query.apartmentId, req.params.userId, req.body), 'Đã cập nhật thành viên'),
);

/**
 * @openapi
 * /member-codes/lookup:
 *   get:
 *     tags: [Thẻ cư dân]
 *     summary: Tra mã chữ tại quầy; luôn trả ảnh đại diện để nhân viên đối chiếu với người đến
 *     parameters: [{ in: query, name: q, required: true, schema: { type: string }, description: 'Vd A-0501-01' }]
 */
router.get(
  '/lookup',
  authenticate,
  authorize(...STAFF_LOOKUP),
  validate({ query: Joi.object({ q: Joi.string().trim().min(1).max(300).required() }) }),
  async (req, res) => ok(res, await service.lookup(req.validated.query.q)),
);

/**
 * @openapi
 * /member-codes/{userId}/date-of-birth:
 *   patch:
 *     tags: [Thẻ cư dân]
 *     summary: Lễ tân sửa ngày sinh khi đối chiếu giấy tờ tại quầy (áp cho mọi mã đang hiệu lực của người đó)
 *     parameters: [{ in: path, name: userId, required: true, schema: { type: string } }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, required: [dateOfBirth], properties: { dateOfBirth: { type: string, example: '2020-05-12' } } }
 */
router.patch(
  '/:userId/date-of-birth',
  authenticate,
  authorize('STAFF:RECEPTIONIST'),
  validate({ params: userParams, body: Joi.object({ dateOfBirth: dateOfBirth.required() }) }),
  async (req, res) => ok(res, await service.setDateOfBirthByStaff(req.params.userId, req.body.dateOfBirth), 'Đã cập nhật ngày sinh'),
);

export default router;

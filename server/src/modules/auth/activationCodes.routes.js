import { Router } from 'express';
import Joi from 'joi';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { created, ok } from '../../utils/response.js';
import { objectId, phoneVn } from '../../utils/validators.js';
import * as service from './deskCodes.service.js';

// Người 1 — Vũ Việt. UC02 bước 5–6: Lễ tân cấp mã kích hoạt / đặt lại mật khẩu in tại quầy
const router = Router();
const DESK = authorize('STAFF:RECEPTIONIST', 'MANAGER');

/**
 * @openapi
 * /activation-codes/lookup:
 *   get:
 *     tags: [Xác thực & Tài khoản]
 *     summary: Tra tài khoản theo SĐT, trả CCCD đã che để đối chiếu trước khi cấp mã — UC02
 */
router.get('/lookup', authenticate, DESK, validate({ query: Joi.object({ phone: phoneVn().required() }) }), async (req, res) => {
  ok(res, await service.lookupForDeskCode(req.user, req.validated.query.phone));
});

/**
 * @openapi
 * /activation-codes:
 *   post:
 *     tags: [Xác thực & Tài khoản]
 *     summary: Cấp mã in tại quầy, hạn 48 giờ, hủy mã cũ — UC02 (MSG-S09)
 */
router.post('/', authenticate, DESK, validate({ body: Joi.object({ userId: objectId().required() }) }), async (req, res) => {
  created(res, await service.issueDeskCode(req.user, req.validated.body.userId, { ip: req.ip }), 'Đã cấp mã');
});

/**
 * @openapi
 * /activation-codes/change-phone:
 *   post:
 *     tags: [Xác thực & Tài khoản]
 *     summary: Đổi SĐT (tên đăng nhập) tại quầy sau khi đối chiếu CCCD; thu hồi mọi phiên
 */
router.post(
  '/change-phone',
  authenticate,
  DESK,
  validate({ body: Joi.object({ userId: objectId().required(), phone: phoneVn().required() }) }),
  async (req, res) => {
    const { userId, phone } = req.validated.body;
    ok(res, await service.changePhoneAtDesk(req.user, userId, phone, { ip: req.ip }), 'Đã đổi số điện thoại');
  },
);

export default router;

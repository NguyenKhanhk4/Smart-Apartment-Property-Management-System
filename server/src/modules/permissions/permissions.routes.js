import { Router } from 'express';
import Joi from 'joi';
import { ROLE_KEYS } from '../../constants/permissions.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { ok } from '../../utils/response.js';
import { getMatrix, listRoles, myPermissions, saveMatrix } from './permissions.service.js';

const router = Router();
const roleParams = Joi.object({ roleKey: Joi.string().valid(...ROLE_KEYS).required() });

/**
 * @openapi
 * /permissions/me:
 *   get:
 *     tags: [Phân quyền]
 *     summary: Quyền đang bị tắt của người đăng nhập và các menu cần ẩn (UC04 bước 6)
 */
router.get('/me', authenticate, async (req, res) => {
  ok(res, await myPermissions(req.user));
});

/**
 * @openapi
 * /permissions/roles:
 *   get:
 *     tags: [Phân quyền]
 *     summary: Danh sách 7 vai trò của ma trận (Trưởng BQL)
 */
router.get('/roles', authenticate, authorize('MANAGER'), (_req, res) => {
  ok(res, listRoles());
});

/**
 * @openapi
 * /permissions/roles/{roleKey}:
 *   get:
 *     tags: [Phân quyền]
 *     summary: Ma trận chức năng × hành động của một vai trò (UC04 bước 2)
 *   put:
 *     tags: [Phân quyền]
 *     summary: Lưu ma trận (UC04 bước 4–5). Vai trò Trưởng BQL → 403 ROLE_READ_ONLY; bỏ quyền lõi → 400 CORE_PERMISSION
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               granted: { type: array, items: { type: string, example: 'TICKETS:VIEW' } }
 */
router.get('/roles/:roleKey', authenticate, authorize('MANAGER'), validate({ params: roleParams }), async (req, res) => {
  ok(res, await getMatrix(req.validated.params.roleKey));
});

router.put(
  '/roles/:roleKey',
  authenticate,
  authorize('MANAGER'),
  validate({
    params: roleParams,
    body: Joi.object({ granted: Joi.array().items(Joi.string().pattern(/^[A-Z_]+:[A-Z]+$/)).unique().max(500).required() }),
  }),
  async (req, res) => {
    const matrix = await saveMatrix(req.user, req.validated.params.roleKey, req.validated.body.granted);
    ok(res, matrix, 'Đã cập nhật phân quyền. Thay đổi áp dụng từ lần thao tác kế tiếp của người dùng.'); // MSG-S15
  },
);

export default router;

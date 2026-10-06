import { Router } from 'express';
import Joi from 'joi';
import { PRIORITIES, ROLES, values } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { created, ok } from '../../utils/response.js';
import { idParams } from '../../utils/validators.js';
import * as service from './complaintCategories.service.js';

const router = Router();

const bodySchema = Joi.object({
  name: Joi.string().trim().max(100).required(),
  description: Joi.string().allow('').max(500),
  defaultPriority: Joi.string()
    .valid(...values(PRIORITIES))
    .required(),
  slaHours: Joi.number().integer().min(1).max(24 * 60).required(),
  isActive: Joi.boolean(),
});
const updateSchema = bodySchema.fork(['name', 'defaultPriority', 'slaHours'], (s) => s.optional()).min(1);

/**
 * @openapi
 * /complaint-categories:
 *   get:
 *     tags: [Ticket - Danh mục]
 *     summary: Danh sách loại phản ánh (UC-E01). Manager thêm ?includeInactive=true để thấy cả loại đã ẩn
 *     parameters:
 *       - { in: query, name: includeInactive, schema: { type: boolean } }
 *   post:
 *     tags: [Ticket - Danh mục]
 *     summary: Tạo loại phản ánh (Manager)
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, defaultPriority, slaHours]
 *             properties:
 *               name: { type: string, example: Điện nước }
 *               description: { type: string }
 *               defaultPriority: { type: string, enum: [LOW, MEDIUM, HIGH, URGENT] }
 *               slaHours: { type: integer, example: 72 }
 */
router.get(
  '/',
  authenticate,
  validate({ query: Joi.object({ includeInactive: Joi.boolean().default(false) }) }),
  async (req, res) => {
    const includeInactive = req.validated.query.includeInactive && req.user.role === ROLES.MANAGER;
    ok(res, await service.list({ includeInactive }));
  },
);

router.post(
  '/',
  authenticate,
  authorize('MANAGER'),
  validate({ body: bodySchema }),
  async (req, res) => created(res, await service.create(req.body, req.user), 'Đã tạo loại phản ánh'),
);

/**
 * @openapi
 * /complaint-categories/{id}:
 *   patch:
 *     tags: [Ticket - Danh mục]
 *     summary: Sửa loại phản ánh (Manager)
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *   delete:
 *     tags: [Ticket - Danh mục]
 *     summary: Xóa loại phản ánh (đã có ticket dùng thì chỉ ẩn)
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 */
router.patch(
  '/:id',
  authenticate,
  authorize('MANAGER'),
  validate({ params: idParams, body: updateSchema }),
  async (req, res) =>
    ok(res, await service.update(req.params.id, req.body, req.user), 'Đã cập nhật loại phản ánh'),
);

router.delete(
  '/:id',
  authenticate,
  authorize('MANAGER'),
  validate({ params: idParams }),
  async (req, res) => ok(res, await service.remove(req.params.id, req.user)),
);

export default router;

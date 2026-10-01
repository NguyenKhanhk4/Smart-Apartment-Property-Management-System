import { Router } from 'express';
import Joi from 'joi';
import { ANNOUNCEMENT_SCOPES, values } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { paginationQuery } from '../../utils/pagination.js';
import { created, ok, paginated } from '../../utils/response.js';
import { idParams, objectId } from '../../utils/validators.js';
import * as service from './announcements.service.js';

const router = Router();
const PUBLISHERS = ['MANAGER', 'STAFF:RECEPTIONIST'];

const createBody = Joi.object({
  title: Joi.string().trim().min(3).max(200).required(),
  content: Joi.string().trim().min(3).max(10000).required(),
  targetScope: Joi.string()
    .valid(...values(ANNOUNCEMENT_SCOPES))
    .required(),
  targetId: Joi.when('targetScope', {
    is: ANNOUNCEMENT_SCOPES.ALL,
    then: Joi.any().strip(),
    otherwise: objectId().required(),
  }),
  isPinned: Joi.boolean().default(false),
  sendEmail: Joi.boolean().default(false),
});

/**
 * @openapi
 * /announcements:
 *   get:
 *     tags: [Bảng tin & Thông báo]
 *     summary: Bảng tin — cư dân thấy bài toàn khu + tòa + căn của mình; nội bộ thấy tất cả (UC-E09)
 *     parameters:
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *       - { in: query, name: q, schema: { type: string } }
 *       - { in: query, name: targetScope, schema: { type: string, enum: [ALL, BUILDING, APARTMENT] } }
 *   post:
 *     tags: [Bảng tin & Thông báo]
 *     summary: Đăng bài + tạo thông báo cho người nhận theo phạm vi, tuỳ chọn gửi email (Manager/Lễ tân)
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, content, targetScope]
 *             properties:
 *               title: { type: string }
 *               content: { type: string }
 *               targetScope: { type: string, enum: [ALL, BUILDING, APARTMENT] }
 *               targetId: { type: string, description: 'buildingId/apartmentId khi không phải ALL' }
 *               isPinned: { type: boolean }
 *               sendEmail: { type: boolean }
 */
router.get(
  '/',
  authenticate,
  validate({
    query: Joi.object({
      ...paginationQuery,
      q: Joi.string().trim().max(100),
      targetScope: Joi.string().valid(...values(ANNOUNCEMENT_SCOPES)),
    }),
  }),
  async (req, res) => {
    const { items, pagination } = await service.list(req.user, req.validated.query);
    paginated(res, items, pagination);
  },
);

router.post(
  '/',
  authenticate,
  authorize(...PUBLISHERS),
  validate({ body: createBody }),
  async (req, res) => created(res, await service.publish(req.user, req.body), 'Đã đăng bảng tin'),
);

/**
 * @openapi
 * /announcements/{id}:
 *   get:
 *     tags: [Bảng tin & Thông báo]
 *     summary: Chi tiết bài đăng
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *   patch:
 *     tags: [Bảng tin & Thông báo]
 *     summary: Sửa tiêu đề/nội dung/ghim (người đăng hoặc Manager)
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *   delete:
 *     tags: [Bảng tin & Thông báo]
 *     summary: Xóa bài (người đăng hoặc Manager)
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 */
router.get('/:id', authenticate, validate({ params: idParams }), async (req, res) =>
  ok(res, await service.getById(req.user, req.params.id)),
);

router.patch(
  '/:id',
  authenticate,
  authorize(...PUBLISHERS),
  validate({
    params: idParams,
    body: Joi.object({
      title: Joi.string().trim().min(3).max(200),
      content: Joi.string().trim().min(3).max(10000),
      isPinned: Joi.boolean(),
    }).min(1),
  }),
  async (req, res) => ok(res, await service.update(req.user, req.params.id, req.body), 'Đã cập nhật'),
);

router.delete(
  '/:id',
  authenticate,
  authorize(...PUBLISHERS),
  validate({ params: idParams }),
  async (req, res) => ok(res, await service.remove(req.user, req.params.id)),
);

export default router;

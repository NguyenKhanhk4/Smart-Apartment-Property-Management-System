// Module 8: API bảng tin/bình luận/khảo sát, quyền đăng và kiểm duyệt chỉ dành cho Trưởng BQL.
import { Router } from 'express';
import Joi from 'joi';
import { ApiError } from '../../utils/ApiError.js';
import { ANNOUNCEMENT_SCOPES, values } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { paginationQuery } from '../../utils/pagination.js';
import { created, ok, paginated } from '../../utils/response.js';
import { idParams, objectId } from '../../utils/validators.js';
import * as service from './announcements.service.js';
import { uploadImages, uploadToCloudinary } from '../../services/upload.service.js';

const router = Router();
const PUBLISHERS = ['MANAGER'];

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
  poll: Joi.object({
    audience: Joi.string().valid('OWNER', 'ACTIVE_RESIDENT').required(),
    options: Joi.array().items(Joi.string().trim().min(1).max(200)).min(2).max(10).unique().required(),
    closesAt: Joi.date().greater('now').required(),
  }),
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
      apartmentId: objectId(),
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
  uploadImages('attachments', 5, true),
  (req, _res, next) => {
    if (typeof req.body?.poll === 'string') {
      try { req.body.poll = JSON.parse(req.body.poll); } catch { return next(ApiError.badRequest('Dữ liệu khảo sát không hợp lệ')); }
    }
    next();
  },
  validate({ body: createBody }),
  async (req, res) => {
    const urls = await uploadToCloudinary(req.files, 'announcements');
    const attachments = urls.map((url, i) => ({ url, name: req.files[i].originalname }));
    created(res, await service.publish(req.user, { ...req.body, attachments }), 'Đã đăng bảng tin');
  },
);

router.get('/:id/comments', authenticate, validate({ params: idParams, query: Joi.object(paginationQuery) }), async (req, res) => {
  const { items, pagination } = await service.comments(req.user, req.params.id, req.validated.query);
  paginated(res, items, pagination);
});
router.post('/:id/comments', authenticate, authorize('RESIDENT'), validate({ params: idParams,
  body: Joi.object({ content: Joi.string().trim().min(1).max(2000).required() }) }),
async (req, res) => created(res, await service.addComment(req.user, req.params.id, req.body.content)));
router.patch('/:id/comments/:commentId/hide', authenticate, authorize('MANAGER'), validate({
  params: Joi.object({ id: objectId().required(), commentId: objectId().required() }),
  body: Joi.object({ reason: Joi.string().trim().min(1).max(500).required() }),
}), async (req, res) => ok(res, await service.hideComment(req.user, req.params.id, req.params.commentId, req.body.reason)));
router.get('/:id/poll', authenticate, authorize('MANAGER', 'BOARD', 'RESIDENT'), validate({ params: idParams, query: Joi.object({ apartmentId: objectId() }) }),
async (req, res) => ok(res, await service.pollResults(req.user, req.params.id, req.validated.query.apartmentId)));
router.put('/:id/poll/vote', authenticate, authorize('RESIDENT'), validate({ params: idParams,
  body: Joi.object({ apartmentId: objectId().required(), option: Joi.number().integer().min(0).max(9).required() }) }),
async (req, res) => ok(res, await service.vote(req.user, req.params.id, req.body)));
router.patch('/:id/poll/close', authenticate, authorize('MANAGER'), validate({ params: idParams }),
async (req, res) => ok(res, await service.closePoll(req.user, req.params.id)));

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

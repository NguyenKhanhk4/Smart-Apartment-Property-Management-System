import { Router } from 'express';
import Joi from 'joi';
import { NOTIFICATION_TYPES, values } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { Notification } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate, paginationQuery } from '../../utils/pagination.js';
import { ok } from '../../utils/response.js';
import { idParams, objectId } from '../../utils/validators.js';

// Thông báo cá nhân của người đang đăng nhập (UC-E09 bước 3-4). Ai cũng chỉ thấy của mình.
const router = Router();
router.use(authenticate);

/**
 * @openapi
 * /notifications:
 *   get:
 *     tags: [Bảng tin & Thông báo]
 *     summary: Thông báo của tôi (kèm unreadCount)
 *     parameters:
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *       - { in: query, name: isRead, schema: { type: boolean } }
 *       - { in: query, name: type, schema: { type: string } }
 */
router.get(
  '/',
  validate({
    query: Joi.object({
      ...paginationQuery,
      isRead: Joi.boolean(),
      type: Joi.string().valid(...values(NOTIFICATION_TYPES)),
    }),
  }),
  async (req, res) => {
    const { isRead, type } = req.validated.query;
    const filter = { userId: req.user.id };
    if (isRead !== undefined) filter.isRead = isRead;
    if (type) filter.type = type;
    const [{ items, pagination }, unreadCount] = await Promise.all([
      paginate(Notification, filter, req.validated.query),
      Notification.countDocuments({ userId: req.user.id, isRead: false }),
    ]);
    res.json({ success: true, data: items, pagination, unreadCount });
  },
);

/**
 * @openapi
 * /notifications/unread-count:
 *   get:
 *     tags: [Bảng tin & Thông báo]
 *     summary: Số thông báo chưa đọc (badge chuông)
 */
router.get('/unread-count', async (req, res) => {
  ok(res, { count: await Notification.countDocuments({ userId: req.user.id, isRead: false }) });
});

/**
 * @openapi
 * /notifications/read:
 *   patch:
 *     tags: [Bảng tin & Thông báo]
 *     summary: Đánh dấu đã đọc nhiều thông báo (ids) hoặc tất cả (all=true)
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ids: { type: array, items: { type: string } }
 *               all: { type: boolean }
 */
router.patch(
  '/read',
  validate({
    body: Joi.object({
      ids: Joi.array().items(objectId()).min(1).max(200),
      all: Joi.boolean().valid(true),
    }).xor('ids', 'all'),
  }),
  async (req, res) => {
    const filter = { userId: req.user.id, isRead: false };
    if (req.body.ids) filter._id = { $in: req.body.ids };
    const result = await Notification.updateMany(filter, { $set: { isRead: true, readAt: new Date() } });
    ok(res, { updated: result.modifiedCount });
  },
);

/**
 * @openapi
 * /notifications/{id}/read:
 *   patch:
 *     tags: [Bảng tin & Thông báo]
 *     summary: Đánh dấu 1 thông báo đã đọc
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 */
router.patch('/:id/read', validate({ params: idParams }), async (req, res) => {
  const doc = await Notification.findOneAndUpdate(
    { _id: req.params.id, userId: req.user.id },
    { $set: { isRead: true, readAt: new Date() } },
    { new: true },
  ).lean();
  if (!doc) throw ApiError.notFound('Không tìm thấy thông báo');
  ok(res, doc);
});

export default router;

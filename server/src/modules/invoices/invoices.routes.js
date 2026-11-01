import { Router } from 'express';
import Joi from 'joi';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { created, ok } from '../../utils/response.js';
import { idParams, objectId, period } from '../../utils/validators.js';
import * as drafts from './invoices.drafts.js';
import * as service from './invoices.service.js';

// Mô đun 4 — UC26: Tính phí → thông báo Nháp; Kế toán sửa Nháp (khoản thu khác, tính lại) trước khi trình duyệt.
const router = Router();
const BILLING_ROLES = ['ACCOUNTANT', 'MANAGER'];

const previewQuery = Joi.object({ period: period().required(), apartmentId: objectId(), buildingId: objectId() });
const generateBody = Joi.object({ period: period().required(), apartmentId: objectId() });
const MAX_ITEM_AMOUNT = 10_000_000_000; // 10 tỷ: chặn gõ nhầm số
const otherItemBody = Joi.object({
  description: Joi.string().trim().min(3).max(200).required(),
  amount: Joi.number().integer().min(1).max(MAX_ITEM_AMOUNT).required(), // VND nguyên
});
const itemParams = Joi.object({ id: objectId().required(), index: Joi.number().integer().min(0).max(500).required() });

/**
 * @openapi
 * /invoices/preview:
 *   get:
 *     tags: [Phí & hóa đơn]
 *     summary: Tính thử hóa đơn kỳ (không ghi). Mỗi căn có status NEW (sẽ lập) / EXISTS (đã có) / NO_PAYER (chưa có HĐ mua bán, bỏ qua) / ERROR (vd thiếu đơn giá), kèm dòng phí dự kiến và người trả
 *     parameters:
 *       - { in: query, name: period, required: true, schema: { type: string }, example: '2026-10' }
 *       - { in: query, name: apartmentId, schema: { type: string } }
 *       - { in: query, name: buildingId, schema: { type: string } }
 */
router.get('/preview', authenticate, authorize(...BILLING_ROLES), validate({ query: previewQuery }), async (req, res) =>
  ok(res, await service.previewInvoices(req.validated.query)),
);

/**
 * @openapi
 * /invoices/generate:
 *   post:
 *     tags: [Phí & hóa đơn]
 *     summary: Tính phí tới kỳ hiện tại → thông báo phí NHÁP (chưa gửi cư dân, chưa có hạn đóng). Có apartmentId → 1 căn (đã có → INVOICE_ALREADY_EXISTS). Không có → cả kỳ (ghi cron_runs, trigger MANUAL), căn đã có thông báo được bỏ qua
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [period]
 *             properties:
 *               period: { type: string, example: '2026-10' }
 *               apartmentId: { type: string }
 */
router.post('/generate', authenticate, authorize(...BILLING_ROLES), validate({ body: generateBody }), async (req, res) => {
  if (req.body.apartmentId) {
    return created(res, await service.generateForApartment(req.user, req.body), 'Đã tính phí, thông báo ở trạng thái Nháp');
  }
  const result = await service.generateBatch(req.user, req.body);
  const { summary } = result;
  const message = summary
    ? `Đã tạo ${summary.created} thông báo phí Nháp${summary.failed.length ? `, lỗi ${summary.failed.length} căn` : ''}`
    : 'Tính phí thất bại';
  return ok(res, result, message);
});

/**
 * @openapi
 * /invoices/{id}/items:
 *   post:
 *     tags: [Phí & hóa đơn]
 *     summary: Kế toán thêm Khoản thu khác (không có trong biểu phí, vd làm lại thẻ xe) vào thông báo NHÁP. Ghi Audit Log
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [description, amount]
 *             properties:
 *               description: { type: string, example: 'Làm lại thẻ xe' }
 *               amount: { type: integer, example: 50000 }
 */
router.post(
  '/:id/items',
  authenticate,
  authorize('ACCOUNTANT'),
  validate({ params: idParams, body: otherItemBody }),
  async (req, res) => created(res, await drafts.addOtherItem(req.user, req.params.id, req.body), 'Đã thêm khoản thu khác'),
);

/**
 * @openapi
 * /invoices/{id}/items/{index}:
 *   delete:
 *     tags: [Phí & hóa đơn]
 *     summary: Xóa khoản thu khác (dòng thứ index, tính từ 0) khỏi thông báo NHÁP. Dòng phí tự động không xóa được, hãy Tính lại
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: path, name: index, required: true, schema: { type: integer } }
 */
router.delete('/:id/items/:index', authenticate, authorize('ACCOUNTANT'), validate({ params: itemParams }), async (req, res) =>
  ok(res, await drafts.removeOtherItem(req.user, req.params.id, Number(req.params.index)), 'Đã xóa khoản thu khác'),
);

/**
 * @openapi
 * /invoices/{id}/recalculate:
 *   post:
 *     tags: [Phí & hóa đơn]
 *     summary: Tính lại thông báo NHÁP theo đơn giá, xe, phí tiện ích, Người nộp phí hiện tại; giữ khoản thu khác. Ghi Audit Log
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 */
router.post('/:id/recalculate', authenticate, authorize('ACCOUNTANT'), validate({ params: idParams }), async (req, res) =>
  ok(res, await drafts.recalculateDraft(req.user, req.params.id), 'Đã tính lại'),
);

export default router;

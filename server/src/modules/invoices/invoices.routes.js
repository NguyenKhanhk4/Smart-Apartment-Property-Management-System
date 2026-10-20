import { Router } from 'express';
import Joi from 'joi';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { created, ok } from '../../utils/response.js';
import { objectId, period } from '../../utils/validators.js';
import * as service from './invoices.service.js';

// Module B — UC-B02: Sinh hóa đơn tháng. Cron tự chạy 00:30 ngày 1; Kế toán xem trước và sinh thủ công.
const router = Router();
const BILLING_ROLES = ['ACCOUNTANT', 'MANAGER'];

const previewQuery = Joi.object({ period: period().required(), apartmentId: objectId(), buildingId: objectId() });
const generateBody = Joi.object({ period: period().required(), apartmentId: objectId() });

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
 *     summary: Sinh hóa đơn thủ công tới kỳ hiện tại. Có apartmentId → lập 1 căn (đã có → INVOICE_ALREADY_EXISTS). Không có → chạy cả đợt như cron (ghi cron_runs, trigger MANUAL), căn đã có hóa đơn được bỏ qua
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
    return created(res, await service.generateForApartment(req.user, req.body), 'Đã lập hóa đơn');
  }
  const result = await service.generateBatch(req.user, req.body);
  const { summary } = result;
  const message = summary
    ? `Đã lập ${summary.created} hóa đơn${summary.failed.length ? `, lỗi ${summary.failed.length} căn` : ''}`
    : 'Sinh hóa đơn thất bại';
  return ok(res, result, message);
});

export default router;

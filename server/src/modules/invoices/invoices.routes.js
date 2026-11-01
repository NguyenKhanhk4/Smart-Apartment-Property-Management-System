import { Router } from 'express';
import Joi from 'joi';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { INVOICE_STATUS } from '../../constants/enums.js';
import { paginationQuery, sortable } from '../../utils/pagination.js';
import { created, ok, paginated } from '../../utils/response.js';
import { csvEnum, idParams, objectId, period } from '../../utils/validators.js';
import * as approval from './invoices.approval.js';
import * as drafts from './invoices.drafts.js';
import * as queries from './invoices.queries.js';
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

const INVOICE_SORT = sortable('createdAt', 'period', 'code', 'totalAmount', 'dueDate');
const listQuery = Joi.object({
  ...paginationQuery,
  sort: INVOICE_SORT.default('code'),
  period: period(),
  status: csvEnum(Object.values(INVOICE_STATUS)),
  buildingId: objectId(),
  apartmentId: objectId(),
  payerId: objectId(),
  q: Joi.string().trim().max(50).allow(''),
});
const myQuery = Joi.object({
  ...paginationQuery,
  sort: sortable('period', 'createdAt').default('-period'),
  apartmentId: objectId().required(),
  period: period(),
  status: csvEnum(Object.values(INVOICE_STATUS)),
});

/**
 * @openapi
 * /invoices:
 *   get:
 *     tags: [Phí & hóa đơn]
 *     summary: Kế toán / Trưởng BQL xem danh sách thông báo phí (lọc kỳ, trạng thái CSV, tòa, căn, người nộp, mã). Kèm byStatus = đếm + tổng tiền theo trạng thái (cùng bộ lọc, bỏ lọc trạng thái)
 */
router.get('/', authenticate, authorize(...queries.STAFF_VIEW_ROLES), validate({ query: listQuery }), async (req, res) => {
  const { items, pagination, byStatus } = await queries.listInvoices(req.validated.query);
  return paginated(res, items, pagination, { byStatus });
});

/**
 * @openapi
 * /invoices/my:
 *   get:
 *     tags: [Phí & hóa đơn]
 *     summary: Cư dân xem thông báo phí ĐÃ PHÁT HÀNH của căn đang chọn (X1 — Người nộp phí xem mọi thông báo của mình; thành viên khác chỉ xem các kỳ từ khi chuyển vào). Kèm summary = tổng còn nợ, quá hạn, Số dư trả trước của chính mình
 *     parameters:
 *       - { in: query, name: apartmentId, required: true, schema: { type: string } }
 */
router.get('/my', authenticate, authorize('RESIDENT'), validate({ query: myQuery }), async (req, res) => {
  const { items, pagination, summary } = await queries.myInvoices(req.user, req.validated.query);
  return paginated(res, items, pagination, { summary });
});

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

// ---- Trình duyệt / Duyệt & Phát hành / Trả lại: chọn theo danh sách id HOẶC cả kỳ ----
const selectorKeys = {
  invoiceIds: Joi.array().items(objectId()).min(1).max(2000).unique(),
  period: period(),
};
const selectorBody = Joi.object(selectorKeys).xor('invoiceIds', 'period');
const returnBody = Joi.object({ ...selectorKeys, reason: Joi.string().trim().min(5).max(500).required() }).xor(
  'invoiceIds',
  'period',
);
const skippedNote = (r) => (r.skipped.length ? `, bỏ qua ${r.skipped.length} thông báo không đúng trạng thái` : '');

/**
 * @openapi
 * /invoices/submit:
 *   post:
 *     tags: [Phí & hóa đơn]
 *     summary: Kế toán trình duyệt thông báo NHÁP → Chờ duyệt, báo Trưởng BQL. Gửi invoiceIds hoặc period (cả kỳ)
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               invoiceIds: { type: array, items: { type: string } }
 *               period: { type: string, example: '2026-10' }
 */
router.post('/submit', authenticate, authorize('ACCOUNTANT'), validate({ body: selectorBody }), async (req, res) => {
  const r = await approval.submitInvoices(req.user, req.body);
  return ok(res, r, `Đã trình duyệt ${r.count} thông báo phí${skippedNote(r)}`);
});

/**
 * @openapi
 * /invoices/publish:
 *   post:
 *     tags: [Phí & hóa đơn]
 *     summary: Trưởng BQL Duyệt & Phát hành thông báo Chờ duyệt → đặt hạn đóng, chụp Nợ các kỳ trước, trừ Số dư trả trước, gửi Email + Web cho Người nộp phí
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               invoiceIds: { type: array, items: { type: string } }
 *               period: { type: string, example: '2026-10' }
 */
router.post('/publish', authenticate, authorize('MANAGER'), validate({ body: selectorBody }), async (req, res) => {
  const r = await approval.publishInvoices(req.user, req.body);
  const failed = r.failed.length ? `, lỗi ${r.failed.length}` : '';
  return ok(res, r, `Đã phát hành ${r.count} thông báo phí${failed}${skippedNote(r)}`);
});

/**
 * @openapi
 * /invoices/return:
 *   post:
 *     tags: [Phí & hóa đơn]
 *     summary: Trưởng BQL trả lại thông báo Chờ duyệt → về Nháp kèm lý do, báo Kế toán đã trình
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               invoiceIds: { type: array, items: { type: string } }
 *               period: { type: string, example: '2026-10' }
 *               reason: { type: string, example: 'Sai số xe căn A1205' }
 */
router.post('/return', authenticate, authorize('MANAGER'), validate({ body: returnBody }), async (req, res) => {
  const r = await approval.returnInvoices(req.user, req.body);
  return ok(res, r, `Đã trả lại ${r.count} thông báo phí${skippedNote(r)}`);
});

/**
 * @openapi
 * /invoices/{id}:
 *   get:
 *     tags: [Phí & hóa đơn]
 *     summary: Chi tiết thông báo phí + các lần thanh toán đã phân bổ + giao dịch Số dư trả trước. Cư dân chỉ xem được thông báo đã phát hành theo quyền X1 (không có quyền → 404)
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 */
router.get('/:id', authenticate, authorize(...queries.STAFF_VIEW_ROLES, 'RESIDENT'), validate({ params: idParams }), async (req, res) =>
  ok(res, await queries.getInvoice(req.user, req.params.id)),
);

export default router;

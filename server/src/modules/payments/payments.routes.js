import { Router } from 'express';
import Joi from 'joi';
import { PAYMENT_METHODS, PAYMENT_STATUS } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { paginationQuery, sortable } from '../../utils/pagination.js';
import { created, ok, paginated } from '../../utils/response.js';
import { csvEnum, idParams, objectId } from '../../utils/validators.js';
import { sendFile } from '../../services/export.service.js';
import * as payosService from './payments.payos.js';
import { buildReceiptPdf } from './receipt.pdf.js';
import * as service from './payments.service.js';

// Mô đun 4 — UC29 payOS, UC30 thu tiền mặt / chuyển khoản, UC35 biên lai, danh sách giao dịch.
const router = Router();
const MAX_AMOUNT = 10_000_000_000;

const offlineBody = Joi.object({
  invoiceId: objectId(),
  apartmentId: objectId(),
  payerId: objectId(),
  method: Joi.string().valid(PAYMENT_METHODS.CASH, PAYMENT_METHODS.BANK_TRANSFER).required(),
  amount: Joi.number().integer().min(1).max(MAX_AMOUNT).required(),
  bankRef: Joi.string().trim().max(100).allow('', null),
  note: Joi.string().trim().max(500).allow('', null),
  paidAt: Joi.date().iso(),
})
  .xor('invoiceId', 'apartmentId')
  .and('apartmentId', 'payerId');

const listQuery = Joi.object({
  ...paginationQuery,
  sort: sortable('paidAt', 'amount', 'createdAt').default('-paidAt'),
  method: csvEnum(Object.values(PAYMENT_METHODS)),
  status: Joi.string().valid(...Object.values(PAYMENT_STATUS)),
  apartmentId: objectId(),
  payerId: objectId(),
  from: Joi.date().iso(),
  to: Joi.date().iso().min(Joi.ref('from')),
  q: Joi.string().trim().max(100).allow(''),
  needsReconcile: Joi.boolean(),
});

const payosCreateBody = Joi.object({
  invoiceIds: Joi.array().items(objectId().required()).min(1).max(24).unique().required(),
});
const orderParams = Joi.object({ orderCode: Joi.number().integer().min(1).max(Number.MAX_SAFE_INTEGER).required() });

/**
 * @openapi
 * /payments/offline:
 *   post:
 *     tags: [Thanh toán]
 *     summary: Kế toán ghi nhận tiền mặt / chuyển khoản. Phân bổ vào thông báo còn nợ CŨ NHẤT TRƯỚC của Người nộp phí; tiền thừa vào Số dư trả trước. Sinh phiếu thu PT-YYYYMM-xxxxx, gửi biên lai. Chuyển khoản bắt buộc bankRef, trùng → PAYMENT_DUPLICATE
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [method, amount]
 *             properties:
 *               invoiceId: { type: string, description: 'Lấy căn + Người nộp phí từ thông báo này' }
 *               apartmentId: { type: string }
 *               payerId: { type: string }
 *               method: { type: string, enum: [CASH, BANK_TRANSFER] }
 *               amount: { type: integer, example: 400000 }
 *               bankRef: { type: string }
 *               note: { type: string }
 *               paidAt: { type: string, format: date-time }
 */
router.post('/offline', authenticate, authorize('ACCOUNTANT'), validate({ body: offlineBody }), async (req, res) => {
  const p = await service.recordOfflinePayment(req.user, req.body);
  return created(res, p, `Đã ghi nhận phiếu thu ${p.receiptNo}`);
});

/**
 * @openapi
 * /payments:
 *   get:
 *     tags: [Thanh toán]
 *     summary: Danh sách giao dịch thu (lọc hình thức CSV, trạng thái, căn, người nộp, khoảng ngày, số phiếu / mã GD). Kèm totals (tổng thu, tổng tiền thừa)
 */
router.get('/', authenticate, authorize('ACCOUNTANT', 'MANAGER'), validate({ query: listQuery }), async (req, res) => {
  const { items, pagination, totals } = await service.listPayments(req.validated.query);
  return paginated(res, items, pagination, { totals });
});

/**
 * @openapi
 * /payments/{id}/receipt.pdf:
 *   get:
 *     tags: [Thanh toán]
 *     summary: Tải PDF biên lai (số tiền bằng chữ, phân bổ, ghi chú không thay thế hóa đơn GTGT). Quyền như xem biên lai
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 */
router.get(
  '/:id/receipt.pdf',
  authenticate,
  authorize('ACCOUNTANT', 'MANAGER', 'RESIDENT'),
  validate({ params: idParams }),
  async (req, res) => sendFile(res, await buildReceiptPdf(req.user, req.params.id)),
);

/**
 * @openapi
 * /payments/{id}/receipt:
 *   get:
 *     tags: [Thanh toán]
 *     summary: Biên lai — số đã trả, phân bổ vào thông báo nào, số còn nợ hiện tại, Số dư trả trước. Cư dân chỉ xem biên lai mình đã nộp
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 */
router.get(
  '/:id/receipt',
  authenticate,
  authorize('ACCOUNTANT', 'MANAGER', 'RESIDENT'),
  validate({ params: idParams }),
  async (req, res) => ok(res, await service.getReceipt(req.user, req.params.id)),
);

/**
 * @openapi
 * /payments/payos/create:
 *   post:
 *     tags: [Thanh toán]
 *     summary: Người nộp phí chọn thông báo còn nợ → tạo link payOS (VietQR), hết hạn sau 15 phút. Đã có link còn hạn cho đúng các thông báo này → trả lại link cũ. Chưa cấu hình khóa → PAYOS_DISABLED
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [invoiceIds]
 *             properties:
 *               invoiceIds: { type: array, items: { type: string } }
 */
router.post('/payos/create', authenticate, authorize('RESIDENT'), validate({ body: payosCreateBody }), async (req, res) =>
  created(res, await payosService.createPayosPayment(req.user, req.body), 'Đã tạo link thanh toán'),
);

/**
 * @openapi
 * /payments/payos/webhook:
 *   post:
 *     tags: [Thanh toán]
 *     summary: payOS gọi về khi có tiền (KHÔNG cần đăng nhập — xác thực bằng chữ ký HMAC-SHA256 checksumKey). Gạch nợ đúng 1 lần theo orderCode. Khai báo URL này trong trang quản lý kênh thanh toán payOS (cần địa chỉ public, vd ngrok khi dev)
 *     security: []
 */
router.post('/payos/webhook', async (req, res) => ok(res, await payosService.handlePayosWebhook(req.body)));

/**
 * @openapi
 * /payments/payos/{orderCode}:
 *   get:
 *     tags: [Thanh toán]
 *     summary: Trạng thái giao dịch payOS (trang kết quả sau khi thanh toán). Còn chờ thì server hỏi thẳng payOS và gạch nợ nếu đã trả — không phụ thuộc webhook
 *     parameters:
 *       - { in: path, name: orderCode, required: true, schema: { type: integer } }
 */
router.get(
  '/payos/:orderCode',
  authenticate,
  authorize('RESIDENT', 'ACCOUNTANT', 'MANAGER'),
  validate({ params: orderParams }),
  async (req, res) => ok(res, await payosService.getPayosStatus(req.user, Number(req.params.orderCode))),
);

export default router;

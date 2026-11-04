import { Router } from 'express';
import Joi from 'joi';
import { PAYMENT_METHODS, PAYMENT_STATUS } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { paginationQuery, sortable } from '../../utils/pagination.js';
import { created, ok, paginated } from '../../utils/response.js';
import { csvEnum, idParams, objectId } from '../../utils/validators.js';
import * as service from './payments.service.js';

// Mô đun 4 — UC30 thu tiền mặt / chuyển khoản, UC35 biên lai, danh sách giao dịch. payOS (UC29) thêm ở bước sau.
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
});

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

export default router;

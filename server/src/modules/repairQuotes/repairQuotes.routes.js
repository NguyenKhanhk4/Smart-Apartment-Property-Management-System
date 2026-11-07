import { Router } from 'express';
import Joi from 'joi';
import { QUOTE_STATUS } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { paginationQuery, sortable } from '../../utils/pagination.js';
import { created, ok, paginated } from '../../utils/response.js';
import { csvEnum, objectId } from '../../utils/validators.js';
import * as service from './repairQuotes.service.js';

// Mô đun 5 (phần Người 3) — UC48 báo giá sửa chữa trong căn hộ. Quyết định đồng ý / từ chối: PATCH /tickets/:id/quote-decision.
const router = Router();
router.use(authenticate);

const MAX_PRICE = 1_000_000_000;
const submitBody = Joi.object({
  ticketId: objectId().required(),
  items: Joi.array()
    .items(
      Joi.object({
        description: Joi.string().trim().min(2).max(200).required(),
        quantity: Joi.number().positive().max(10_000).required(),
        unitPrice: Joi.number().integer().min(0).max(MAX_PRICE).required(),
      }),
    )
    .min(1)
    .max(30)
    .required(),
  note: Joi.string().trim().max(1000).allow('', null),
});

const listQuery = Joi.object({
  ...paginationQuery,
  sort: sortable('sentAt', 'totalAmount').default('-sentAt'),
  status: csvEnum(Object.values(QUOTE_STATUS)),
  billed: Joi.boolean(),
  apartmentId: objectId(),
});

/**
 * @openapi
 * /repair-quotes:
 *   post:
 *     tags: [Báo giá sửa chữa]
 *     summary: Kỹ thuật viên được giao gửi báo giá sự cố trong căn hộ (hạng mục, số lượng, đơn giá). Phiếu Đã nhận → Chờ đồng ý phí, báo Người nộp phí. Đang xử lý mà báo giá lại vượt QUOTE_REAPPROVAL_PERCENT% số đã đồng ý → quay lại Chờ đồng ý phí; trong ngưỡng → tự áp dụng
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ticketId, items]
 *             properties:
 *               ticketId: { type: string }
 *               items: { type: array, items: { type: object, properties: { description: { type: string }, quantity: { type: number }, unitPrice: { type: integer } } } }
 *               note: { type: string }
 */
router.post('/', authorize('STAFF:TECHNICIAN'), validate({ body: submitBody }), async (req, res) => {
  const result = await service.submitQuote(req.user, req.body);
  return created(res, result, result.needsApproval ? 'Đã gửi báo giá, chờ Người nộp phí đồng ý' : 'Đã cập nhật chi phí sửa chữa');
});

/**
 * @openapi
 * /repair-quotes:
 *   get:
 *     tags: [Báo giá sửa chữa]
 *     summary: Kế toán / Trưởng BQL xem báo giá (lọc trạng thái CSV, đã / chưa vào thông báo phí, căn). status=ACCEPTED&billed=false là chi phí sửa chữa chưa tính phí
 */
router.get('/', authorize('ACCOUNTANT', 'MANAGER'), validate({ query: listQuery }), async (req, res) => {
  const { items, pagination } = await service.listQuotes(req.validated.query);
  return paginated(res, items, pagination);
});

/**
 * @openapi
 * /repair-quotes/ticket/{ticketId}:
 *   get:
 *     tags: [Báo giá sửa chữa]
 *     summary: Các phiên bản báo giá của 1 phiếu sự cố (mới nhất trước), kèm hạn tự đóng của bản đang chờ và ngưỡng % duyệt lại
 *     parameters:
 *       - { in: path, name: ticketId, required: true, schema: { type: string } }
 */
router.get('/ticket/:ticketId', validate({ params: Joi.object({ ticketId: objectId().required() }) }), async (req, res) =>
  ok(res, await service.listTicketQuotes(req.user, req.params.ticketId)),
);

export default router;

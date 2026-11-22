import { Router } from 'express';
import Joi from 'joi';
import { FUND_INCOME_SOURCES, FUND_PLAN_TYPES, FUND_PROPOSAL_STATUS, FUND_TX_TYPES, VOTE_DECISIONS } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { uploadImages } from '../../services/upload.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginationQuery, sortable } from '../../utils/pagination.js';
import { created, ok, paginated } from '../../utils/response.js';
import { csvEnum, idParams, objectId } from '../../utils/validators.js';
import * as board from '../workOrders/workOrders.board.js';
import * as service from './fund.service.js';

// Mô đun 4 — Quỹ bảo trì 2% (UC33 Trưởng BQL lập, Kế toán xác nhận / ghi thu chi; UC34 Ban quản trị biểu quyết, xác nhận nghiệm thu). Form có ảnh gửi multipart, field ảnh `images`.
const router = Router();
router.use(authenticate);

const VIEWERS = authorize('ACCOUNTANT', 'MANAGER', 'BOARD');
const MAX_AMOUNT = 1_000_000_000_000;
const money = () => Joi.number().integer().min(1).max(MAX_AMOUNT);

const incomeBody = Joi.object({
  incomeSource: Joi.string().valid(...Object.values(FUND_INCOME_SOURCES)).required(),
  amount: money().required(),
  occurredAt: Joi.date().iso(),
  documentNo: Joi.string().trim().min(1).max(100).required(),
  description: Joi.string().trim().max(500).allow('', null),
});

const proposalBody = Joi.object({
  title: Joi.string().trim().min(3).max(200).required(),
  description: Joi.string().trim().min(3).max(2000).required(),
  amount: money().required(),
  planType: Joi.string().valid(...Object.values(FUND_PLAN_TYPES)).required(),
  planRef: Joi.string().trim().max(200).allow('', null),
  urgentReason: Joi.string().trim().max(1000).allow('', null),
  largeRepair: Joi.boolean().default(false),
  workOrderId: objectId().allow('', null), // UC10: lập từ phiếu bảo trì duyệt sửa bằng Quỹ
  contractNo: Joi.string().trim().max(100).allow('', null),
});
// Gửi lại đề xuất bị trả lại: sửa các trường, không đổi phiếu bảo trì gắn kèm
const resubmitBody = Joi.object({
  title: Joi.string().trim().min(3).max(200),
  description: Joi.string().trim().min(3).max(2000),
  amount: money(),
  planType: Joi.string().valid(...Object.values(FUND_PLAN_TYPES)),
  planRef: Joi.string().trim().max(200).allow('', null),
  urgentReason: Joi.string().trim().max(1000).allow('', null),
  contractNo: Joi.string().trim().max(100).allow('', null),
  note: Joi.string().trim().max(1000).allow('', null),
});

const expenseBody = Joi.object({
  amount: money().required(),
  occurredAt: Joi.date().iso(),
  documentNo: Joi.string().trim().min(1).max(100).required(),
  description: Joi.string().trim().max(500).allow('', null),
  varianceReason: Joi.string().trim().max(1000).allow('', null), // BR-F17: bắt buộc khi chi thấp hơn số duyệt
});

/**
 * @openapi
 * /fund:
 *   get:
 *     tags: [Quỹ bảo trì]
 *     summary: Tổng quan Quỹ bảo trì 2% — số dư, đã cam kết (đề xuất đã duyệt chưa chi), còn có thể chi, thu chi từ đầu năm, số đề xuất chờ duyệt, cảnh báo số dư thấp
 */
router.get('/', VIEWERS, async (_req, res) => ok(res, await service.getOverview()));

/**
 * @openapi
 * /fund/transactions:
 *   get:
 *     tags: [Quỹ bảo trì]
 *     summary: Sổ thu chi quỹ (lọc loại, khoảng ngày), mới nhất trước
 */
router.get(
  '/transactions',
  VIEWERS,
  validate({
    query: Joi.object({
      ...paginationQuery,
      sort: sortable('occurredAt', 'amount').default('-occurredAt'),
      type: Joi.string().valid(...Object.values(FUND_TX_TYPES)),
      from: Joi.date().iso(),
      to: Joi.date().iso().min(Joi.ref('from')),
    }),
  }),
  async (req, res) => {
    const { items, pagination } = await service.listTransactions(req.validated.query);
    return paginated(res, items, pagination);
  },
);

/**
 * @openapi
 * /fund/incomes:
 *   post:
 *     tags: [Quỹ bảo trì]
 *     summary: Kế toán ghi nhận thu quỹ có chứng từ (multipart; ảnh chứng từ ở field images). Phiếu thu quỹ PTQ-YYYYMM-xxxxx
 */
router.post('/incomes', authorize('ACCOUNTANT'), uploadImages('images', 5), validate({ body: incomeBody }), async (req, res) => {
  const tx = await service.recordIncome(req.user, req.body, req.files);
  return created(res, tx, `Đã ghi nhận thu quỹ ${tx.code}`);
});

/**
 * @openapi
 * /fund/work-orders:
 *   get:
 *     tags: [Quỹ bảo trì]
 *     summary: UC10 — phiếu bảo trì Trưởng BQL đã duyệt sửa bằng Quỹ (kể cả sửa khẩn cấp) chưa có đề xuất đang xử lý / đã duyệt — chờ Trưởng BQL lập đề xuất
 */
router.get('/work-orders', authorize('MANAGER', 'ACCOUNTANT'), async (_req, res) => ok(res, await service.listAwaitingWorkOrders()));

/**
 * @openapi
 * /fund/work-orders/{id}/prefill:
 *   get:
 *     tags: [Quỹ bảo trì]
 *     summary: Dữ liệu điền sẵn form đề xuất chi từ báo cáo hư hỏng (hạng mục, mô tả, chi phí dự kiến, ảnh). Phiếu không chờ đề xuất → WORKORDER_NOT_AWAITING_FUND / WORKORDER_FUND_PENDING
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 */
router.get('/work-orders/:id/prefill', authorize('MANAGER'), validate({ params: idParams }), async (req, res) =>
  ok(res, await service.workOrderPrefill(req.params.id)),
);

/**
 * @openapi
 * /fund/proposals:
 *   get:
 *     tags: [Quỹ bảo trì]
 *     summary: Danh sách đề xuất chi quỹ (lọc trạng thái CSV)
 *   post:
 *     tags: [Quỹ bảo trì]
 *     summary: Trưởng BQL lập đề xuất chi (multipart; ảnh báo giá ở field images) → Chờ Kế toán xác nhận, báo Kế toán. Kế hoạch năm phải có planRef, đột xuất phải có urgentReason; vượt số dư khả dụng → FUND_INSUFFICIENT_BALANCE. Có workOrderId (UC10) thì phiếu phải đang chờ đề xuất, đề xuất là sửa chữa lớn và kèm ảnh hư hỏng
 */
router.get(
  '/proposals',
  VIEWERS,
  validate({
    query: Joi.object({
      ...paginationQuery,
      sort: sortable('createdAt', 'amount').default('-createdAt'),
      status: csvEnum(Object.values(FUND_PROPOSAL_STATUS)),
      readyToPay: Joi.boolean(), // Kế toán: đề xuất lập phiếu chi được ngay
    }),
  }),
  async (req, res) => {
    const { items, pagination } = await service.listProposals(req.validated.query);
    return paginated(res, items, pagination);
  },
);
router.post('/proposals', authorize('MANAGER'), uploadImages('images', 5), validate({ body: proposalBody }), async (req, res) => {
  const p = await service.createProposal(req.user, req.body, req.files);
  return created(res, p, `Đã gửi đề xuất ${p.code} cho Kế toán xác nhận`);
});

/**
 * @openapi
 * /fund/proposals/{id}:
 *   get:
 *     tags: [Quỹ bảo trì]
 *     summary: Chi tiết đề xuất — phiếu biểu quyết, tally (số thành viên, cần bao nhiêu phiếu đồng ý, ai chưa bỏ phiếu), phiếu của tôi, số dư quỹ
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 */
/**
 * @openapi
 * /fund/acceptances:
 *   get:
 *     tags: [Quỹ bảo trì]
 *     summary: BR-E09 — việc chờ Ban quản trị xác nhận nghiệm thu (phiếu sửa bằng Quỹ đã được Trưởng BQL nghiệm thu kỹ thuật + đề xuất sửa chữa lớn không gắn phiếu)
 */
router.get('/acceptances', authorize('BOARD', 'MANAGER'), async (_req, res) => ok(res, await board.listAwaitingBoard()));

router.get('/proposals/:id', VIEWERS, validate({ params: idParams }), async (req, res) =>
  ok(res, await service.getProposal(req.user, req.params.id)),
);

/**
 * @openapi
 * /fund/proposals/{id}/votes:
 *   post:
 *     tags: [Quỹ bảo trì]
 *     summary: Thành viên Ban quản trị biểu quyết (1 phiếu, không sửa; Không đồng ý phải ghi ý kiến). Đủ tỷ lệ thì tự chốt Đã duyệt / Từ chối
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [decision]
 *             properties:
 *               decision: { type: string, enum: [AGREE, DISAGREE] }
 *               comment: { type: string }
 */
router.post(
  '/proposals/:id/votes',
  authorize('BOARD'),
  validate({
    params: idParams,
    body: Joi.object({
      decision: Joi.string().valid(...Object.values(VOTE_DECISIONS)).required(),
      comment: Joi.string().trim().max(1000).allow('', null),
    }),
  }),
  async (req, res) => {
    const r = await service.vote(req.user, req.params.id, req.body);
    const msg = {
      APPROVED: 'Đã biểu quyết — đề xuất đủ tỷ lệ, đã duyệt',
      REJECTED: 'Đã biểu quyết — đề xuất không đạt tỷ lệ',
      BLOCKED_BALANCE: 'Đã biểu quyết — đủ tỷ lệ nhưng số dư khả dụng không đủ, chưa chốt duyệt',
    }[r.outcome] ?? 'Đã ghi nhận biểu quyết';
    return ok(res, r, msg);
  },
);

/**
 * @openapi
 * /fund/proposals/{id}/verify:
 *   post:
 *     tags: [Quỹ bảo trì]
 *     summary: Kế toán xác nhận tài chính (số dư khả dụng đủ, chứng từ hợp lệ) → Chờ Ban quản trị biểu quyết, báo Ban quản trị. Người lập không tự xác nhận; thiếu số dư → FUND_INSUFFICIENT_BALANCE (dùng Trả lại)
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 */
router.post(
  '/proposals/:id/verify',
  authorize('ACCOUNTANT'),
  validate({ params: idParams, body: Joi.object({ note: Joi.string().trim().max(1000).allow('', null) }) }),
  async (req, res) => ok(res, await service.verifyProposal(req.user, req.params.id, req.body), 'Đã xác nhận tài chính, chuyển Ban quản trị biểu quyết'),
);

/**
 * @openapi
 * /fund/proposals/{id}/return:
 *   post:
 *     tags: [Quỹ bảo trì]
 *     summary: Kế toán trả lại đề xuất (lý do ≥ 5 ký tự) → Bị trả lại, báo Trưởng BQL sửa và gửi lại
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 */
router.post(
  '/proposals/:id/return',
  authorize('ACCOUNTANT'),
  validate({ params: idParams, body: Joi.object({ reason: Joi.string().trim().min(5).max(1000).required() }) }),
  async (req, res) => ok(res, await service.returnProposal(req.user, req.params.id, req.body), 'Đã trả lại đề xuất cho Trưởng BQL'),
);

/**
 * @openapi
 * /fund/proposals/{id}:
 *   patch:
 *     tags: [Quỹ bảo trì]
 *     summary: Trưởng BQL sửa đề xuất bị trả lại và gửi lại (multipart; ảnh báo giá mới ở field images) → Chờ Kế toán xác nhận
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 */
router.patch(
  '/proposals/:id',
  authorize('MANAGER'),
  uploadImages('images', 5),
  validate({ params: idParams, body: resubmitBody }),
  async (req, res) => ok(res, await service.resubmitProposal(req.user, req.params.id, req.body, req.files), 'Đã gửi lại đề xuất cho Kế toán'),
);

/**
 * @openapi
 * /fund/proposals/{id}/cancel:
 *   post:
 *     tags: [Quỹ bảo trì]
 *     summary: Trưởng BQL rút đề xuất đang xử lý (chờ Kế toán / bị trả lại / chờ biểu quyết) hoặc đã duyệt chưa chi không gắn phiếu (kèm lý do)
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 */
router.post(
  '/proposals/:id/cancel',
  authorize('MANAGER'),
  validate({ params: idParams, body: Joi.object({ reason: Joi.string().trim().min(5).max(500).required() }) }),
  async (req, res) => ok(res, await service.cancelProposal(req.user, req.params.id, req.body), 'Đã rút đề xuất'),
);

/**
 * @openapi
 * /fund/proposals/{id}/board-accept:
 *   post:
 *     tags: [Quỹ bảo trì]
 *     summary: BR-E09 — thành viên Ban quản trị xác nhận nghiệm thu sau Trưởng BQL. Đề xuất gắn phiếu bảo trì → phiếu Hoàn thành, dời lịch thiết bị; sau đó Kế toán lập phiếu chi
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 */
router.post(
  '/proposals/:id/board-accept',
  authorize('BOARD'),
  validate({ params: idParams, body: Joi.object({ note: Joi.string().trim().max(1000).allow('', null) }) }),
  async (req, res) => {
    const p = await service.getProposalLink(req.params.id);
    const result = p.workOrderId
      ? await board.boardAccept(req.user, p.workOrderId, req.body)
      : await service.boardAcceptProposal(req.user, req.params.id, req.body);
    return ok(res, result, 'Đã xác nhận nghiệm thu. Kế toán lập phiếu chi.');
  },
);

/**
 * @openapi
 * /fund/proposals/{id}/board-return:
 *   post:
 *     tags: [Quỹ bảo trì]
 *     summary: BR-E09 — Ban quản trị chưa đồng ý nghiệm thu (lý do ≥ 5 ký tự) → phiếu bảo trì về Đang sửa, biên bản cũ giữ trong lịch sử
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 */
router.post(
  '/proposals/:id/board-return',
  authorize('BOARD'),
  validate({ params: idParams, body: Joi.object({ comment: Joi.string().trim().min(5).max(1000).required() }) }),
  async (req, res) => {
    const p = await service.getProposalLink(req.params.id);
    if (!p.workOrderId) throw ApiError.badRequest('Chỉ trả về được sửa chữa gắn phiếu bảo trì');
    return ok(res, await board.boardReturn(req.user, p.workOrderId, req.body), 'Đã trả về, yêu cầu nhà thầu sửa lại');
  },
);

/**
 * @openapi
 * /fund/proposals/{id}/accept-work:
 *   post:
 *     tags: [Quỹ bảo trì]
 *     summary: Trưởng BQL nghiệm thu hạng mục sửa chữa lớn đã duyệt không gắn phiếu bảo trì — sau đó Ban quản trị xác nhận (board-accept) rồi Kế toán mới lập phiếu chi (M10-3, BR-E09)
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 */
router.post('/proposals/:id/accept-work', authorize('MANAGER'), validate({ params: idParams }), async (req, res) =>
  ok(res, await service.acceptWork(req.user, req.params.id), 'Đã nghiệm thu'),
);

/**
 * @openapi
 * /fund/proposals/{id}/expense:
 *   post:
 *     tags: [Quỹ bảo trì]
 *     summary: Kế toán lập phiếu chi thực tế (multipart; ảnh hóa đơn ở field images), không vượt số được duyệt, thấp hơn phải có varianceReason (BR-F17), trừ số dư không cho âm. Sửa chữa lớn cần Ban quản trị xác nhận nghiệm thu trước. Phiếu chi PCQ-YYYYMM-xxxxx
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 */
router.post(
  '/proposals/:id/expense',
  authorize('ACCOUNTANT'),
  uploadImages('images', 5),
  validate({ params: idParams, body: expenseBody }),
  async (req, res) => {
    const tx = await service.recordExpense(req.user, req.params.id, req.body, req.files);
    return created(res, tx, `Đã lập phiếu chi ${tx.code}`);
  },
);

export default router;

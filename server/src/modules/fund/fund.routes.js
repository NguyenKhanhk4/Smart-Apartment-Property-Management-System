import { Router } from 'express';
import Joi from 'joi';
import { FUND_INCOME_SOURCES, FUND_PLAN_TYPES, FUND_PROPOSAL_STATUS, FUND_TX_TYPES, VOTE_DECISIONS } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { uploadImages } from '../../services/upload.service.js';
import { paginationQuery, sortable } from '../../utils/pagination.js';
import { created, ok, paginated } from '../../utils/response.js';
import { csvEnum, idParams, objectId } from '../../utils/validators.js';
import * as service from './fund.service.js';

// Mô đun 4 — Quỹ bảo trì 2% (UC33 Kế toán, UC34 Ban quản trị). Form có ảnh gửi multipart, field ảnh `images`.
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
});

const expenseBody = Joi.object({
  amount: money().required(),
  occurredAt: Joi.date().iso(),
  documentNo: Joi.string().trim().min(1).max(100).required(),
  description: Joi.string().trim().max(500).allow('', null),
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
 *     summary: UC10 — phiếu bảo trì Trưởng BQL đã duyệt sửa bằng Quỹ, đang chờ Kế toán lập đề xuất chi (chưa có đề xuất đang chờ biểu quyết)
 */
router.get('/work-orders', authorize('ACCOUNTANT', 'MANAGER'), async (_req, res) => ok(res, await service.listAwaitingWorkOrders()));

/**
 * @openapi
 * /fund/work-orders/{id}/prefill:
 *   get:
 *     tags: [Quỹ bảo trì]
 *     summary: Dữ liệu điền sẵn form đề xuất chi từ báo cáo hư hỏng (hạng mục, mô tả, chi phí dự kiến, ảnh). Phiếu không chờ đề xuất → WORKORDER_NOT_AWAITING_FUND / WORKORDER_FUND_PENDING
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 */
router.get('/work-orders/:id/prefill', authorize('ACCOUNTANT'), validate({ params: idParams }), async (req, res) =>
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
 *     summary: Kế toán lập đề xuất chi (multipart; ảnh báo giá ở field images). Kế hoạch năm phải có planRef, đột xuất phải có urgentReason; vượt số dư còn có thể chi → FUND_INSUFFICIENT_BALANCE. Có workOrderId (UC10) thì phiếu phải đang chờ đề xuất, đề xuất là sửa chữa lớn và kèm ảnh hư hỏng. Báo Ban quản trị
 */
router.get(
  '/proposals',
  VIEWERS,
  validate({
    query: Joi.object({
      ...paginationQuery,
      sort: sortable('createdAt', 'amount').default('-createdAt'),
      status: csvEnum(Object.values(FUND_PROPOSAL_STATUS)),
    }),
  }),
  async (req, res) => {
    const { items, pagination } = await service.listProposals(req.validated.query);
    return paginated(res, items, pagination);
  },
);
router.post('/proposals', authorize('ACCOUNTANT'), uploadImages('images', 5), validate({ body: proposalBody }), async (req, res) => {
  const p = await service.createProposal(req.user, req.body, req.files);
  return created(res, p, `Đã gửi đề xuất ${p.code} cho Ban quản trị`);
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
    const msg = r.outcome === 'APPROVED' ? 'Đã biểu quyết — đề xuất đủ tỷ lệ, đã duyệt' : r.outcome === 'REJECTED' ? 'Đã biểu quyết — đề xuất không đạt tỷ lệ' : 'Đã ghi nhận biểu quyết';
    return ok(res, r, msg);
  },
);

/**
 * @openapi
 * /fund/proposals/{id}/cancel:
 *   post:
 *     tags: [Quỹ bảo trì]
 *     summary: Kế toán rút đề xuất đang chờ / đã duyệt chưa chi (kèm lý do)
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 */
router.post(
  '/proposals/:id/cancel',
  authorize('ACCOUNTANT'),
  validate({ params: idParams, body: Joi.object({ reason: Joi.string().trim().min(5).max(500).required() }) }),
  async (req, res) => ok(res, await service.cancelProposal(req.user, req.params.id, req.body), 'Đã rút đề xuất'),
);

/**
 * @openapi
 * /fund/proposals/{id}/accept-work:
 *   post:
 *     tags: [Quỹ bảo trì]
 *     summary: Trưởng BQL nghiệm thu hạng mục sửa chữa lớn đã duyệt — sau đó Kế toán mới lập phiếu chi (M10-3)
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
 *     summary: Kế toán lập phiếu chi thực tế (multipart; ảnh hóa đơn ở field images), không vượt số được duyệt, trừ số dư không cho âm. Phiếu chi PCQ-YYYYMM-xxxxx
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

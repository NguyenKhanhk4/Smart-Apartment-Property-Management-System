import { Router } from 'express';
import Joi from 'joi';
import { CONTACT_METHODS, LEDGER_STATUS } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { paginationQuery } from '../../utils/pagination.js';
import { ok, paginated } from '../../utils/response.js';
import { csvEnum, idParams, objectId, ymd } from '../../utils/validators.js';
import * as cases from './debts.cases.js';
import { checkApartmentDebt } from './debts.check.js';
import * as ledger from './debts.ledger.js';

// Mô đun 4 — UC23 kiểm tra công nợ căn, UC31 sổ công nợ & xử lý nợ quá hạn dài.
const router = Router();
router.use(authenticate);

const STAFF = authorize('ACCOUNTANT', 'MANAGER');

const ledgerQuery = Joi.object({
  ...paginationQuery,
  sort: Joi.string().valid('outstanding', '-outstanding', 'overdueAmount', '-overdueAmount', 'apartmentCode', '-apartmentCode').default('-outstanding'),
  buildingId: objectId(),
  apartmentId: objectId(),
  payerId: objectId(),
  q: Joi.string().trim().max(50).allow(''),
  status: csvEnum(Object.values(LEDGER_STATUS)),
  hasBalance: Joi.boolean(),
});

const activityBody = Joi.object({
  method: Joi.string().valid(...Object.values(CONTACT_METHODS)).required(),
  response: Joi.string().trim().max(1000).allow('', null),
  measures: Joi.string().trim().max(1000).allow('', null),
  note: Joi.string().trim().max(1000).allow('', null),
  promisedDate: ymd().allow(null),
});

/**
 * @openapi
 * /debts/ledger:
 *   get:
 *     tags: [Công nợ]
 *     summary: Sổ công nợ — mỗi dòng là 1 Người nộp phí tại 1 căn. Lọc tòa, căn, mã căn (q), tình trạng CSV (PAID, UNPAID, PARTIALLY_PAID, OVERDUE, LONG_OVERDUE), có Số dư trả trước. Kèm summary (tổng còn nợ, quá hạn, số dư, số dòng theo tình trạng, số giao dịch Cần đối soát)
 */
router.get('/ledger', STAFF, validate({ query: ledgerQuery }), async (req, res) => {
  const { items, pagination, summary } = await ledger.listLedger(req.validated.query);
  return paginated(res, items, pagination, { summary });
});

/**
 * @openapi
 * /debts/apartments/{id}:
 *   get:
 *     tags: [Công nợ]
 *     summary: Sổ công nợ 1 căn — từng Người nộp phí (thông báo đã phát hành, còn nợ, quá hạn, số dư), hồ sơ nợ và nhật ký xử lý, sổ Số dư trả trước, giao dịch Cần đối soát
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 */
router.get('/apartments/:id', STAFF, validate({ params: idParams }), async (req, res) =>
  ok(res, await ledger.getApartmentLedger(req.params.id)),
);

/**
 * @openapi
 * /debts/apartments/{id}/check:
 *   get:
 *     tags: [Công nợ]
 *     summary: UC23 — tổng nợ của căn tại một thời điểm (mặc định hiện tại), tách theo Người nộp phí; nợ ròng = còn nợ − Số dư trả trước của chính người đó. Dùng cho chuyển nhượng và sổ công nợ
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: query, name: at, schema: { type: string, format: date-time } }
 */
router.get(
  '/apartments/:id/check',
  STAFF,
  validate({ params: idParams, query: Joi.object({ at: Joi.date().iso() }) }),
  async (req, res) => ok(res, await checkApartmentDebt(req.params.id, { at: req.validated.query.at })),
);

/**
 * @openapi
 * /debts/cases/{id}:
 *   get:
 *     tags: [Công nợ]
 *     summary: Hồ sơ nợ quá hạn (các lần nhắc, nhật ký xử lý, ngày hẹn trả)
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 */
router.get('/cases/:id', STAFF, validate({ params: idParams }), async (req, res) => ok(res, await cases.getCase(req.params.id)));

/**
 * @openapi
 * /debts/cases/{id}/activities:
 *   post:
 *     tags: [Công nợ]
 *     summary: Trưởng BQL ghi kết quả xử lý nợ (hình thức liên hệ, phản hồi, biện pháp đã áp dụng, ngày hẹn trả). Có ngày hẹn → tạm dừng nhắc tự động đến hết ngày đó; quá hẹn mà chưa trả đủ hệ thống báo lại 1 lần
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [method]
 *             properties:
 *               method: { type: string, enum: [PHONE, SMS, EMAIL, IN_PERSON, LETTER] }
 *               response: { type: string }
 *               measures: { type: string }
 *               note: { type: string }
 *               promisedDate: { type: string, example: '2026-11-20' }
 */
router.post(
  '/cases/:id/activities',
  authorize('MANAGER'),
  validate({ params: idParams, body: activityBody }),
  async (req, res) => ok(res, await cases.recordActivity(req.user, req.params.id, req.body), 'Đã ghi kết quả xử lý nợ'),
);

/**
 * @openapi
 * /debts/cases/{id}/notice.pdf:
 *   get:
 *     tags: [Công nợ]
 *     summary: PDF Thông báo nợ quá hạn (các kỳ còn nợ, số tiền, các lần đã nhắc và liên hệ) — dùng khi Người nộp phí từ chối / không liên lạc được
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 */
router.get('/cases/:id/notice.pdf', STAFF, validate({ params: idParams }), async (req, res) => {
  const file = await cases.buildDebtNotice(req.user, req.params.id);
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.send(file.buffer);
});

export default router;

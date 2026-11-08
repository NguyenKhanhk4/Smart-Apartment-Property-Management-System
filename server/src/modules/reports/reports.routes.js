import { Router } from 'express';
import Joi from 'joi';
import { FEE_CATEGORIES, LEDGER_STATUS, values } from '../../constants/enums.js';
import { hasPermission } from '../../middlewares/authorize.js';
import { sendFile } from '../../services/export.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { ok } from '../../utils/response.js';
import { periodStart, vnPeriod } from '../../utils/time.js';
import { csvEnum, objectId, period } from '../../utils/validators.js';
import { exportReport } from './reports.export.js';
import * as reports from './reports.service.js';
import { financeDashboard, supervisionReport } from './finance.service.js';

const router = Router();
router.use(authenticate);

// Mặc định: từ đầu năm hiện tại (giờ VN) đến nay
const vnYear = () => vnPeriod().slice(0, 4);
const yearStart = () => periodStart(`${vnYear()}-01`);
const periodQuery = {
  from: period().default(() => `${vnYear()}-01`),
  to: period().default(() => vnPeriod()),
  buildingId: objectId(),
};
const dateQuery = {
  from: Joi.date().default(yearStart),
  to: Joi.date().default(() => new Date()),
  buildingId: objectId(),
};
const q = (req) => req.validated.query;

/**
 * @openapi
 * /reports/billing-summary:
 *   get:
 *     tags: [Báo cáo]
 *     summary: Báo cáo tổng hợp thu phí lũy kế (UC-E10) — Manager, Accountant, Board
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, example: '2026-01' } }
 *       - { in: query, name: to, schema: { type: string, example: '2026-10' } }
 *       - { in: query, name: buildingId, schema: { type: string } }
 *       - { in: query, name: feeCategory, schema: { type: string, enum: [CLEANING, PARKING, AMENITY, ADJUSTMENT] } }
 */
router.get(
  '/billing-summary',
  authorize('MANAGER', 'ACCOUNTANT', 'BOARD'),
  validate({
    query: Joi.object({ ...periodQuery, feeCategory: Joi.string().valid(...values(FEE_CATEGORIES)) }),
  }),
  async (req, res) => ok(res, await reports.billingSummary(q(req))),
);

/**
 * @openapi
 * /reports/debts:
 *   get:
 *     tags: [Báo cáo]
 *     summary: Công nợ quá hạn theo căn hộ (nguồn xuất báo cáo debts — UC-E13)
 */
router.get(
  '/debts',
  authorize('MANAGER', 'ACCOUNTANT', 'BOARD'),
  validate({ query: Joi.object({ buildingId: objectId() }) }),
  async (req, res) => ok(res, await reports.debtReport(q(req))),
);

/**
 * @openapi
 * /reports/fund:
 *   get:
 *     tags: [Báo cáo]
 *     summary: Dashboard quỹ bảo trì (UC-E11) — Manager, Board
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 */
router.get(
  '/fund',
  authorize('MANAGER', 'BOARD'),
  validate({ query: Joi.object({ from: dateQuery.from, to: dateQuery.to }) }),
  async (req, res) => ok(res, await reports.fundDashboard(q(req))),
);

/**
 * @openapi
 * /reports/occupancy:
 *   get:
 *     tags: [Báo cáo]
 *     summary: Tỷ lệ lấp đầy căn hộ theo tòa (UC-E12) — Manager
 * /reports/tickets:
 *   get:
 *     tags: [Báo cáo]
 *     summary: Thống kê phản ánh, thời gian xử lý, đánh giá KTV (UC-E12) — Manager
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 * /reports/maintenance:
 *   get:
 *     tags: [Báo cáo]
 *     summary: Thống kê work order + tài sản sắp đến hạn (UC-E12) — Manager
 */
router.get(
  '/occupancy',
  authorize('MANAGER'),
  validate({ query: Joi.object({ buildingId: objectId() }) }),
  async (req, res) => ok(res, await reports.occupancyReport(q(req))),
);

router.get(
  '/tickets',
  authorize('MANAGER'),
  validate({ query: Joi.object(dateQuery) }),
  async (req, res) => ok(res, await reports.ticketReport(q(req))),
);

router.get(
  '/maintenance',
  authorize('MANAGER'),
  validate({ query: Joi.object(dateQuery) }),
  async (req, res) => ok(res, await reports.maintenanceReport(q(req))),
);

/**
 * @openapi
 * /reports/amenity-usage:
 *   get:
 *     tags: [Báo cáo]
 *     summary: Thống kê sử dụng tiện ích (UC-E14) — chỉ Trưởng BQL (SRS 2.3 Dashboard & Reports, UC60)
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *       - { in: query, name: amenityId, schema: { type: string } }
 */
router.get(
  '/amenity-usage',
  authorize('MANAGER'),
  validate({ query: Joi.object({ from: dateQuery.from, to: dateQuery.to, amenityId: objectId() }) }),
  async (req, res) => ok(res, await reports.amenityUsage(q(req))),
);

/**
 * @openapi
 * /reports/finance:
 *   get:
 *     tags: [Báo cáo]
 *     summary: Dashboard tài chính (UC60) — thu theo tháng / hình thức, cơ cấu phí, tỷ lệ căn còn nợ, tiện ích trả ngay, Quỹ bảo trì. from/to dạng YYYY-MM
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, example: '2026-01' } }
 *       - { in: query, name: to, schema: { type: string, example: '2026-11' } }
 */
router.get(
  '/finance',
  authorize('MANAGER', 'ACCOUNTANT'),
  validate({ query: Joi.object({ from: periodQuery.from, to: periodQuery.to }) }),
  async (req, res) => ok(res, await financeDashboard(q(req))),
);

/**
 * @openapi
 * /reports/supervision:
 *   get:
 *     tags: [Báo cáo]
 *     summary: Báo cáo giám sát cho Ban quản trị — Quỹ bảo trì (số dư, thu chi, đề xuất), tình hình thu phí, chất lượng xử lý sự cố. Không có công nợ từng căn
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, example: '2026-01' } }
 *       - { in: query, name: to, schema: { type: string, example: '2026-11' } }
 */
router.get(
  '/supervision',
  authorize('BOARD', 'MANAGER'),
  validate({ query: Joi.object({ from: periodQuery.from, to: periodQuery.to }) }),
  async (req, res) => ok(res, await supervisionReport(q(req))),
);

// Loại báo cáo xuất được theo vai trò; Ban quản trị chỉ xuất phần giám sát (5.6)
const PERIOD_TYPES = ['billing', 'finance', 'supervision'];
const BOARD_EXPORTS = ['supervision', 'fund', 'billing'];

/**
 * @openapi
 * /reports/export:
 *   get:
 *     tags: [Báo cáo]
 *     summary: Xuất báo cáo Excel/PDF (UC-E13) — Manager, Accountant
 *     description: |
 *       billing / finance / supervision dùng from/to dạng YYYY-MM; fund / operations / amenity dùng from/to dạng ngày;
 *       debts, ledger (sổ công nợ, lọc status CSV) không cần from/to. Ban quản trị chỉ xuất supervision, fund, billing.
 *     parameters:
 *       - { in: query, name: type, required: true, schema: { type: string, enum: [billing, debts, fund, operations, amenity, finance, supervision, ledger] } }
 *       - { in: query, name: format, required: true, schema: { type: string, enum: [xlsx, pdf] } }
 *       - { in: query, name: from, schema: { type: string } }
 *       - { in: query, name: to, schema: { type: string } }
 *     responses:
 *       200: { description: File tải về }
 */
router.get(
  '/export',
  authorize('MANAGER', 'ACCOUNTANT', 'BOARD'),
  validate({
    query: Joi.object({
      type: Joi.string().valid('billing', 'debts', 'fund', 'operations', 'amenity', 'finance', 'supervision', 'ledger').required(),
      format: Joi.string().valid('xlsx', 'pdf').required(),
      from: Joi.when('type', { is: Joi.valid(...PERIOD_TYPES), then: periodQuery.from, otherwise: dateQuery.from }),
      to: Joi.when('type', { is: Joi.valid(...PERIOD_TYPES), then: periodQuery.to, otherwise: dateQuery.to }),
      buildingId: objectId(),
      feeCategory: Joi.string().valid(...values(FEE_CATEGORIES)),
      amenityId: objectId(),
      status: csvEnum(Object.values(LEDGER_STATUS)),
    }),
  }),
  async (req, res) => {
    const { type, format, ...filters } = q(req);
    if (hasPermission(req.user, ['BOARD']) && !BOARD_EXPORTS.includes(type)) {
      throw ApiError.forbidden('Ban quản trị chỉ xuất được báo cáo giám sát, quỹ bảo trì và tổng hợp thu phí');
    }
    sendFile(res, await exportReport(type, format, filters));
  },
);

export default router;

import { Router } from 'express';
import Joi from 'joi';
import { FEE_CATEGORIES, values } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { ok } from '../../utils/response.js';
import { periodStart, vnPeriod } from '../../utils/time.js';
import { objectId, period } from '../../utils/validators.js';
import { exportReport } from './reports.export.js';
import * as reports from './reports.service.js';

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
 *     summary: Thống kê sử dụng tiện ích (UC-E14) — Manager, Accountant
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *       - { in: query, name: amenityId, schema: { type: string } }
 */
router.get(
  '/amenity-usage',
  authorize('MANAGER', 'ACCOUNTANT'),
  validate({ query: Joi.object({ from: dateQuery.from, to: dateQuery.to, amenityId: objectId() }) }),
  async (req, res) => ok(res, await reports.amenityUsage(q(req))),
);

/**
 * @openapi
 * /reports/export:
 *   get:
 *     tags: [Báo cáo]
 *     summary: Xuất báo cáo Excel/PDF (UC-E13) — Manager, Accountant
 *     description: |
 *       type=billing dùng from/to dạng YYYY-MM; fund/operations/amenity dùng from/to dạng ngày; debts không cần from/to.
 *     parameters:
 *       - { in: query, name: type, required: true, schema: { type: string, enum: [billing, debts, fund, operations, amenity] } }
 *       - { in: query, name: format, required: true, schema: { type: string, enum: [xlsx, pdf] } }
 *       - { in: query, name: from, schema: { type: string } }
 *       - { in: query, name: to, schema: { type: string } }
 *     responses:
 *       200: { description: File tải về }
 */
router.get(
  '/export',
  authorize('MANAGER', 'ACCOUNTANT'),
  validate({
    query: Joi.object({
      type: Joi.string().valid('billing', 'debts', 'fund', 'operations', 'amenity').required(),
      format: Joi.string().valid('xlsx', 'pdf').required(),
      from: Joi.when('type', { is: 'billing', then: periodQuery.from, otherwise: dateQuery.from }),
      to: Joi.when('type', { is: 'billing', then: periodQuery.to, otherwise: dateQuery.to }),
      buildingId: objectId(),
      feeCategory: Joi.string().valid(...values(FEE_CATEGORIES)),
      amenityId: objectId(),
    }),
  }),
  async (req, res) => {
    const { type, format, ...filters } = q(req);
    const file = await exportReport(type, format, filters);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(file.buffer);
  },
);

export default router;

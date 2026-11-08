import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { sendFile } from '../../services/export.service.js';
import { ok, paginated } from '../../utils/response.js';
import { auditExportQuery, auditQuery } from './auditLogs.rules.js';
import { exportAuditLogs, getAuditOptions, listAuditLogs } from './auditLogs.service.js';

const router = Router();
router.use(authenticate, authorize('MANAGER', 'BOARD'));

/**
 * @openapi
 * /audit-logs/options:
 *   get:
 *     tags: [Audit log]
 *     summary: Bộ lọc audit theo quyền người đọc
 */
router.get('/options', (req, res) => ok(res, getAuditOptions(req.user)));

/**
 * @openapi
 * /audit-logs:
 *   get:
 *     tags: [Audit log]
 *     summary: Nhật ký chỉ đọc; BQT chỉ xem tài chính (UC-C08, BR-X2)
 *     parameters:
 *       - { in: query, name: action, schema: { type: string } }
 *       - { in: query, name: q, schema: { type: string }, description: Tên người thực hiện }
 *       - { in: query, name: performedBy, schema: { type: string } }
 *       - { in: query, name: targetType, schema: { type: string } }
 *       - { in: query, name: targetId, schema: { type: string } }
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 */
/**
 * @openapi
 * /audit-logs/export:
 *   get:
 *     tags: [Audit log]
 *     summary: Xuất nhật ký Excel / PDF theo đúng bộ lọc đang xem (UC06 bước 5, UC65, BR-D02)
 *     description: Không có dòng nào → 404 NO_DATA (MSG-D01). Quá 5000 dòng → 400, yêu cầu thu hẹp bộ lọc.
 *     parameters:
 *       - { in: query, name: format, required: true, schema: { type: string, enum: [xlsx, pdf] } }
 *       - { in: query, name: action, schema: { type: string } }
 *       - { in: query, name: q, schema: { type: string } }
 *       - { in: query, name: targetType, schema: { type: string } }
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: File tải về }
 */
router.get('/export', validate({ query: auditExportQuery }), async (req, res) => {
  sendFile(res, await exportAuditLogs(req.user, req.validated.query));
});

router.get('/', validate({ query: auditQuery }), async (req, res) => {
  const { items, pagination } = await listAuditLogs(req.user, req.validated.query);
  paginated(res, items, pagination);
});

export default router;

import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { ok, paginated } from '../../utils/response.js';
import { auditQuery } from './auditLogs.rules.js';
import { getAuditOptions, listAuditLogs } from './auditLogs.service.js';

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
router.get('/', validate({ query: auditQuery }), async (req, res) => {
  const { items, pagination } = await listAuditLogs(req.user, req.validated.query);
  paginated(res, items, pagination);
});

export default router;

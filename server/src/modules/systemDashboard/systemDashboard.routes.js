import { Router } from 'express';
import { ROLES } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { ok } from '../../utils/response.js';
import * as service from './systemDashboard.service.js';

// Module A — Vũ Việt. UC-A11: Dashboard thống kê hệ thống dành cho Trưởng BQL
const router = Router();

/**
 * @openapi
 * /system-dashboard:
 *   get:
 *     tags: [Dashboard hệ thống]
 *     summary: Thống kê số liệu hệ thống dành cho Trưởng BQL — UC-A11
 *     responses:
 *       200:
 *         description: Dữ liệu thống kê hệ thống (tài khoản, cơ sở, cron jobs, audit log)
 *       403:
 *         description: Chỉ Trưởng BQL mới có quyền truy cập
 */
router.get(
  '/',
  authenticate,
  authorize(ROLES.MANAGER),
  async (_req, res) => {
    const data = await service.getDashboard();
    ok(res, data);
  },
);

export default router;

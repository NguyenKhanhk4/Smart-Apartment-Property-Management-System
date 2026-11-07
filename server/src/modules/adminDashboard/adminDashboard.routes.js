import { Router } from 'express';
import { ROLES } from '../../constants/enums.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { ok } from '../../utils/response.js';
import * as service from './adminDashboard.service.js';

// Module A — Vũ Việt. UC-A11: Dashboard thống kê hệ thống dành cho Admin
const router = Router();

/**
 * @openapi
 * /admin/dashboard:
 *   get:
 *     tags: [Admin]
 *     summary: Thống kê số liệu hệ thống dành cho Admin — UC-A11
 *     responses:
 *       200:
 *         description: Dữ liệu thống kê hệ thống (tài khoản, cơ sở, cron jobs, audit log)
 *       403:
 *         description: Chỉ quản trị viên (ADMIN) mới có quyền truy cập
 */
router.get(
  '/dashboard',
  authenticate,
  authorize(ROLES.ADMIN),
  async (_req, res) => {
    const data = await service.getDashboard();
    ok(res, data);
  },
);

export default router;

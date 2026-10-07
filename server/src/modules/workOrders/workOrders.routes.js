import { Router } from 'express';
import { CRON_JOBS } from '../../constants/enums.js';
import { runTrackedJob } from '../../jobs/cronRunner.js';
import { authenticate } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { ok } from '../../utils/response.js';
import { generateMaintenanceWorkOrders } from './workOrders.jobs.js';

// Module D — Thanh Bình. UC-D02: Tự động tạo work order khi tài sản đến hạn bảo trì.
// (Danh sách / phân công / xử lý work order là các bước sau.)
const router = Router();

/**
 * @openapi
 * /work-orders/jobs/generate/run:
 *   post:
 *     tags: [Tài sản & bảo trì]
 *     summary: Chạy thủ công cron quét tài sản đến hạn và tạo work order bảo trì định kỳ (UC-D02), ghi cron_runs
 *     description: Trả về bản ghi cron_runs; affectedCount = số work order mới tạo.
 */
router.post('/jobs/generate/run', authenticate, authorize('MANAGER', 'ADMIN'), async (_req, res) =>
  ok(
    res,
    await runTrackedJob(CRON_JOBS.WORK_ORDER_GENERATE, () => generateMaintenanceWorkOrders(), {
      trigger: 'MANUAL',
    }),
  ),
);

export default router;

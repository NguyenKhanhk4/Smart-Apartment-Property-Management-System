import { Router } from 'express';
import { dbStatus } from './config/db.js';
import { ok } from './utils/response.js';

const router = Router();

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [System]
 *     summary: Kiểm tra server và kết nối database
 *     security: []
 *     responses:
 *       200:
 *         description: Server đang chạy
 */
router.get('/health', (_req, res) => {
  ok(res, { status: 'ok', db: dbStatus(), time: new Date().toISOString() });
});

// Mỗi module gắn router của mình tại đây, một dòng một module:
// import buildingRoutes from './modules/buildings/buildings.routes.js';
// router.use('/buildings', buildingRoutes);

export default router;

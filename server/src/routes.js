import { Router } from 'express';
import { dbStatus } from './config/db.js';
import { env } from './config/env.js';
import { ok } from './utils/response.js';
import complaintCategoryRoutes from './modules/complaintCategories/complaintCategories.routes.js';
import systemConfigRoutes from './modules/systemConfigs/systemConfigs.routes.js';
import ticketRoutes from './modules/tickets/tickets.routes.js';
import guestRoutes from './modules/guests/guests.routes.js';
import announcementRoutes from './modules/announcements/announcements.routes.js';
import notificationRoutes from './modules/notifications/notifications.routes.js';
import reportRoutes from './modules/reports/reports.routes.js';
import lookupRoutes from './modules/lookups/lookups.routes.js';
import assetRoutes from './modules/assets/assets.routes.js';
import workOrderRoutes from './modules/workOrders/workOrders.routes.js';
import devAuthRoutes from './modules/devAuth/devAuth.routes.js';

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

// Module E — Phạm Lượng (Ticket, Sổ khách, Bảng tin & Thông báo, Báo cáo)
router.use('/complaint-categories', complaintCategoryRoutes);
router.use('/system-configs', systemConfigRoutes);
router.use('/tickets', ticketRoutes);
router.use('/guests', guestRoutes);
router.use('/announcements', announcementRoutes);
router.use('/notifications', notificationRoutes);
router.use('/reports', reportRoutes);
router.use('/lookups', lookupRoutes);

// Module D — Thanh Bình (Tài sản & bảo trì, Tiện ích & đặt chỗ)
router.use('/assets', assetRoutes);
router.use('/work-orders', workOrderRoutes);

// Chỉ môi trường dev: đăng nhập nhanh bằng tài khoản seed (xem modules/devAuth). Xóa khi Module A có /auth/login.
if (env.isDev) router.use('/dev', devAuthRoutes);

export default router;

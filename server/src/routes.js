import { Router } from 'express';
import { dbStatus } from './config/db.js';
import { env } from './config/env.js';
import { ok } from './utils/response.js';
<<<<<<< HEAD
import { authLimiter } from './middlewares/rateLimit.js';
=======
>>>>>>> origin/minh
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
import amenityRoutes from './modules/amenities/amenities.routes.js';
import memberCodeRoutes from './modules/memberCodes/memberCodes.routes.js';
import amenityPassRoutes from './modules/amenityPasses/amenityPasses.routes.js';
import bookingRoutes from './modules/bookings/bookings.routes.js';
<<<<<<< HEAD
import amenityVisitRoutes from './modules/amenityVisits/amenityVisits.routes.js';
=======
>>>>>>> origin/minh
import devAuthRoutes from './modules/devAuth/devAuth.routes.js';
import authRoutes from './modules/auth/auth.routes.js';
import userRoutes from './modules/users/users.routes.js';
import buildingRoutes from './modules/buildings/buildings.routes.js';
import apartmentRoutes from './modules/apartments/apartments.routes.js';
import contractRoutes from './modules/contracts/contracts.routes.js';
import residentRoutes from './modules/residents/residents.routes.js';
import vehicleRoutes from './modules/vehicles/vehicles.routes.js';
<<<<<<< HEAD
import systemDashboardRoutes from './modules/systemDashboard/systemDashboard.routes.js';
import feeTypeRoutes from './modules/feeTypes/feeTypes.routes.js';
import invoiceRoutes from './modules/invoices/invoices.routes.js';
import paymentRoutes from './modules/payments/payments.routes.js';
import gatePassRoutes, { platesRouter } from './modules/gatePasses/gatePasses.routes.js';
import parkingCardRoutes from './modules/parkingCards/parkingCards.routes.js';
import dutyShiftRoutes from './modules/dutyShifts/dutyShifts.routes.js';
=======
import adminDashboardRoutes from './modules/adminDashboard/adminDashboard.routes.js';
>>>>>>> origin/minh

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

<<<<<<< HEAD
// Người 1 — Vũ Việt (Mô đun 10: Thiết bị & bảo trì)
router.use('/assets', assetRoutes);
router.use('/work-orders', workOrderRoutes);

// Module D — Thanh Bình (Tiện ích & đặt chỗ)
=======
// Module D — Thanh Bình (Tài sản & bảo trì, Tiện ích & đặt chỗ)
router.use('/assets', assetRoutes);
router.use('/work-orders', workOrderRoutes);
>>>>>>> origin/minh
router.use('/amenities', amenityRoutes);
router.use('/member-codes', memberCodeRoutes);
router.use('/amenity-passes', amenityPassRoutes);
router.use('/bookings', bookingRoutes);
<<<<<<< HEAD
router.use('/amenity-visits', amenityVisitRoutes);

// Module A — Vũ Việt (Tài khoản, Tòa nhà, Căn hộ, Hợp đồng, Cư dân, Phương tiện)
router.use('/auth', authLimiter, authRoutes);
=======

// Module A — Vũ Việt (Tài khoản, Tòa nhà, Căn hộ, Hợp đồng, Cư dân, Phương tiện)
router.use('/auth', authRoutes);
>>>>>>> origin/minh
router.use('/users', userRoutes);
router.use('/buildings', buildingRoutes);
router.use('/apartments', apartmentRoutes);
router.use('/contracts', contractRoutes);
router.use('/residents', residentRoutes);
router.use('/vehicles', vehicleRoutes);
<<<<<<< HEAD
router.use('/system-dashboard', systemDashboardRoutes);
router.use('/gate-passes', gatePassRoutes);
router.use('/plates', platesRouter);
router.use('/parking-cards', parkingCardRoutes);

// Module B — Phí, Hóa đơn, Thanh toán, Công nợ
router.use('/fee-types', feeTypeRoutes);
router.use('/invoices', invoiceRoutes);
router.use('/payments', paymentRoutes);

// Người 4 — Sự cố & Tiện ích (lịch ca trực)
router.use('/duty-shifts', dutyShiftRoutes);

// Đăng nhập nhanh không mật khẩu: chỉ khi NODE_ENV=development và ENABLE_DEV_AUTH khác false (xem modules/devAuth).
if (env.devAuthEnabled) router.use('/dev', devAuthRoutes);
=======
router.use('/admin', adminDashboardRoutes);

// Chỉ phục vụ đăng nhập nhanh khi dev (xem modules/devAuth).
if (env.isDev) router.use('/dev', devAuthRoutes);
>>>>>>> origin/minh

export default router;

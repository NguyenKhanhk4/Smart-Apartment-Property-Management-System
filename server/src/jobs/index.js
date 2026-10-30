import cron from 'node-cron';
import { env } from '../config/env.js';
import { CRON_JOBS } from '../constants/enums.js';
import { runTrackedJob } from './cronRunner.js';
import { generateMaintenanceWorkOrders } from '../modules/workOrders/workOrders.jobs.js';
import { autoCloseTickets, escalateOverdueTickets } from '../modules/tickets/tickets.jobs.js';
import { expireLeases } from '../modules/contracts/contracts.jobs.js';
import { generateMonthlyInvoices, markOverdueInvoices } from '../modules/invoices/invoices.jobs.js';
import { completeBookings } from '../modules/bookings/bookings.jobs.js';
import { expireGatePasses } from '../modules/gatePasses/gatePasses.jobs.js';
import { remindExpiringLeases } from '../modules/contracts/contracts.jobs.js';

/**
 * Đăng ký mọi cron job (node-cron, múi giờ Asia/Ho_Chi_Minh — srs_final.md §2.4).
 * Module khác thêm job của mình vào mảng này:
 *   { name: CRON_JOBS.INVOICE_GENERATE, schedule: '30 0 1 * *', handler: generateMonthlyInvoices }
 */
export const JOBS = [
  // UC-E06 / BR-O8 — 09:00 hằng ngày
  { name: CRON_JOBS.TICKET_ESCALATE, schedule: '0 9 * * *', handler: escalateOverdueTickets },
  // BR-O9 — 01:00 hằng ngày tự đóng ticket chờ xác nhận quá hạn
  { name: CRON_JOBS.TICKET_AUTO_CLOSE, schedule: '0 1 * * *', handler: autoCloseTickets },
  // UC-D02 / BR-O6 — 02:00 hằng ngày tạo work order bảo trì định kỳ cho tài sản đến hạn
  { name: CRON_JOBS.WORK_ORDER_GENERATE, schedule: '0 2 * * *', handler: generateMaintenanceWorkOrders },
  // UC-A06 / BR-O2 — 00:00 hằng ngày kiểm tra và chuyển hợp đồng thuê hết hạn
  { name: CRON_JOBS.CONTRACT_EXPIRE, schedule: '0 0 * * *', handler: expireLeases },
  // UC-B02 — 00:30 ngày 1 hằng tháng sinh hóa đơn kỳ mới
  { name: CRON_JOBS.INVOICE_GENERATE, schedule: '30 0 1 * *', handler: generateMonthlyInvoices },
  // BR-F8 — 00:15 hằng ngày chuyển hóa đơn quá hạn thanh toán sang OVERDUE
  { name: CRON_JOBS.INVOICE_OVERDUE, schedule: '15 0 * * *', handler: markOverdueInvoices },
  // BR-O5 / BR-O14 — mỗi 5 phút: booking quá giờ check-in → NO_SHOW, đã dùng xong → COMPLETED
  { name: CRON_JOBS.BOOKING_COMPLETE, schedule: '*/5 * * * *', handler: completeBookings },
  // UC52 — mỗi 15 phút kiểm tra và chuyển đơn Gate Pass quá hạn sang EXPIRED
  { name: CRON_JOBS.GATE_PASS_EXPIRE, schedule: '*/15 * * * *', handler: expireGatePasses },
  // UC19 — 00:30 hằng ngày nhắc trước 15 ngày hợp đồng thuê sắp hết hạn
  { name: CRON_JOBS.CONTRACT_EXPIRY_REMIND, schedule: '30 0 * * *', handler: remindExpiringLeases },
];

export function startJobs() {
  if (!env.enableCron) return;
  for (const job of JOBS) {
    cron.schedule(job.schedule, () => runTrackedJob(job.name, job.handler), {
      timezone: env.timezone,
      name: job.name,
      noOverlap: true, // lần chạy trước chưa xong thì bỏ lượt này (job */5, */15)
    });
  }
  console.log(`⏰ Cron: đã đăng ký ${JOBS.length} job (${env.timezone})`);
}

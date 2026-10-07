import cron from 'node-cron';
import { env } from '../config/env.js';
import { CRON_JOBS } from '../constants/enums.js';
import { runTrackedJob } from './cronRunner.js';
import { generateMaintenanceWorkOrders } from '../modules/workOrders/workOrders.jobs.js';
import { autoCloseTickets, escalateOverdueTickets } from '../modules/tickets/tickets.jobs.js';

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
];

export function startJobs() {
  if (!env.enableCron) return;
  for (const job of JOBS) {
    cron.schedule(job.schedule, () => runTrackedJob(job.name, job.handler), {
      timezone: env.timezone,
      name: job.name,
    });
  }
  console.log(`⏰ Cron: đã đăng ký ${JOBS.length} job (${env.timezone})`);
}

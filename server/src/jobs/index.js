// Đăng ký cron toàn hệ thống và lịch nhắc khách, bưu kiện, tuần tra, cảnh báo khẩn Module 7.
import cron from 'node-cron';
import { runOperationsJobs } from '../modules/guests/guests.service.js';
import { env } from '../config/env.js';
import { CRON_JOBS } from '../constants/enums.js';
import { runTrackedJob } from './cronRunner.js';
import { generateMaintenanceWorkOrders, warnEquipment } from '../modules/workOrders/workOrders.jobs.js';
import { remindPostponedRepairs } from '../modules/workOrders/workOrders.decision.js';
import { alertSlaBreaches, autoCloseTickets, escalateOverdueTickets } from '../modules/tickets/tickets.jobs.js';
import { expireLeases } from '../modules/contracts/contracts.jobs.js';
import { billingReminders, markOverdueInvoices } from '../modules/invoices/invoices.jobs.js';
import { completeBookings, expireBookingHolds } from '../modules/bookings/bookings.jobs.js';
import { expireGatePasses } from '../modules/gatePasses/gatePasses.jobs.js';
import { remindExpiringLeases } from '../modules/contracts/contracts.jobs.js';
import { reconcilePayosPayments } from '../modules/payments/payments.payos.js';
import { remindDebts } from '../modules/debts/debts.jobs.js';
import { remindQuotes } from '../modules/repairQuotes/repairQuotes.service.js';
import { remindProposals } from '../modules/fund/fund.service.js';

/**
 * Đăng ký mọi cron job (node-cron, múi giờ Asia/Ho_Chi_Minh — srs_final.md §2.4).
 * Module khác thêm job của mình vào mảng này:
 *   { name: CRON_JOBS.BILLING_REMIND, schedule: '0 8 * * *', handler: billingReminders }
 */
export const JOBS = [
  { name: CRON_JOBS.OPERATIONS_SECURITY, schedule: '* * * * *', handler: runOperationsJobs },
  // UC-E06 / BR-O8 — 09:00 hằng ngày
  { name: CRON_JOBS.TICKET_ESCALATE, schedule: '0 9 * * *', handler: escalateOverdueTickets },
  // Người 4 — mỗi 5 phút cảnh báo sự cố quá hạn nhận / phản ánh quá hạn phản hồi
  { name: CRON_JOBS.TICKET_SLA_ALERT, schedule: '*/5 * * * *', handler: alertSlaBreaches },
  // BR-O9 — 01:00 hằng ngày tự đóng ticket chờ xác nhận quá hạn
  { name: CRON_JOBS.TICKET_AUTO_CLOSE, schedule: '0 1 * * *', handler: autoCloseTickets },
  // UC-D02 / BR-O6 — 02:00 hằng ngày tạo work order bảo trì định kỳ cho tài sản đến hạn
  // UC07, BR-E03: 01:00 tạo phiếu bảo trì đến hạn (kèm bản sao checklist), báo khi cả ngày không có ca kỹ thuật
  { name: CRON_JOBS.WORK_ORDER_GENERATE, schedule: '0 1 * * *', handler: generateMaintenanceWorkOrders },
  // UC07, BR-E07: 07:00 cảnh báo phiếu bảo trì quá hạn, thiết bị sắp hết bảo hành (MSG-E08)
  { name: CRON_JOBS.EQUIPMENT_WARNING, schedule: '0 7 * * *', handler: warnEquipment },
  // UC10: 07:05 nhắc Trưởng BQL xem lại phiếu tạm hoãn sửa đã tới ngày, lặp mỗi N ngày (MSG-E12)
  { name: CRON_JOBS.REPAIR_REVIEW, schedule: '5 7 * * *', handler: remindPostponedRepairs },
  // UC-A06 / BR-O2 — 00:00 hằng ngày kiểm tra và chuyển hợp đồng thuê hết hạn
  { name: CRON_JOBS.CONTRACT_EXPIRE, schedule: '0 0 * * *', handler: expireLeases },
  // Mô đun 4 — 08:00 hằng ngày: đến ngày cấu hình thì nhắc Kế toán tính phí; nhắc Trưởng BQL thông báo chờ duyệt quá N ngày (không tự duyệt)
  { name: CRON_JOBS.BILLING_REMIND, schedule: '0 8 * * *', handler: billingReminders },
  // BR-F8 — 00:15 hằng ngày chuyển hóa đơn quá hạn thanh toán sang OVERDUE
  { name: CRON_JOBS.INVOICE_OVERDUE, schedule: '15 0 * * *', handler: markOverdueInvoices },
  // UC31 — 08:30 hằng ngày nhắc nợ quá hạn (N ngày/lần, tối đa M lần → Nợ quá hạn dài báo Trưởng BQL); quá ngày hẹn trả → báo lại
  { name: CRON_JOBS.DEBT_REMIND, schedule: '30 8 * * *', handler: remindDebts },
  // UC48 — mỗi giờ (phút 20): báo giá sửa chữa chờ quá N ngày → nhắc Người nộp phí; quá M ngày → tự đóng phiếu (X8)
  { name: CRON_JOBS.QUOTE_REMIND, schedule: '20 * * * *', handler: remindQuotes },
  // UC34 — 09:00 hằng ngày: đề xuất chi quỹ chờ quá N ngày → nhắc Ban quản trị chưa bỏ phiếu + báo Trưởng BQL (không tự duyệt)
  { name: CRON_JOBS.FUND_PROPOSAL_REMIND, schedule: '0 9 * * *', handler: remindProposals },
  // UC29 — mỗi 5 phút hỏi payOS các giao dịch còn chờ (phòng webhook không về); quá 15 phút chưa rõ → Cần đối soát
  { name: CRON_JOBS.PAYMENT_RECONCILE, schedule: '*/5 * * * *', handler: reconcilePayosPayments },
  // BR-O5 / BR-O14 — mỗi 5 phút: booking quá giờ check-in → NO_SHOW, đã dùng xong → COMPLETED
  { name: CRON_JOBS.BOOKING_COMPLETE, schedule: '*/5 * * * *', handler: completeBookings },
  // Người 4 — mỗi phút hủy giữ chỗ quá hạn thanh toán (chỉ có tác dụng khi BOOKING_PAYMENT_HOLD_MINUTES > 0)
  { name: CRON_JOBS.BOOKING_HOLD_EXPIRE, schedule: '* * * * *', handler: expireBookingHolds },
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

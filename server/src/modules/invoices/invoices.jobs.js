import { CONFIG_KEYS, INVOICE_STATUS, NOTIFICATION_TYPES } from '../../constants/enums.js';

// Đã phát hành, chưa trả đủ, chưa bị đánh dấu quá hạn
const DUE_STATUSES = [INVOICE_STATUS.UNPAID, INVOICE_STATUS.PARTIALLY_PAID];
import { Invoice } from '../../models/index.js';
import { notifyRoles } from '../../services/notification.service.js';
import { getConfig } from '../../services/systemConfig.service.js';
import { remindPendingApprovals } from './invoices.approval.js';
import { periodLabel, startOfVnDay, toVnYmd, vnPeriod } from '../../utils/time.js';

/**
 * Mô đun 4 — hằng ngày 08:00: đến ngày BILLING_REMIND_DAY mà kỳ hiện tại chưa tính phí → nhắc Kế toán bấm "Tính phí".
 * Hệ thống không tự tính phí (Kế toán chạy, Trưởng BQL duyệt). Trả về số người được nhắc.
 */
export async function remindBilling(now = new Date()) {
  const day = await getConfig(CONFIG_KEYS.BILLING_REMIND_DAY);
  if (Number(toVnYmd(now).slice(8, 10)) !== day) return 0;

  const period = vnPeriod(now);
  if (await Invoice.exists({ period, status: { $ne: INVOICE_STATUS.CANCELLED } })) return 0; // đã tính (ít nhất 1 căn)

  return notifyRoles(['ACCOUNTANT'], {
    type: NOTIFICATION_TYPES.INVOICE_APPROVAL,
    title: `Đến kỳ tính phí tháng ${periodLabel(period)}`,
    content: `Đã đến ngày tính phí kỳ ${periodLabel(period)}. Vào "Tính phí" để tạo thông báo phí Nháp và trình duyệt.`,
    link: '/app/invoices/generate',
  });
}

/** Cron BILLING_REMIND 08:00: nhắc Kế toán đến kỳ tính phí + nhắc Trưởng BQL thông báo chờ duyệt quá hạn (X8) */
export async function billingReminders(now = new Date()) {
  return (await remindBilling(now)) + (await remindPendingApprovals(now));
}

/**
 * BR-F8 — hằng ngày: thông báo đã phát hành, chưa trả đủ, có hạn đóng trước 00:00 hôm nay (giờ VN) → OVERDUE.
 * Hạn là ngày cuối được trả, nên thông báo hạn hôm nay chưa quá hạn. Cập nhật có điều kiện status nên chạy lại an toàn.
 */
export async function markOverdueInvoices(now = new Date()) {
  const res = await Invoice.updateMany(
    { status: { $in: DUE_STATUSES }, dueDate: { $lt: startOfVnDay(now) } },
    { $set: { status: INVOICE_STATUS.OVERDUE } },
  );
  return res.modifiedCount;
}

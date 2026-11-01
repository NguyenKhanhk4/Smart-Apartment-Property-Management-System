import { CONFIG_KEYS, INVOICE_STATUS, NOTIFICATION_TYPES } from '../../constants/enums.js';
import { Invoice } from '../../models/index.js';
import { notifyRoles } from '../../services/notification.service.js';
import { getConfig } from '../../services/systemConfig.service.js';
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

/**
 * BR-F8 — hằng ngày: thông báo đã phát hành, chưa trả đủ, có hạn đóng trước 00:00 hôm nay (giờ VN) → OVERDUE.
 * Hạn là ngày cuối được trả, nên thông báo hạn hôm nay chưa quá hạn. Cập nhật có điều kiện status nên chạy lại an toàn.
 */
export async function markOverdueInvoices(now = new Date()) {
  const res = await Invoice.updateMany(
    { status: INVOICE_STATUS.UNPAID, dueDate: { $lt: startOfVnDay(now) } },
    { $set: { status: INVOICE_STATUS.OVERDUE } },
  );
  return res.modifiedCount;
}

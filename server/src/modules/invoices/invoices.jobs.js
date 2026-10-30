import { INVOICE_STATUS } from '../../constants/enums.js';
import { Invoice } from '../../models/index.js';
import { startOfVnDay, vnPeriod } from '../../utils/time.js';
import { generateForPeriod, toJobResult } from './invoices.service.js';

/**
 * UC-B02 — 00:30 ngày 1 hằng tháng: lập hóa đơn kỳ hiện tại (giờ VN) cho mọi căn có hợp đồng mua bán hiệu lực.
 * Một căn lỗi không làm hỏng cả đợt: cron_runs ghi FAILED kèm danh sách căn lỗi nhưng vẫn giữ số hóa đơn đã lập.
 */
export async function generateMonthlyInvoices({ period = vnPeriod(), now = new Date() } = {}) {
  return toJobResult(await generateForPeriod({ period, now }));
}

/**
 * BR-F8 — hằng ngày: hóa đơn UNPAID có hạn thanh toán trước 00:00 hôm nay (giờ VN) → OVERDUE.
 * Hạn là ngày cuối được trả, nên hóa đơn hạn hôm nay chưa quá hạn. Cập nhật có điều kiện status nên chạy lại an toàn.
 */
export async function markOverdueInvoices(now = new Date()) {
  const res = await Invoice.updateMany(
    { status: INVOICE_STATUS.UNPAID, dueDate: { $lt: startOfVnDay(now) } },
    { $set: { status: INVOICE_STATUS.OVERDUE } },
  );
  return res.modifiedCount;
}

import { vnPeriod } from '../../utils/time.js';
import { assertNoFailures, generateForPeriod } from './invoices.service.js';

/**
 * UC-B02 — 00:30 ngày 1 hằng tháng: lập hóa đơn kỳ hiện tại (giờ VN) cho mọi căn có hợp đồng mua bán hiệu lực.
 * Trả về số hóa đơn đã lập; có căn lỗi thì throw sau khi lập xong các căn khác để cron_runs ghi FAILED kèm danh sách.
 */
export async function generateMonthlyInvoices({ period = vnPeriod(), now = new Date() } = {}) {
  const summary = await generateForPeriod({ period, now });
  assertNoFailures(summary);
  return summary.created;
}

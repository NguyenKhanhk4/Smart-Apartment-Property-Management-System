// BR-F8: căn có hóa đơn quá hạn bị chặn đặt tiện ích và mua vé / gói tháng có phí.
// Dùng chung cho mua gói tháng (UC-D09), đặt chỗ (UC-D06) và vé lẻ (UC-D10).
import { INVOICE_STATUS } from '../../constants/enums.js';
import { Invoice } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * Căn có hóa đơn quá hạn không? Tính cả hóa đơn UNPAID đã qua hạn mà cron quá hạn (INVOICE_OVERDUE) chưa kịp
 * chuyển trạng thái, để việc chặn không phụ thuộc giờ chạy cron.
 */
export function hasOverdueInvoice(apartmentId, now = new Date()) {
  return Invoice.exists({
    apartmentId,
    $or: [{ status: INVOICE_STATUS.OVERDUE }, { status: INVOICE_STATUS.UNPAID, dueDate: { $lt: now } }],
  }).then(Boolean);
}

/** Ném BOOKING_APARTMENT_OVERDUE (409) nếu căn đang có hóa đơn quá hạn */
export async function assertNoOverdue(apartmentId, now = new Date()) {
  if (await hasOverdueInvoice(apartmentId, now)) throw new ApiError('BOOKING_APARTMENT_OVERDUE');
}

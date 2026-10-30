// Cron BOOKING_COMPLETE — khép lại booking đã qua giờ (BR-O5, BR-O14):
//  - APPROVED quá startAt + NO_SHOW_GRACE_MINUTES mà chưa check-in → NO_SHOW (vẫn tính phí, BR-O16);
//  - CHECKED_IN đã tới endAt → COMPLETED.
// PENDING_PAYMENT không xử lý ở đây (job hủy giữ chỗ quá hạn thanh toán lo).
import { BOOKING_STATUS } from '../../constants/enums.js';
import { Booking } from '../../models/index.js';
import { addMinutes } from '../../utils/time.js';
import { getBookingConfig } from '../amenities/slot.utils.js';

/** Trả về số booking đã chuyển trạng thái. Cập nhật có điều kiện status nên chạy chồng / chạy lại an toàn. */
export async function completeBookings(now = new Date()) {
  const { noShowGraceMinutes } = await getBookingConfig();
  const [noShow, completed] = await Promise.all([
    Booking.updateMany(
      { status: BOOKING_STATUS.APPROVED, startAt: { $lt: addMinutes(now, -noShowGraceMinutes) } },
      { $set: { status: BOOKING_STATUS.NO_SHOW, noShowAt: now } },
    ),
    Booking.updateMany(
      { status: BOOKING_STATUS.CHECKED_IN, endAt: { $lte: now } },
      { $set: { status: BOOKING_STATUS.COMPLETED, completedAt: now } },
    ),
  ]);
  return noShow.modifiedCount + completed.modifiedCount;
}

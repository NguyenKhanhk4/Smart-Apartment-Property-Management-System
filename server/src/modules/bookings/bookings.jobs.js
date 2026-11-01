// Cron BOOKING_COMPLETE — khép lại booking đã qua giờ (BR-O5, BR-O14):
//  - APPROVED quá startAt + NO_SHOW_GRACE_MINUTES mà chưa check-in → NO_SHOW (vẫn tính phí, BR-O16);
//  - CHECKED_IN đã tới endAt → COMPLETED.
// PENDING_PAYMENT không xử lý ở đây (job hủy giữ chỗ quá hạn thanh toán lo).
import { BOOKING_STATUS, NOTIFICATION_TYPES } from '../../constants/enums.js';
import { Booking } from '../../models/index.js';
import { notify } from '../../services/notification.service.js';
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

/**
 * [Cron mỗi phút] BOOKING_HOLD_EXPIRE (Người 4): giữ chỗ chờ thanh toán quá holdExpiresAt → CANCELLED, trả slot cho người khác.
 * Cập nhật có điều kiện từng booking nên trùng với lúc thanh toán / cư dân hủy chỉ một bên thắng. Trả về số booking đã hủy.
 */
export async function expireBookingHolds(now = new Date()) {
  const expired = await Booking.find({ status: BOOKING_STATUS.PENDING_PAYMENT, holdExpiresAt: { $lte: now } })
    .select('_id bookedBy slotStart slotEnd')
    .lean();
  let affected = 0;
  for (const booking of expired) {
    const res = await Booking.updateOne(
      { _id: booking._id, status: BOOKING_STATUS.PENDING_PAYMENT },
      { $set: { status: BOOKING_STATUS.CANCELLED, cancelledAt: now, cancelReason: 'Quá hạn giữ chỗ chờ thanh toán' } },
    );
    if (!res.modifiedCount) continue;
    affected += 1;
    await notify(booking.bookedBy, {
      type: NOTIFICATION_TYPES.BOOKING,
      title: 'Đã hủy giữ chỗ tiện ích',
      content: `Khung ${booking.slotStart}–${booking.slotEnd} đã hết thời gian giữ chỗ mà chưa thanh toán. Bạn có thể đặt lại nếu còn chỗ.`,
      refId: booking._id,
      link: '/r/amenities/bookings',
    });
  }
  return affected;
}

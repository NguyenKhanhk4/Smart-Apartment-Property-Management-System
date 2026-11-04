// Giữ chỗ chờ thanh toán (Người 4) — logic thuần. Bật bằng tham số BOOKING_PAYMENT_HOLD_MINUTES > 0 (mặc định 0 = tắt,
// phí gộp vào hóa đơn tháng như cũ). Thanh toán qua cổng (Người 3) hoặc Lễ tân thu tại quầy → confirmBookingPayment.
import { MINUTE_MS } from '../../utils/time.js';

/**
 * Hạn giữ chỗ của booking mới, hoặc null nếu không cần chờ thanh toán: tắt giữ chỗ, miễn phí,
 * Lễ tân đặt hộ (thu tại quầy / gộp hóa đơn) hoặc đã thanh toán trước (đổi lịch booking đã trả).
 */
export function holdExpiry({ fee, holdMinutes, byStaff, prepaid = false, now = new Date() }) {
  if (!(fee > 0) || !(holdMinutes > 0) || byStaff || prepaid) return null;
  return new Date(now.getTime() + holdMinutes * MINUTE_MS);
}

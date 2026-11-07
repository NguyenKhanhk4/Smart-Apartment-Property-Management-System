// Giữ chỗ chờ thanh toán (Mô đun 6): tiện ích có phí giữ chỗ BOOKING_PAYMENT_HOLD_MINUTES (15) phút chờ trả qua payOS,
// quá hạn thì tự hủy. Tắt (0) hoặc chưa cấu hình payOS thì phí gộp vào thông báo phí tháng.
import { MINUTE_MS } from '../../utils/time.js';

export const HOLD_EXPIRED_REASON = 'Quá hạn giữ chỗ chờ thanh toán';

/**
 * Hạn giữ chỗ của booking mới, hoặc null nếu không cần chờ thanh toán: tắt giữ chỗ, chưa có cổng thanh toán, miễn phí,
 * Lễ tân đặt hộ (thu tại quầy / gộp hóa đơn) hoặc đã thanh toán trước (đổi lịch booking đã trả).
 */
export function holdExpiry({ fee, holdMinutes, byStaff, prepaid = false, gateway = true, now = new Date() }) {
  if (!(fee > 0) || !(holdMinutes > 0) || !gateway || byStaff || prepaid) return null;
  return new Date(now.getTime() + holdMinutes * MINUTE_MS);
}

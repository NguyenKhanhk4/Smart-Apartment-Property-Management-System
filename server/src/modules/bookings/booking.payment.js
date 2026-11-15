// Giữ chỗ chờ thanh toán (Mô đun 6): tiện ích có phí giữ chỗ BOOKING_PAYMENT_HOLD_MINUTES (15) phút chờ trả qua payOS,
// quá hạn thì tự hủy. Tắt (0) hoặc chưa cấu hình payOS thì phí gộp vào thông báo phí tháng.
import { BOOKING_PAYMENT_METHODS as PAY, CONFIG_KEYS } from '../../constants/enums.js';
import { getConfig } from '../../services/systemConfig.service.js';
import { MINUTE_MS } from '../../utils/time.js';
import { isPayosEnabled } from '../payments/payos.client.js';

export const HOLD_EXPIRED_REASON = 'Quá hạn giữ chỗ chờ thanh toán';

/**
 * NGUỒN DUY NHẤT quyết định cách trả phí tiện ích: thanh toán online chỉ bật khi BOOKING_PAYMENT_HOLD_MINUTES > 0 (DB)
 * VÀ đã cấu hình payOS (.env). Server dùng hàm này ở mọi chỗ; client chỉ hiển thị theo kết quả trả về (rules).
 * @returns {{ online: boolean, holdMinutes: number, options: string[], defaultMethod: string }}
 */
export async function getPaymentSetup() {
  const holdMinutes = Number(await getConfig(CONFIG_KEYS.BOOKING_PAYMENT_HOLD_MINUTES)) || 0;
  const online = holdMinutes > 0 && isPayosEnabled();
  const options = online ? [PAY.ONLINE, PAY.INVOICE] : [PAY.INVOICE];
  return { online, holdMinutes, options, defaultMethod: options[0] };
}

/**
 * Hạn giữ chỗ của booking mới, hoặc null nếu không cần chờ thanh toán: tắt giữ chỗ, chưa có cổng thanh toán, miễn phí,
 * Lễ tân đặt hộ (thu tại quầy / gộp hóa đơn) hoặc đã thanh toán trước (đổi lịch booking đã trả).
 */
export function holdExpiry({ fee, holdMinutes, byStaff, prepaid = false, gateway = true, now = new Date() }) {
  if (!(fee > 0) || !(holdMinutes > 0) || !gateway || byStaff || prepaid) return null;
  return new Date(now.getTime() + holdMinutes * MINUTE_MS);
}

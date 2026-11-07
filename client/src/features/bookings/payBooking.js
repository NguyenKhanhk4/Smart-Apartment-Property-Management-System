import { bookingApi } from '../../api/moduleD.api';

/** Tạo link payOS cho booking đang giữ chỗ rồi chuyển sang trang thanh toán payOS */
export async function payBooking(id) {
  const { data } = await bookingApi.payos(id);
  window.location.assign(data.checkoutUrl);
}

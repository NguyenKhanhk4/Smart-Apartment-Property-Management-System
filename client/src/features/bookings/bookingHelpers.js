// Helper booking phía cư dân (Người 4) — hàm thuần để test bằng node:test.
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const vnHHmm = (date) => new Date(new Date(date).getTime() + VN_OFFSET_MS).toISOString().slice(11, 16);

/** "Giữ chỗ đến 09:12 · còn 12 phút" cho booking chờ thanh toán (giờ VN, không phụ thuộc múi giờ máy) */
export function holdLabel(holdExpiresAt, now = new Date()) {
  if (!holdExpiresAt) return '';
  const left = new Date(holdExpiresAt).getTime() - new Date(now).getTime();
  if (left <= 0) return 'Đã hết thời gian giữ chỗ';
  const minutes = Math.floor(left / 60_000);
  return `Giữ chỗ đến ${vnHHmm(holdExpiresAt)} · ${minutes < 1 ? 'còn dưới 1 phút' : `còn ${minutes} phút`}`;
}

/**
 * Slot đổi lịch được từ lưới GET /amenities/:id/slots: còn trống, khác slot đang đặt (khi cùng ngày).
 * Slot đang đặt bị khóa ALREADY_BOOKED nên tự rơi ra; giữ điều kiện sameDay cho chắc.
 */
export function rescheduleOptions(slots, { slotStart, sameDay }) {
  return slots
    .filter((s) => s.available && !(sameDay && s.slotStart === slotStart))
    .map((s) => ({ value: s.slotStart, label: `${s.slotStart}–${s.slotEnd} · còn ${s.remaining} chỗ` }));
}

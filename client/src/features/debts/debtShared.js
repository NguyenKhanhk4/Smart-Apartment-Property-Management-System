// Dùng chung cho các trang công nợ (UC31)
import { formatDate } from '../../utils/format';

/** Mô tả ngắn hồ sơ nợ đang mở: số lần đã nhắc, Nợ quá hạn dài từ ngày nào, ngày hẹn trả */
export function caseHint(c) {
  if (!c) return '';
  const parts = [];
  if (c.promisedDate) parts.push(`Hẹn trả ${formatDate(c.promisedDate)}`);
  if (c.status === 'LONG_OVERDUE') parts.push(`Nợ dài từ ${formatDate(c.longOverdueAt)}`);
  else if (c.reminderCount) parts.push(`Đã nhắc ${c.reminderCount} lần, gần nhất ${formatDate(c.lastRemindedAt)}`);
  else parts.push('Chưa nhắc');
  return parts.join(' · ');
}

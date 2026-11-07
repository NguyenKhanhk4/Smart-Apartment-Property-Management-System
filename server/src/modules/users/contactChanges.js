// Ghi lại và báo cho người dùng khi SĐT (tên đăng nhập) hoặc email (kênh khôi phục mật khẩu) bị đổi.
// Ai đổi trái phép thì chủ tài khoản biết ngay để liên hệ quầy lễ tân.
import { AUDIT_ACTIONS, AUDIT_TARGETS, NOTIFICATION_TYPES } from '../../constants/enums.js';
import { logAudit } from '../../services/auditLog.service.js';
import { sendMail } from '../../services/mail.service.js';
import { notify } from '../../services/notification.service.js';
import { maskEmail } from './userLookup.js';

export const maskPhone = (phone) => (phone ? `${'*'.repeat(Math.max(phone.length - 3, 0))}${phone.slice(-3)}` : null);

/**
 * field: 'phone' | 'email'. Gọi SAU khi đã lưu. actor: người thực hiện (chính người dùng, Lễ tân, Trưởng BQL).
 */
export async function recordContactChange({ actor, user, field, before, after, ip }) {
  const isPhone = field === 'phone';
  const mask = isPhone ? maskPhone : maskEmail;
  await logAudit({
    action: isPhone ? AUDIT_ACTIONS.PHONE_CHANGED : AUDIT_ACTIONS.EMAIL_CHANGED,
    user: actor,
    targetType: AUDIT_TARGETS.USER,
    targetId: user._id,
    metadata: { from: mask(before), to: mask(after) },
    ip,
  });

  const what = isPhone
    ? `Số điện thoại đăng nhập SAPMS của bạn đã đổi sang ${maskPhone(after)}. Từ nay bạn đăng nhập bằng số mới.`
    : `Email tài khoản SAPMS của bạn đã ${after ? `đổi sang ${maskEmail(after)}` : 'bị xóa'}.`;
  const warning = 'Nếu không phải bạn thực hiện, hãy mang CCCD đến quầy lễ tân ngay.';

  await notify(user._id, { type: NOTIFICATION_TYPES.SYSTEM, title: 'Thông tin đăng nhập đã thay đổi', content: `${what} ${warning}` });
  // Đổi email: báo về email CŨ, vì kẻ xấu đổi sang email của họ thì email mới không có ý nghĩa cảnh báo
  const mailTo = isPhone ? user.email : before;
  if (mailTo) await sendMail({ to: mailTo, subject: '[SAPMS] Thông tin đăng nhập đã thay đổi', text: `${what}\n${warning}` });
}

import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let transporter = null;

function getTransporter() {
  if (!env.smtp.enabled) return null;
  transporter ??= nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: { user: env.smtp.user, pass: env.smtp.pass },
  });
  return transporter;
}

/**
 * Gửi email (Nodemailer + Gmail app password). Chưa cấu hình SMTP thì chỉ ghi log và trả false.
 * Không bao giờ throw — lỗi email không được làm hỏng nghiệp vụ chính.
 */
export async function sendMail({ to, subject, text, html }) {
  const recipients = [to].flat().filter(Boolean);
  if (!recipients.length) return false;

  const tx = getTransporter();
  if (!tx) {
    if (!env.isTest) console.log(`[mail:disabled] → ${recipients.join(', ')} | ${subject}`);
    return false;
  }

  try {
    await tx.sendMail({ from: env.smtp.from, bcc: recipients, subject, text, html });
    return true;
  } catch (err) {
    console.error('[mail] gửi thất bại:', err.message);
    return false;
  }
}

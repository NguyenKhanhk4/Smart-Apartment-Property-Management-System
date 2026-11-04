// Vé QR đặt tiện ích (Người 4): "BK1.<bookingId>.<chữ ký>" — HMAC-SHA256 cắt 16 byte, base64url.
// Không lưu token trong DB; đổi JWT_ACCESS_SECRET thì mọi vé cũ hết hiệu lực (cư dân mở lại vé là có mã mới).
import crypto from 'node:crypto';
import { env } from '../../config/env.js';

const PREFIX = 'BK1';
const OBJECT_ID = /^[0-9a-f]{24}$/;

let cachedKey = null;
/** Khóa riêng cho vé QR, tách từ JWT secret bằng HKDF (không dùng thẳng secret đăng nhập) */
function qrKey() {
  cachedKey ??= Buffer.from(crypto.hkdfSync('sha256', env.jwt.accessSecret, '', 'sapms-booking-qr', 32));
  return cachedKey;
}

const sign = (id, key) => crypto.createHmac('sha256', key).update(`${PREFIX}.${id}`).digest().subarray(0, 16).toString('base64url');

export const signBookingQr = (bookingId, key = qrKey()) => `${PREFIX}.${bookingId}.${sign(String(bookingId), key)}`;

/** bookingId nếu token hợp lệ, ngược lại null */
export function verifyBookingQr(token, key = qrKey()) {
  if (typeof token !== 'string') return null;
  const [prefix, id, sig, ...rest] = token.trim().split('.');
  if (prefix !== PREFIX || !OBJECT_ID.test(id ?? '') || !sig || rest.length) return null;
  const expected = Buffer.from(sign(id, key));
  const given = Buffer.from(sig);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected) ? id : null;
}

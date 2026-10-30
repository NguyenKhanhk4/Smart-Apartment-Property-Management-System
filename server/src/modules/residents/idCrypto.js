import crypto from 'node:crypto';
import { env } from '../../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
// Khóa dev/test cố định khi chưa cấu hình ID_ENCRYPTION_KEY (production bắt buộc có — config/env.js kiểm tra)
const DEV_SEED = 'sapms-dev-id-key';

let keys = null;

/**
 * Khóa gốc = ID_ENCRYPTION_KEY (32 byte); tách 2 khóa con bằng HKDF để mã hóa (AES) và băm tìm kiếm (HMAC)
 * không dùng chung một khóa. Không còn phụ thuộc JWT secret: đổi JWT secret không làm mất dữ liệu CCCD.
 */
function getKeys() {
  if (keys) return keys;
  const master = env.idEncryptionKey ?? crypto.createHash('sha256').update(DEV_SEED).digest();
  const derive = (info) => Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), info, 32));
  keys = { aes: derive('sapms-id-aes'), hmac: derive('sapms-id-hmac'), legacy: legacyKeys() };
  return keys;
}

/**
 * Khóa của cách mã hóa cũ (1 khóa cho cả AES lẫn HMAC): ID_ENCRYPTION_KEY thô (base64 32 byte hoặc sha256 chuỗi),
 * hoặc sha256(JWT_ACCESS_SECRET) khi thiếu. Chỉ dùng để ĐỌC dữ liệu cũ.
 */
function legacyKeys() {
  const sha = (text) => crypto.createHash('sha256').update(text).digest();
  const out = [];
  const raw = process.env.ID_ENCRYPTION_KEY?.trim();
  if (raw) {
    const buf = Buffer.from(raw, 'base64');
    out.push(buf.length === 32 ? buf : sha(raw));
  }
  if (env.jwt?.accessSecret) out.push(sha(env.jwt.accessSecret));
  out.push(sha('sapms-default-id-encryption-seed'));
  return out.filter((k, i) => out.findIndex((x) => x.equals(k)) === i);
}

const clean = (plain) => (plain === null || plain === undefined ? '' : String(plain).trim());

function decryptWith(key, [iv, authTag, encrypted]) {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
}

/**
 * Mã hóa số CCCD bằng AES-256-GCM (trả về chuỗi "iv:authTag:cipherText" dạng base64)
 */
export function encryptIdNumber(plain) {
  const cleaned = clean(plain);
  if (!cleaned) return null;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKeys().aes, iv);
  const encrypted = Buffer.concat([cipher.update(cleaned, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Giải mã số CCCD từ chuỗi AES-256-GCM. Thử khóa hiện tại trước, sau đó các khóa cũ (dữ liệu trước khi tách khóa).
 */
export function decryptIdNumber(cipherText) {
  if (!cipherText || typeof cipherText !== 'string') return null;
  const parts = cipherText.split(':');
  if (parts.length !== 3) return null;

  const { aes, legacy } = getKeys();
  for (const key of [aes, ...legacy]) {
    try {
      return decryptWith(key, parts);
    } catch {
      // sai khóa → GCM báo lỗi xác thực, thử khóa tiếp theo
    }
  }
  return null;
}

/**
 * Băm HMAC-SHA256 số CCCD để tìm kiếm hoặc chống trùng mà không cần giải mã
 */
export function hashIdNumber(plain) {
  const cleaned = clean(plain);
  if (!cleaned) return null;
  return crypto.createHmac('sha256', getKeys().hmac).update(cleaned).digest('hex');
}

/**
 * Mọi hash có thể của 1 số CCCD (khóa hiện tại + khóa cũ) — dùng cho truy vấn `idNumberHash: { $in: ... }`
 * để vẫn tìm ra bản ghi lưu trước khi tách khóa.
 */
export function idNumberHashCandidates(plain) {
  const cleaned = clean(plain);
  if (!cleaned) return [];
  const legacy = getKeys().legacy.map((key) => crypto.createHmac('sha256', key).update(cleaned).digest('hex'));
  return [...new Set([hashIdNumber(cleaned), ...legacy])];
}

/**
 * Che số CCCD khi hiển thị, chỉ giữ lại 4 số cuối (VD: ********1234)
 */
export function maskIdNumber(plain) {
  if (!plain) return null;
  const cleaned = String(plain).trim();
  if (!cleaned) return null;
  if (cleaned.length <= 4) return '*'.repeat(cleaned.length);
  return `${'*'.repeat(cleaned.length - 4)}${cleaned.slice(-4)}`;
}

/**
 * Tiện ích đóng gói các trường lưu DB cho CCCD từ chuỗi đầu vào
 */
export function buildIdNumberFields(plain) {
  if (plain === null || plain === undefined || !String(plain).trim()) {
    return {
      idNumber: null,
      idNumberEnc: null,
      idNumberHash: null,
    };
  }
  const cleaned = String(plain).trim();
  return {
    idNumber: null,
    idNumberEnc: encryptIdNumber(cleaned),
    idNumberHash: hashIdNumber(cleaned),
  };
}

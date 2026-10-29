import crypto from 'node:crypto';
import { env } from '../../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

let cachedKey = null;

function getEncryptionKey() {
  if (cachedKey) return cachedKey;

  const rawKey = process.env.ID_ENCRYPTION_KEY?.trim();
  if (rawKey) {
    const buf = Buffer.from(rawKey, 'base64');
    if (buf.length === 32) {
      cachedKey = buf;
      return cachedKey;
    }
    cachedKey = crypto.createHash('sha256').update(rawKey).digest();
    return cachedKey;
  }

  // Fallback dev/test key derived from JWT_ACCESS_SECRET so server works out-of-the-box in dev/test
  const fallbackSeed = env.jwt?.accessSecret || 'sapms-default-id-encryption-seed';
  cachedKey = crypto.createHash('sha256').update(fallbackSeed).digest();
  return cachedKey;
}

/**
 * Mã hóa số CCCD bằng AES-256-GCM (trả về chuỗi "iv:authTag:cipherText" dạng base64)
 */
export function encryptIdNumber(plain) {
  if (plain === null || plain === undefined) return null;
  const cleaned = String(plain).trim();
  if (!cleaned) return null;

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(cleaned, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Giải mã số CCCD từ chuỗi AES-256-GCM
 */
export function decryptIdNumber(cipherText) {
  if (!cipherText || typeof cipherText !== 'string') return null;
  const parts = cipherText.split(':');
  if (parts.length !== 3) return null;

  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    const encrypted = Buffer.from(parts[2], 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Băm HMAC-SHA256 số CCCD để tìm kiếm hoặc chống trùng mà không cần giải mã
 */
export function hashIdNumber(plain) {
  if (plain === null || plain === undefined) return null;
  const cleaned = String(plain).trim();
  if (!cleaned) return null;

  const key = getEncryptionKey();
  return crypto.createHmac('sha256', key).update(cleaned).digest('hex');
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

// Mã hóa CCCD: khóa riêng (không phụ thuộc JWT secret), tách khóa AES / HMAC, vẫn đọc được dữ liệu mã hóa bằng khóa cũ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { env } from '../../src/config/env.js';
import {
  buildIdNumberFields,
  decryptIdNumber,
  encryptIdNumber,
  hashIdNumber,
  idNumberHashCandidates,
} from '../../src/modules/residents/idCrypto.js';

const CCCD = '012345678901';

// Định dạng cũ: 1 khóa dùng chung cho AES lẫn HMAC, khi thiếu ID_ENCRYPTION_KEY thì sha256(JWT_ACCESS_SECRET)
const legacyKey = () => {
  const raw = process.env.ID_ENCRYPTION_KEY?.trim();
  if (raw) {
    const buf = Buffer.from(raw, 'base64');
    return buf.length === 32 ? buf : crypto.createHash('sha256').update(raw).digest();
  }
  return crypto.createHash('sha256').update(env.jwt.accessSecret).digest();
};
function legacyEncrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', legacyKey(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}
const legacyHash = (plain) => crypto.createHmac('sha256', legacyKey()).update(plain).digest('hex');

test('mã hóa / giải mã khứ hồi, mỗi lần mã hóa ra chuỗi khác nhau', () => {
  const a = encryptIdNumber(CCCD);
  assert.notEqual(a, encryptIdNumber(CCCD));
  assert.equal(decryptIdNumber(a), CCCD);
  assert.equal(encryptIdNumber('  '), null);
  assert.equal(decryptIdNumber('rác'), null);
});

test('hash ổn định để tìm kiếm, và không dùng chung khóa với mã hóa cũ', () => {
  assert.equal(hashIdNumber(CCCD), hashIdNumber(` ${CCCD} `));
  assert.notEqual(hashIdNumber(CCCD), legacyHash(CCCD));
});

test('không còn phụ thuộc JWT secret: khóa không đổi khi đổi JWT_ACCESS_SECRET', () => {
  const before = hashIdNumber(CCCD);
  const old = env.jwt.accessSecret;
  env.jwt.accessSecret = 'secret-khac-hoan-toan-123456';
  try {
    assert.equal(hashIdNumber(CCCD), before);
  } finally {
    env.jwt.accessSecret = old;
  }
});

test('dữ liệu mã hóa bằng khóa cũ vẫn giải mã được', () => {
  assert.equal(decryptIdNumber(legacyEncrypt(CCCD)), CCCD);
});

test('tìm kiếm theo CCCD khớp cả hash mới và hash cũ', () => {
  const candidates = idNumberHashCandidates(CCCD);
  assert.ok(candidates.includes(hashIdNumber(CCCD)));
  assert.ok(candidates.includes(legacyHash(CCCD)));
  assert.deepEqual(idNumberHashCandidates(''), []);
});

test('buildIdNumberFields không lưu CCCD gốc', () => {
  const f = buildIdNumberFields(CCCD);
  assert.equal(f.idNumber, null);
  assert.equal(decryptIdNumber(f.idNumberEnc), CCCD);
  assert.equal(f.idNumberHash, hashIdNumber(CCCD));
});

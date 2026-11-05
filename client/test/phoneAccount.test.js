// Xác nhận tài khoản theo SĐT trước khi gắn vào căn hộ (BR-X5): chưa xác nhận thì không được lưu
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, phoneAccountState } from '../src/utils/phone.js';

const PHONE = '0912345678';
const resident = { phone: PHONE, exists: true, isResident: true, userId: 'u1', fullName: 'Nguyễn Văn A' };
const state = (extra) => phoneAccountState({ phone: PHONE, loading: false, confirmedUserId: null, ...extra });

test('normalizePhone: khớp cách chuẩn hóa của server', () => {
  assert.equal(normalizePhone('+84912345678'), PHONE);
  assert.equal(normalizePhone('84912345678'), PHONE);
  assert.equal(normalizePhone(` ${PHONE} `), PHONE);
});

test('SĐT trống hoặc sai định dạng: chưa kiểm tra, để rule của form báo lỗi', () => {
  for (const phone of [undefined, '', '123']) {
    assert.deepEqual(state({ phone }), { status: 'idle', isExisting: false, blockReason: null });
  }
});

test('đang tra hoặc tra lỗi: chưa được lưu', () => {
  assert.equal(state({ loading: true }).status, 'checking');
  assert.ok(state({ loading: true }).blockReason);
  assert.equal(state({ error: new Error('x') }).status, 'error');
  assert.ok(state({ error: new Error('x') }).blockReason);
});

test('kết quả của số trước đó không được dùng cho số đang nhập', () => {
  const stale = state({ phone: '0912345679', account: resident, confirmedUserId: 'u1' });
  assert.equal(stale.status, 'checking');
  assert.equal(stale.userId, undefined);
  assert.ok(stale.blockReason);
});

test('số viết kiểu +84 vẫn khớp kết quả đã chuẩn hóa', () => {
  assert.equal(state({ phone: '+84912345678', account: resident }).status, 'existing');
});

test('chưa có tài khoản: được lưu, nhập đủ thông tin', () => {
  const s = state({ account: { phone: PHONE, exists: false } });
  assert.equal(s.status, 'new');
  assert.equal(s.isExisting, false);
  assert.equal(s.blockReason, null);
});

test('tài khoản nội bộ: không được lưu', () => {
  const s = state({ account: { phone: PHONE, exists: true, isResident: false } });
  assert.equal(s.status, 'internal');
  assert.ok(s.blockReason);
});

test('tài khoản có sẵn: phải xác nhận đúng người mới được lưu và có userId', () => {
  const pending = state({ account: resident });
  assert.equal(pending.status, 'existing');
  assert.ok(pending.blockReason);
  assert.equal(pending.userId, undefined);

  const confirmed = state({ account: resident, confirmedUserId: 'u1' });
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.blockReason, null);
  assert.equal(confirmed.userId, 'u1');
});

test('xác nhận cho tài khoản khác không có hiệu lực', () => {
  assert.equal(state({ account: resident, confirmedUserId: 'u2' }).status, 'existing');
});

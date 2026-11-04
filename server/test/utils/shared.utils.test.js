// Helper dùng chung thay cho các bản sao rải rác trong module (giờ VN, định dạng, Joi rule, lỗi theo field).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MINUTE_MS,
  VN_OFFSET_MS,
  addMinutes,
  fmtDateTimeVn,
  fmtDateVn,
  fmtTimeVn,
  periodLabel,
  toVnYmd,
  vnDayStart,
  vnHHmm,
} from '../../src/utils/time.js';
import { hhmm, phoneVn, ymd } from '../../src/utils/validators.js';
import { ApiError } from '../../src/utils/ApiError.js';
import { isRole } from '../../src/middlewares/authorize.js';
import { generateTemporaryPassword } from '../../src/utils/password.js';

test('hằng số thời gian', () => {
  assert.equal(MINUTE_MS, 60_000);
  assert.equal(VN_OFFSET_MS, 7 * 3_600_000);
});

test('toVnYmd / vnDayStart: 23:30 UTC là ngày hôm sau ở VN', () => {
  assert.equal(toVnYmd(new Date('2026-10-31T23:30:00Z')), '2026-11-01');
  assert.equal(vnDayStart('2026-11-01').toISOString(), '2026-10-31T17:00:00.000Z');
  assert.throws(() => vnDayStart('01/11/2026'));
});

test('vnHHmm / addMinutes', () => {
  assert.equal(vnHHmm(new Date('2026-11-01T01:05:00Z')), '08:05');
  assert.equal(addMinutes(new Date('2026-11-01T00:00:00Z'), 90).toISOString(), '2026-11-01T01:30:00.000Z');
});

test('định dạng ngày giờ VN không phụ thuộc locale máy chủ', () => {
  const d = new Date('2026-10-31T18:07:00Z'); // 01:07 ngày 01/11 giờ VN
  assert.equal(fmtDateVn(d), '01/11/2026');
  assert.equal(fmtTimeVn(d), '01:07');
  assert.equal(fmtDateTimeVn(d), '01:07 01/11/2026');
  assert.equal(fmtDateVn(null), '—');
  assert.equal(periodLabel('2026-03'), '03/2026');
});

test('Joi: ymd / hhmm / phoneVn', () => {
  assert.equal(ymd().validate('2026-11-01').error, undefined);
  assert.ok(ymd().validate('2026-11-1').error);
  assert.equal(hhmm().validate('23:59').error, undefined);
  assert.ok(hhmm().validate('24:00').error);
  for (const p of ['0912345678', '+84912345678', '84912345678', '02438123456', '+842838123456']) assert.equal(phoneVn().validate(p).error, undefined, p);
  for (const p of ['12345', '0012345678', 'abc']) assert.ok(phoneVn().validate(p).error, p);
});

test('ApiError.field: lỗi 400 gắn với 1 field', () => {
  const err = ApiError.field('date', 'Ngày không hợp lệ');
  assert.equal(err.status, 400);
  assert.equal(err.errorCode, 'VALIDATION_ERROR');
  assert.deepEqual(err.details, [{ field: 'date', message: 'Ngày không hợp lệ' }]);
});

test('ApiError: mã lỗi không tồn tại → báo ngay khi dev/test thay vì âm thầm thành 500', () => {
  assert.throws(() => new ApiError('KHONG_CO_MA_NAY'), /errorCode/);
});

test('isRole: cùng ngữ nghĩa với authorize()', () => {
  const tech = { role: 'STAFF', roleTitle: 'TECHNICIAN' };
  assert.equal(isRole(tech, 'STAFF:TECHNICIAN'), true);
  assert.equal(isRole(tech, 'MANAGER', 'STAFF:RECEPTIONIST'), false);
  assert.equal(isRole(null, 'MANAGER'), false);
});

test('mật khẩu tạm: đủ hoa / thường / số, không ký tự dễ nhầm', () => {
  for (let i = 0; i < 50; i += 1) {
    const p = generateTemporaryPassword();
    assert.equal(p.length, 10);
    assert.match(p, /[A-Z]/);
    assert.match(p, /[a-z]/);
    assert.match(p, /\d/);
    assert.doesNotMatch(p, /[O0Il1]/);
  }
});

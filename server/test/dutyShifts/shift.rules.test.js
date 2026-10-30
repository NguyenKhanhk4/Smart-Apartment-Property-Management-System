// Quy tắc lịch ca trực (Người 4 — X6): kiểm tra khung ca, trùng ca, ai đang trực, lặp ca nhiều ngày.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SHIFT_HOURS,
  isActiveAt,
  overlaps,
  repeatWindows,
  splitOnDuty,
  validateShiftWindow,
} from '../../src/modules/dutyShifts/shift.rules.js';

const at = (iso) => new Date(iso);
const shift = (startAt, endAt, extra = {}) => ({ startAt: at(startAt), endAt: at(endAt), ...extra });

test('validateShiftWindow: ca hợp lệ 8 tiếng → không lỗi', () => {
  assert.equal(validateShiftWindow(at('2026-11-01T00:00:00Z'), at('2026-11-01T08:00:00Z')), null);
});

test('validateShiftWindow: giờ kết thúc phải sau giờ bắt đầu', () => {
  assert.match(validateShiftWindow(at('2026-11-01T08:00:00Z'), at('2026-11-01T08:00:00Z')), /sau giờ bắt đầu/);
  assert.match(validateShiftWindow(at('2026-11-01T08:00:00Z'), at('2026-11-01T07:00:00Z')), /sau giờ bắt đầu/);
});

test(`validateShiftWindow: một ca dài tối đa ${MAX_SHIFT_HOURS} giờ`, () => {
  assert.equal(validateShiftWindow(at('2026-11-01T00:00:00Z'), at('2026-11-02T00:00:00Z')), null);
  assert.match(validateShiftWindow(at('2026-11-01T00:00:00Z'), at('2026-11-02T00:01:00Z')), /tối đa/);
});

test('validateShiftWindow: ngày không hợp lệ', () => {
  assert.match(validateShiftWindow(new Date('x'), at('2026-11-01T08:00:00Z')), /không hợp lệ/);
});

test('overlaps: hai ca giao nhau', () => {
  const a = shift('2026-11-01T00:00:00Z', '2026-11-01T08:00:00Z');
  assert.equal(overlaps(a, shift('2026-11-01T07:00:00Z', '2026-11-01T15:00:00Z')), true);
  assert.equal(overlaps(a, shift('2026-10-31T20:00:00Z', '2026-11-01T01:00:00Z')), true);
  assert.equal(overlaps(a, shift('2026-11-01T02:00:00Z', '2026-11-01T03:00:00Z')), true);
});

test('overlaps: ca nối tiếp (kết thúc đúng lúc ca sau bắt đầu) không tính là trùng', () => {
  const a = shift('2026-11-01T00:00:00Z', '2026-11-01T08:00:00Z');
  assert.equal(overlaps(a, shift('2026-11-01T08:00:00Z', '2026-11-01T16:00:00Z')), false);
  assert.equal(overlaps(a, shift('2026-10-31T16:00:00Z', '2026-11-01T00:00:00Z')), false);
});

test('isActiveAt: tính cả giờ bắt đầu, không tính giờ kết thúc', () => {
  const s = shift('2026-11-01T00:00:00Z', '2026-11-01T08:00:00Z');
  assert.equal(isActiveAt(s, at('2026-11-01T00:00:00Z')), true);
  assert.equal(isActiveAt(s, at('2026-11-01T07:59:59Z')), true);
  assert.equal(isActiveAt(s, at('2026-11-01T08:00:00Z')), false);
  assert.equal(isActiveAt(s, at('2026-10-31T23:59:59Z')), false);
});

test('splitOnDuty: tách người trực chính và dự phòng đang trong ca', () => {
  const now = at('2026-11-01T05:00:00Z');
  const shifts = [
    shift('2026-11-01T00:00:00Z', '2026-11-01T08:00:00Z', { userId: 'A' }),
    shift('2026-11-01T00:00:00Z', '2026-11-01T08:00:00Z', { userId: 'B', isBackup: true }),
    shift('2026-11-01T08:00:00Z', '2026-11-01T16:00:00Z', { userId: 'C' }), // chưa tới ca
  ];
  const { primary, backup } = splitOnDuty(shifts, now);
  assert.deepEqual(primary.map((s) => s.userId), ['A']);
  assert.deepEqual(backup.map((s) => s.userId), ['B']);
});

test('splitOnDuty: một người có 2 dòng ca chồng nhau chỉ tính 1 lần, ưu tiên trực chính', () => {
  const now = at('2026-11-01T05:00:00Z');
  const shifts = [
    shift('2026-11-01T00:00:00Z', '2026-11-01T08:00:00Z', { userId: 'A', isBackup: true }),
    shift('2026-11-01T04:00:00Z', '2026-11-01T06:00:00Z', { userId: 'A' }),
  ];
  const { primary, backup } = splitOnDuty(shifts, now);
  assert.deepEqual(primary.map((s) => s.userId), ['A']);
  assert.deepEqual(backup, []);
});

test('repeatWindows: lặp ca qua đêm cho 3 ngày liên tiếp', () => {
  const windows = repeatWindows(at('2026-11-01T15:00:00Z'), at('2026-11-01T23:00:00Z'), 3);
  assert.deepEqual(
    windows.map((w) => [w.startAt.toISOString(), w.endAt.toISOString()]),
    [
      ['2026-11-01T15:00:00.000Z', '2026-11-01T23:00:00.000Z'],
      ['2026-11-02T15:00:00.000Z', '2026-11-02T23:00:00.000Z'],
      ['2026-11-03T15:00:00.000Z', '2026-11-03T23:00:00.000Z'],
    ],
  );
});

test('repeatWindows: mặc định 1 ngày', () => {
  assert.equal(repeatWindows(at('2026-11-01T00:00:00Z'), at('2026-11-01T08:00:00Z')).length, 1);
});

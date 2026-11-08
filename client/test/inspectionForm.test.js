import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failingRequired, isMeasured, itemStatus, rangeText, toPayload } from '../src/features/workOrders/inspectionForm.js';

const CHECKLIST = [
  { label: 'Điện áp', unit: 'V', minValue: 370, maxValue: 400, required: true },
  { label: 'Phanh', unit: null, minValue: null, maxValue: null, required: true },
  { label: 'Đèn', required: false },
];

test('mục đo trong / ngoài khoảng (kể cả biên), mục tick, chưa nhập', () => {
  assert.equal(isMeasured(CHECKLIST[0]), true);
  assert.equal(isMeasured(CHECKLIST[1]), false);
  assert.equal(itemStatus(CHECKLIST[0], { value: 370 }), 'ok');
  assert.equal(itemStatus(CHECKLIST[0], { value: 401 }), 'fail');
  assert.equal(itemStatus(CHECKLIST[0], { value: '' }), 'empty');
  assert.equal(itemStatus(CHECKLIST[1], { ok: false }), 'fail');
  assert.equal(itemStatus(CHECKLIST[1], {}), 'empty');
});

test('chỉ mục bắt buộc không đạt mới chặn chọn Đạt', () => {
  assert.deepEqual(failingRequired(CHECKLIST, [{ value: 420 }, { ok: true }, { ok: false }]), [0]);
  assert.deepEqual(failingRequired(CHECKLIST, [{ value: 380 }, { ok: true }, { ok: false }]), []);
});

test('khoảng cho phép và dữ liệu gửi server theo thứ tự checklist', () => {
  assert.equal(rangeText(CHECKLIST[0]), '370 – 400 V');
  assert.equal(rangeText({ unit: 'bar', minValue: 2 }), '≥ 2 bar');
  assert.deepEqual(toPayload(CHECKLIST, [{ value: 380 }, { ok: true }]), [{ value: 380 }, { ok: true }, { ok: null }]);
});

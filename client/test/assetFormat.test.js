import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checklistRule, cleanChecklist, cycleText, dueText, isDuplicateLabel, warrantyState } from '../src/features/assets/assetFormat.js';

test('chu kỳ: ngày / tháng / quý; thiếu dữ liệu → —', () => {
  assert.equal(cycleText({ cycleValue: 30, cycleUnit: 'DAY' }), '30 ngày');
  assert.equal(cycleText({ cycleValue: 1, cycleUnit: 'MONTH' }), '1 tháng');
  assert.equal(cycleText({ cycleValue: 2, cycleUnit: 'QUARTER' }), '2 quý');
  assert.equal(cycleText({ maintenanceCycleDays: 30 }), '—');
});

test('bảo hành: hết hạn / còn ≤ 30 ngày / còn hạn; ngày cuối vẫn còn hạn', () => {
  const now = new Date(2026, 10, 8, 15, 0);
  assert.equal(warrantyState(null, now), null);
  assert.equal(warrantyState(new Date(2026, 10, 7), now), 'EXPIRED');
  assert.equal(warrantyState(new Date(2026, 10, 8), now), 'EXPIRING');
  assert.equal(warrantyState(new Date(2026, 11, 8), now), 'EXPIRING'); // đúng 30 ngày
  assert.equal(warrantyState(new Date(2026, 11, 9), now), 'VALID');
});

test('mô tả mục checklist: mục đo có khoảng / một đầu, mục tick', () => {
  assert.equal(checklistRule({ label: 'Điện áp', unit: 'V', minValue: 370, maxValue: 400 }), 'Đo (V): 370 – 400');
  assert.equal(checklistRule({ label: 'Áp', unit: 'bar', minValue: 2, maxValue: null }), 'Đo (bar): ≥ 2');
  assert.equal(checklistRule({ label: 'Nhiệt', maxValue: 75 }), 'Đo: ≤ 75');
  assert.equal(checklistRule({ label: 'Phanh' }), 'Kiểm tra (tick)');
});

test('làm sạch checklist trước khi gửi: bỏ dòng trống, ô số trống thành null, mặc định bắt buộc', () => {
  assert.deepEqual(cleanChecklist([
    { label: '  Điện áp ', unit: ' V ', minValue: 370, maxValue: '' },
    { label: '   ' },
    { label: 'Phanh', required: false },
  ]), [
    { label: 'Điện áp', unit: 'V', minValue: 370, maxValue: null, required: true },
    { label: 'Phanh', unit: null, minValue: null, maxValue: null, required: false },
  ]);
});

test('ngày bảo trì: quá hạn N ngày / đến hạn hôm nay / chưa tới hạn', () => {
  const now = new Date(2026, 10, 8, 15, 0);
  assert.equal(dueText(new Date(2026, 9, 12), now), 'quá hạn 27 ngày');
  assert.equal(dueText(new Date(2026, 10, 8, 1, 0), now), 'đến hạn hôm nay');
  assert.equal(dueText(new Date(2026, 10, 9), now), null);
  assert.equal(dueText(null, now), null);
});

test('trùng tên mục checklist: không phân biệt hoa thường, khoảng trắng; không so với chính nó', () => {
  const rows = [{ label: 'Điện áp' }, { label: ' điện ÁP ' }, { label: 'Phanh' }];
  assert.equal(isDuplicateLabel(rows, 1, rows[1].label), true);
  assert.equal(isDuplicateLabel(rows, 2, 'Phanh'), false);
  assert.equal(isDuplicateLabel(rows, 2, ''), false);
});

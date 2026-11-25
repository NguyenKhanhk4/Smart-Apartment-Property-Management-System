import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterShiftItems, sortTodayFirst } from '../src/features/workOrders/shiftSearch.js';

const item = (code, name, location, building) => ({ assetId: { code, name, location, buildingId: { name: building } } });
const items = [
  item('TB25-01', 'Quạt hút khói hành lang Block B', 'Tầng 3', 'Block B'),
  item('TB25-02', 'Bơm nước thải Block B', 'Bể gom tầng hầm', 'Block B'),
  item('TB26-05', 'Tủ điện phân phối tầng Block C', 'Phòng điện tầng 5', 'Block C'),
];
const codes = (q) => filterShiftItems(items, { keyword: q }).map((x) => x.assetId.code);

test('tìm checklist ca: theo mã, tên, vị trí, tòa; không phân biệt dấu và hoa thường; nhiều từ phải khớp hết', () => {
  assert.deepEqual(codes(''), ['TB25-01', 'TB25-02', 'TB26-05']);
  assert.deepEqual(codes('   '), ['TB25-01', 'TB25-02', 'TB26-05']);
  assert.deepEqual(codes('tb25'), ['TB25-01', 'TB25-02']);
  assert.deepEqual(codes('bom'), ['TB25-02']);
  assert.deepEqual(codes('TỦ ĐIỆN'), ['TB26-05']);
  assert.deepEqual(codes('tu dien'), ['TB26-05']);
  assert.deepEqual(codes('block b hầm'), ['TB25-02']);
  assert.deepEqual(codes('không có'), []);
  assert.deepEqual(filterShiftItems([{ assetId: null }], { keyword: 'x' }), [], 'thiết bị đã xóa không làm lỗi');
});

// Ngày lên lịch lưu 0h giờ VN = 17:00 UTC hôm trước
const wo = (id, day, status = 'PENDING') => ({ id, status, scheduledDate: day && new Date(`2026-11-${day}T00:00:00+07:00`).toISOString() });
const list = [wo('a', 24), wo('b', 24, 'UNDER_REPAIR'), wo('c', 25), wo('d', 26), wo('e', 27), wo('f', 23), wo('g', null)];
const ids = (xs) => xs.map((x) => x.id).join('');

test('lọc checklist ca theo ngày lên lịch (giờ VN, cả 2 đầu) và trạng thái; kết hợp được', () => {
  assert.equal(ids(filterShiftItems(list, { from: '2026-11-24', to: '2026-11-24' })), 'ab');
  assert.equal(ids(filterShiftItems(list, { from: '2026-11-25' })), 'cde');
  assert.equal(ids(filterShiftItems(list, { to: '2026-11-24' })), 'abf');
  assert.equal(ids(filterShiftItems(list, { statuses: ['UNDER_REPAIR'] })), 'b');
  assert.equal(ids(filterShiftItems(list, { statuses: ['PENDING'], from: '2026-11-24', to: '2026-11-25' })), 'ac');
  assert.equal(filterShiftItems(list, {}).length, 7);
});

test('hôm nay lên đầu → đã qua gần nhất trước → sắp tới gần nhất trước → không có ngày; không đổi mảng gốc', () => {
  const now = new Date('2026-11-25T00:30:00+07:00'); // 17:30 UTC ngày 24: vẫn phải là ngày 25 giờ VN
  assert.equal(ids(sortTodayFirst(list, now)), 'cabfdeg');
  assert.equal(ids(sortTodayFirst(list, new Date('2026-11-24T23:30:00+07:00'))), 'abfcdeg');
  assert.equal(ids(list), 'abcdefg');
});

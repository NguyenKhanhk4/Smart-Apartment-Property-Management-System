// Nhóm trạng thái dùng chung: mọi module (server + client) lấy từ constants, không tự khai báo danh sách riêng.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/constants/enums.js';

const values = (o) => Object.values(o);
const assertSubset = (group, enumObj, name) => {
  for (const s of group) assert.ok(values(enumObj).includes(s), `${name}: "${s}" không thuộc enum`);
  assert.equal(new Set(group).size, group.length, `${name}: có phần tử trùng`);
};

test('ticket: nhóm Đang mở / Tính SLA / Kết thúc là tập con của TICKET_STATUS', () => {
  assertSubset(E.TICKET_OPEN_STATUSES, E.TICKET_STATUS, 'TICKET_OPEN_STATUSES');
  assertSubset(E.TICKET_SLA_STATUSES, E.TICKET_STATUS, 'TICKET_SLA_STATUSES');
  assertSubset(E.TICKET_FINAL_STATUSES, E.TICKET_STATUS, 'TICKET_FINAL_STATUSES');
});

test('ticket: mỗi trạng thái thuộc đúng 1 trong 3 nhóm Đang mở / Chờ nghiệm thu / Kết thúc', () => {
  const buckets = [...E.TICKET_OPEN_STATUSES, E.TICKET_STATUS.WAITING_CONFIRM, ...E.TICKET_FINAL_STATUSES];
  assert.deepEqual([...buckets].sort(), values(E.TICKET_STATUS).sort());
});

test('ticket: đang mở gồm cả chờ đồng ý phí và chờ linh kiện; SLA tạm dừng khi chờ cư dân đồng ý phí', () => {
  assert.ok(E.TICKET_OPEN_STATUSES.includes('WAITING_QUOTE_APPROVAL'));
  assert.ok(E.TICKET_OPEN_STATUSES.includes('WAITING_PARTS'));
  assert.ok(E.TICKET_SLA_STATUSES.includes('WAITING_PARTS'));
  assert.ok(!E.TICKET_SLA_STATUSES.includes('WAITING_QUOTE_APPROVAL'));
});

test('ticket: hành động lịch sử có enum', () => {
  for (const a of ['CREATED', 'ASSIGNED', 'REASSIGNED', 'CLAIMED', 'PROGRESS', 'RESOLVED', 'CONFIRMED', 'REOPENED', 'ESCALATED', 'AUTO_CLOSED', 'REJECTED']) {
    assert.equal(E.TICKET_HISTORY_ACTIONS[a], a);
  }
});

test('work order: nhóm đang mở', () => {
  assert.deepEqual(E.WORK_ORDER_OPEN_STATUSES, ['PENDING', 'IN_PROGRESS']);
});

test('booking: nhóm giữ chỗ / tính phí / dữ liệu cũ', () => {
  assertSubset(E.BOOKING_ACTIVE_STATUSES, E.BOOKING_STATUS, 'BOOKING_ACTIVE_STATUSES');
  assertSubset(E.BOOKING_BILLABLE_STATUSES, E.BOOKING_STATUS, 'BOOKING_BILLABLE_STATUSES');
  assert.deepEqual(E.BOOKING_LEGACY_STATUSES, ['PENDING', 'REJECTED']);
  // Giữ chỗ chờ thanh toán vẫn chiếm slot nhưng chưa tính phí
  assert.ok(E.BOOKING_ACTIVE_STATUSES.includes('PENDING_PAYMENT'));
  assert.ok(!E.BOOKING_BILLABLE_STATUSES.includes('PENDING_PAYMENT'));
  for (const legacy of E.BOOKING_LEGACY_STATUSES) {
    assert.ok(!E.BOOKING_ACTIVE_STATUSES.includes(legacy));
    assert.ok(!E.BOOKING_BILLABLE_STATUSES.includes(legacy));
  }
});

test('enum gom từ service về constants: trạng thái đơn giá, xem trước hóa đơn, biến động nhân khẩu', () => {
  assert.deepEqual(values(E.FEE_TYPE_STATES), ['ACTIVE', 'UPCOMING', 'ENDED']);
  assert.ok(E.INVOICE_PREVIEW_STATUS.NEW && E.INVOICE_PREVIEW_STATUS.EXISTS);
  assert.deepEqual(values(E.OCCUPANT_CHANGE_TYPES), ['MOVE_IN', 'MOVE_OUT']);
});

test('audit: targetType thống nhất là tên collection', () => {
  for (const t of values(E.AUDIT_TARGETS)) assert.match(t, /^[a-z_]+$/, `"${t}" phải là tên collection snake_case`);
  assert.equal(E.AUDIT_TARGETS.CONTRACT, 'contracts');
  assert.equal(E.AUDIT_TARGETS.GATE_PASS, 'gate_passes');
});

test('cron: kiểu kích hoạt có enum; tham số mặc định dùng CONFIG_SCOPES', () => {
  assert.deepEqual(values(E.CRON_TRIGGERS), ['SCHEDULE', 'MANUAL']);
  for (const c of E.DEFAULT_CONFIGS) assert.ok(values(E.CONFIG_SCOPES).includes(c.scope), c.key);
});

test('audit/lỗi bổ sung cho Module A', () => {
  assert.equal(E.AUDIT_ACTIONS.RESIDENT_UPDATED, 'RESIDENT_UPDATED');
});

test('tham số cho phép giá trị 0 (tắt tính năng)', () => {
  assert.ok(E.ZERO_ALLOWED_CONFIG_KEYS.includes('BOOKING_PAYMENT_HOLD_MINUTES'));
});

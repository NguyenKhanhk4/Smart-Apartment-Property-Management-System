// Nút thao tác trên chi tiết phiếu theo quyền + trạng thái (khớp quy tắc server ở tickets/ticket.rules.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progressOptions, ticketActions } from '../src/features/tickets/ticketActions.js';

const can = (...specs) => (...wanted) => wanted.some((w) => specs.includes(w));
const me = { id: 'u1' };
const base = { type: 'INCIDENT', scope: 'COMMON_AREA', status: 'NEW', assignedTo: null, quoteDecision: {} };

test('KTV: nhận được sự cố mới chưa ai nhận; không nhận phản ánh', () => {
  const tech = can('STAFF:TECHNICIAN');
  assert.equal(ticketActions(base, me, tech).canClaim, true);
  assert.equal(ticketActions({ ...base, type: 'COMPLAINT' }, me, tech).canClaim, false);
  assert.equal(ticketActions({ ...base, assignedTo: { _id: 'x' } }, me, tech).canClaim, false);
});

test('Trưởng BQL / Lễ tân: phân công sự cố, không phân công phản ánh', () => {
  const manager = can('MANAGER');
  assert.equal(ticketActions(base, me, manager).canAssign, true);
  assert.equal(ticketActions({ ...base, type: 'COMPLAINT' }, me, manager).canAssign, false);
  assert.equal(ticketActions({ ...base, type: 'COMPLAINT' }, me, manager).canReject, true);
});

test('cư dân: đồng ý báo giá khi chờ đồng ý phí; nghiệm thu khi chờ nghiệm thu', () => {
  const resident = can('RESIDENT');
  assert.equal(ticketActions({ ...base, status: 'WAITING_QUOTE_APPROVAL' }, me, resident).canDecideQuote, true);
  assert.equal(ticketActions({ ...base, status: 'WAITING_CONFIRM' }, me, resident).canConfirm, true);
  assert.equal(ticketActions(base, me, resident).canDecideQuote, false);
});

test('KTV được giao: cập nhật tiến độ ở Đã nhận / Đang xử lý / Chờ linh kiện, không ở Chờ đồng ý phí', () => {
  const tech = can('STAFF:TECHNICIAN');
  const mine = { ...base, assignedTo: { _id: 'u1' } };
  for (const status of ['ASSIGNED', 'IN_PROGRESS', 'WAITING_PARTS']) {
    assert.equal(ticketActions({ ...mine, status }, me, tech).canProgress, true, status);
  }
  assert.equal(ticketActions({ ...mine, status: 'WAITING_QUOTE_APPROVAL' }, me, tech).canProgress, false);
  assert.equal(ticketActions({ ...mine, status: 'ASSIGNED', assignedTo: { _id: 'other' } }, me, tech).canProgress, false);
});

test('progressOptions: khu vực chung', () => {
  assert.deepEqual(progressOptions({ ...base, status: 'ASSIGNED' }), ['IN_PROGRESS', 'WAITING_CONFIRM']);
  assert.deepEqual(progressOptions({ ...base, status: 'IN_PROGRESS' }), ['IN_PROGRESS', 'WAITING_PARTS', 'WAITING_CONFIRM']);
  assert.deepEqual(progressOptions({ ...base, status: 'WAITING_PARTS' }), ['IN_PROGRESS', 'WAITING_CONFIRM']);
});

test('progressOptions: trong căn hộ chưa đồng ý phí thì chỉ gửi báo giá', () => {
  const inApt = { ...base, scope: 'IN_APARTMENT', status: 'ASSIGNED' };
  assert.deepEqual(progressOptions(inApt), ['WAITING_QUOTE_APPROVAL']);
  assert.deepEqual(progressOptions({ ...inApt, quoteDecision: { accepted: true } }), ['IN_PROGRESS', 'WAITING_CONFIRM']);
});

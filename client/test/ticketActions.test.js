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

test('phản ánh: manager được xử lý; cư dân đánh giá sau khi BQL đóng, không sửa phiếu đã kết thúc', () => {
  const complaint = { ...base, type: 'COMPLAINT' };
  const manager = can('MANAGER');
  assert.equal(ticketActions(complaint, me, manager).canRespondComplaint, true);
  assert.equal(ticketActions({ ...complaint, status: 'IN_PROGRESS' }, me, manager).canRespondComplaint, true);
  assert.equal(ticketActions(complaint, me, can('STAFF:RECEPTIONIST')).canRespondComplaint, false);
  assert.equal(ticketActions(base, me, manager).canRespondComplaint, false);
  assert.equal(ticketActions({ ...complaint, status: 'CLOSED' }, me, manager).canRespondComplaint, false);
  assert.equal(ticketActions({ ...complaint, status: 'CLOSED' }, me, can('RESIDENT')).canConfirm, true);
  assert.equal(ticketActions({ ...complaint, status: 'CLOSED', rating: 4 }, me, can('RESIDENT')).canConfirm, false);
});

test('progressOptions: trong căn hộ chưa đồng ý phí thì không cập nhật tiến độ, phải gửi báo giá qua form', () => {
  const inApt = { ...base, scope: 'IN_APARTMENT', status: 'ASSIGNED' };
  assert.deepEqual(progressOptions(inApt), []);
  assert.deepEqual(progressOptions({ ...inApt, quoteDecision: { accepted: true } }), ['IN_PROGRESS', 'WAITING_CONFIRM']);
});

test('KTV được giao: gửi báo giá sự cố trong căn khi Đã nhận / Chờ đồng ý / Đang xử lý / Chờ linh kiện', () => {
  const tech = can('STAFF:TECHNICIAN');
  const mine = { ...base, scope: 'IN_APARTMENT', assignedTo: { _id: 'u1' } };
  for (const status of ['ASSIGNED', 'WAITING_QUOTE_APPROVAL', 'IN_PROGRESS', 'WAITING_PARTS']) {
    assert.equal(ticketActions({ ...mine, status }, me, tech).canQuote, true, status);
  }
  assert.equal(ticketActions({ ...mine, status: 'WAITING_CONFIRM' }, me, tech).canQuote, false);
  assert.equal(ticketActions({ ...mine, scope: 'COMMON_AREA', status: 'ASSIGNED' }, me, tech).canQuote, false);
  assert.equal(ticketActions({ ...mine, status: 'ASSIGNED', assignedTo: { _id: 'other' } }, me, tech).canQuote, false);
});

test('M5-5 đổi phân loại: điều phối hoặc KTV được giao, chỉ khi Mới / Đã nhận', () => {
  const dispatcher = can('MANAGER');
  const tech = can('STAFF:TECHNICIAN');
  assert.equal(ticketActions(base, me, dispatcher).canReclassify, true);
  assert.equal(ticketActions({ ...base, status: 'IN_PROGRESS' }, me, dispatcher).canReclassify, false);
  assert.equal(ticketActions({ ...base, status: 'ASSIGNED', assignedTo: { _id: 'u1' } }, me, tech).canReclassify, true);
  assert.equal(ticketActions({ ...base, status: 'ASSIGNED', assignedTo: { _id: 'u2' } }, me, tech).canReclassify, false);
  assert.equal(ticketActions(base, me, can('RESIDENT')).canReclassify, false);
});

test('M5-6 gộp phiếu: chỉ Trưởng BQL, sự cố khu vực chung chưa bắt đầu; phiếu đã gộp không phân công được', () => {
  const dispatcher = can('MANAGER');
  assert.equal(ticketActions(base, me, dispatcher).canMerge, true);
  assert.equal(ticketActions({ ...base, scope: 'IN_APARTMENT' }, me, dispatcher).canMerge, false);
  assert.equal(ticketActions({ ...base, status: 'IN_PROGRESS' }, me, dispatcher).canMerge, false);
  assert.equal(ticketActions(base, me, can('STAFF:TECHNICIAN')).canMerge, false);
  assert.equal(ticketActions({ ...base, status: 'MERGED' }, me, dispatcher).canAssign, false);
});

test('lễ tân: không phân công / từ chối / gộp (SRS 2.3, UC41–42), vẫn đổi phân loại được', () => {
  const desk = can('STAFF:RECEPTIONIST');
  const actions = ticketActions(base, me, desk);
  assert.equal(actions.canAssign, false);
  assert.equal(actions.canReject, false);
  assert.equal(actions.canMerge, false);
  assert.equal(actions.canReclassify, true);
});

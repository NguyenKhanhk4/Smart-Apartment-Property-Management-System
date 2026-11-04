// Quy tắc phiếu sự cố / phản ánh (Người 4) — logic thuần: phân luồng, hạn SLA, chuyển trạng thái, vi phạm SLA, Kanban.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_STATUSES,
  computeDeadlines,
  groupBoard,
  progressError,
  routeOf,
  slaBreaches,
} from '../../src/modules/tickets/ticket.rules.js';

const H = 3_600_000;
const now = new Date('2026-11-01T02:00:00Z');
const t = (extra) => ({ type: 'INCIDENT', scope: 'COMMON_AREA', status: 'ASSIGNED', quoteDecision: {}, ...extra });

test('routeOf: sự cố vào hàng chờ Kỹ thuật, phản ánh sang bàn xử lý của Trưởng BQL (Người 2)', () => {
  assert.equal(routeOf('INCIDENT'), 'TECH_QUEUE');
  assert.equal(routeOf('COMPLAINT'), 'COMPLAINT_DESK');
});

test('computeDeadlines: sự cố có hạn nhận phiếu + hạn hoàn thành', () => {
  const d = computeDeadlines({ type: 'INCIDENT', slaHours: 24, ackMinutes: 30, responseHours: 48, now });
  assert.equal(d.ackDueAt.getTime(), now.getTime() + 30 * 60_000);
  assert.equal(d.dueDate.getTime(), now.getTime() + 24 * H);
  assert.equal(d.responseDueAt, null);
});

test('computeDeadlines: phản ánh có hạn phản hồi, không có hạn nhận phiếu', () => {
  const d = computeDeadlines({ type: 'COMPLAINT', slaHours: 72, ackMinutes: 30, responseHours: 48, now });
  assert.equal(d.ackDueAt, null);
  assert.equal(d.responseDueAt.getTime(), now.getTime() + 48 * H);
  assert.equal(d.dueDate.getTime(), now.getTime() + 72 * H);
});

test('progressError: khu vực chung đi thẳng Đang xử lý / Đã xong, không cần báo giá', () => {
  assert.equal(progressError(t(), 'IN_PROGRESS'), null);
  assert.equal(progressError(t(), 'WAITING_CONFIRM'), null);
  assert.match(progressError(t(), 'WAITING_QUOTE_APPROVAL'), /trong căn hộ/);
});

test('progressError: trong căn hộ phải gửi báo giá và chờ cư dân đồng ý trước khi xử lý', () => {
  const inApt = t({ scope: 'IN_APARTMENT' });
  assert.equal(progressError(inApt, 'WAITING_QUOTE_APPROVAL'), null);
  assert.match(progressError(inApt, 'IN_PROGRESS'), /đồng ý/);
  assert.match(progressError(inApt, 'WAITING_CONFIRM'), /đồng ý/);
  const accepted = t({ scope: 'IN_APARTMENT', quoteDecision: { accepted: true } });
  assert.equal(progressError(accepted, 'IN_PROGRESS'), null);
});

test('progressError: chờ linh kiện ⇄ đang xử lý; đang chờ cư dân đồng ý phí thì KTV không tự chuyển', () => {
  assert.equal(progressError(t({ status: 'IN_PROGRESS' }), 'WAITING_PARTS'), null);
  assert.equal(progressError(t({ status: 'WAITING_PARTS' }), 'IN_PROGRESS'), null);
  assert.equal(progressError(t({ status: 'WAITING_PARTS' }), 'WAITING_CONFIRM'), null);
  assert.match(progressError(t({ status: 'ASSIGNED' }), 'WAITING_PARTS'), /Không thể chuyển/);
  assert.match(progressError(t({ status: 'WAITING_QUOTE_APPROVAL', scope: 'IN_APARTMENT' }), 'IN_PROGRESS'), /Không thể chuyển/);
});

test('slaBreaches: sự cố chưa ai nhận quá hạn nhận phiếu → ACK (chỉ báo 1 lần)', () => {
  const late = { type: 'INCIDENT', status: 'NEW', assignedTo: null, ackDueAt: new Date(now - 1), ackAlertedAt: null };
  assert.deepEqual(slaBreaches(late, now), ['ACK']);
  assert.deepEqual(slaBreaches({ ...late, ackAlertedAt: now }, now), []);
  assert.deepEqual(slaBreaches({ ...late, status: 'ASSIGNED', assignedTo: 'x' }, now), []);
  assert.deepEqual(slaBreaches({ ...late, ackDueAt: new Date(now.getTime() + 1) }, now), []);
});

test('slaBreaches: phản ánh chưa phản hồi quá hạn → RESPONSE; đã phản hồi / đã đóng thì thôi', () => {
  const late = { type: 'COMPLAINT', status: 'NEW', responseDueAt: new Date(now - 1), respondedAt: null, responseAlertedAt: null };
  assert.deepEqual(slaBreaches(late, now), ['RESPONSE']);
  assert.deepEqual(slaBreaches({ ...late, respondedAt: now }, now), []);
  assert.deepEqual(slaBreaches({ ...late, status: 'REJECTED' }, now), []);
});

test('groupBoard: cột Kanban theo trạng thái đang mở + chờ nghiệm thu, giữ thứ tự cột', () => {
  const board = groupBoard([{ status: 'NEW' }, { status: 'WAITING_PARTS' }, { status: 'NEW' }, { status: 'CLOSED' }]);
  assert.deepEqual(board.map((c) => c.status), BOARD_STATUSES);
  assert.equal(board.find((c) => c.status === 'NEW').items.length, 2);
  assert.equal(board.find((c) => c.status === 'WAITING_PARTS').items.length, 1);
  assert.ok(!BOARD_STATUSES.includes('CLOSED'));
});

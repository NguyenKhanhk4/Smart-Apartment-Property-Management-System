// Helper thuần của client (không cần trình duyệt): chạy bằng `npm test` (node:test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readErrorPayload } from '../src/api/errorPayload.js';
import { createSequencer } from '../src/hooks/requestSequence.js';
import { moneyInputProps } from '../src/utils/format.js';
import {
  isTicketFinal,
  isTicketOpen,
  ticketStatusColor,
} from '../src/utils/status.js';

test('readErrorPayload: Blob JSON (tải file lỗi) → object để lấy message của server', async () => {
  const blob = new Blob([JSON.stringify({ success: false, errorCode: 'FORBIDDEN_ROLE', message: 'Không có quyền' })], {
    type: 'application/json',
  });
  assert.deepEqual(await readErrorPayload(blob), { success: false, errorCode: 'FORBIDDEN_ROLE', message: 'Không có quyền' });
});

test('readErrorPayload: Blob không phải JSON → null; object thường giữ nguyên', async () => {
  assert.equal(await readErrorPayload(new Blob(['<html>502</html>'])), null);
  assert.deepEqual(await readErrorPayload({ message: 'x' }), { message: 'x' });
  assert.equal(await readErrorPayload(undefined), undefined);
});

test('createSequencer: chỉ kết quả của request mới nhất được dùng', () => {
  const seq = createSequencer();
  const first = seq.next();
  const second = seq.next();
  assert.equal(seq.isLatest(first), false);
  assert.equal(seq.isLatest(second), true);
  seq.invalidate();
  assert.equal(seq.isLatest(second), false);
});


test('moneyInputProps: 1500000 ⇄ "1.500.000", chịu được giá trị rỗng', () => {
  assert.equal(moneyInputProps.formatter(1500000), '1.500.000');
  assert.equal(moneyInputProps.formatter(undefined), '');
  assert.equal(moneyInputProps.parser('1.500.000'), '1500000');
  assert.equal(moneyInputProps.parser(undefined), '');
});

test('trạng thái ticket: đang mở / kết thúc theo nhóm chung', () => {
  assert.equal(isTicketOpen('WAITING_PARTS'), true);
  assert.equal(isTicketOpen('WAITING_CONFIRM'), false);
  assert.equal(isTicketFinal('REJECTED'), true);
  assert.equal(isTicketFinal('IN_PROGRESS'), false);
});

test('ticketStatusColor: mọi trạng thái có màu hex, trạng thái lạ dùng màu dự phòng', () => {
  for (const s of ['NEW', 'ASSIGNED', 'WAITING_QUOTE_APPROVAL', 'IN_PROGRESS', 'WAITING_PARTS', 'WAITING_CONFIRM', 'CLOSED', 'REJECTED']) {
    assert.match(ticketStatusColor(s), /^#[0-9a-f]{6}$/i, s);
  }
  assert.match(ticketStatusColor('KHONG_CO'), /^#[0-9a-f]{6}$/i);
});


test('keysOf: bảng nhãn enum → hằng giá trị để so sánh, không gõ chuỗi tay', async () => {
  const { keysOf } = await import('../src/utils/status.js');
  const R = keysOf({ A: { label: 'a' }, B: { label: 'b' } });
  assert.deepEqual(R, { A: 'A', B: 'B' });
  assert.ok(Object.isFrozen(R));
});

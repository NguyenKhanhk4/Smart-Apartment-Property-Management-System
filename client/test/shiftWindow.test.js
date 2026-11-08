// Khung giờ ca trực: ca qua đêm, kéo thả sang ngày khác giữ giờ và độ dài
import { test } from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import { moveToDay, toWindow } from '../src/features/dutyShifts/shiftWindow.js';

test('ca qua đêm kết thúc ngày hôm sau', () => {
  const day = dayjs('2026-11-10T00:00:00');
  const w = toWindow(day, [day.hour(22), day.hour(6)]);
  assert.equal(dayjs(w.endAt).diff(dayjs(w.startAt), 'hour'), 8);
  assert.equal(dayjs(w.endAt).date(), 11);
});

test('kéo ca sang ngày khác: giữ giờ bắt đầu và độ dài (kể cả ca qua đêm)', () => {
  const shift = { startAt: '2026-11-10T22:00:00', endAt: '2026-11-11T06:00:00' };
  const moved = moveToDay(shift, dayjs('2026-11-13T00:00:00'), dayjs);
  assert.equal(dayjs(moved.startAt).format('DD HH:mm'), '13 22:00');
  assert.equal(dayjs(moved.endAt).format('DD HH:mm'), '14 06:00');
});

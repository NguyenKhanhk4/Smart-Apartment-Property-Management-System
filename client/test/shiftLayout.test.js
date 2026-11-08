// Bố trí ca trực trên lịch: loại ca, ca qua đêm cắt 2 đoạn, ca chồng giờ xếp cột cạnh nhau
import { test } from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import { isOvernight, segmentsForDay, shiftKind, shiftLabel, shiftsStartingOn } from '../src/features/dutyShifts/shiftLayout.js';

const sh = (id, start, end) => ({ _id: id, startAt: `2026-11-10T${start}`, endAt: end.includes('T') ? end : `2026-11-10T${end}` });
const d10 = dayjs('2026-11-10T00:00:00');
const d11 = dayjs('2026-11-11T00:00:00');

test('loại ca theo giờ bắt đầu; nhãn ca qua đêm có (+1), ca kết thúc 00:00 không tính qua đêm', () => {
  assert.equal(shiftKind('2026-11-10T06:00:00', dayjs), 'MORNING');
  assert.equal(shiftKind('2026-11-10T14:00:00', dayjs), 'AFTERNOON');
  assert.equal(shiftKind('2026-11-10T22:00:00', dayjs), 'NIGHT');
  const night = sh('n', '22:00:00', '2026-11-11T06:00:00');
  assert.equal(isOvernight(night, dayjs), true);
  assert.equal(shiftLabel(night, dayjs), '22:00 → 06:00 (+1)');
  const toMidnight = sh('m', '18:00:00', '2026-11-11T00:00:00');
  assert.equal(isOvernight(toMidnight, dayjs), false);
  assert.equal(shiftLabel(toMidnight, dayjs), '18:00 – 24:00');
});

test('ca qua đêm: đoạn 22:00–24:00 ở ngày bắt đầu, đoạn tiếp 00:00–06:00 ở hôm sau; lịch tháng chỉ ở ngày bắt đầu', () => {
  const night = sh('n', '22:00:00', '2026-11-11T06:00:00');
  const [a] = segmentsForDay([night], d10);
  assert.deepEqual([a.startMin, a.endMin, a.fromPrev, a.toNext], [22 * 60, 24 * 60, false, true]);
  const [b] = segmentsForDay([night], d11);
  assert.deepEqual([b.startMin, b.endMin, b.fromPrev, b.toNext], [0, 6 * 60, true, false]);
  assert.equal(shiftsStartingOn([night], d10).length, 1);
  assert.equal(shiftsStartingOn([night], d11).length, 0);
});

test('2 người cùng ca xếp 2 cột; ca nối tiếp không chồng nên chung 1 cột', () => {
  const segs = segmentsForDay([sh('a', '06:00:00', '14:00:00'), sh('b', '06:00:00', '14:00:00'), sh('c', '14:00:00', '22:00:00')], d10);
  const byId = Object.fromEntries(segs.map((s) => [s.shift._id, s]));
  assert.equal(byId.a.lanes, 2);
  assert.notEqual(byId.a.lane, byId.b.lane);
  assert.equal(byId.c.lanes, 1);
  assert.equal(byId.c.lane, 0);
});

test('trạng thái ca: đã kết thúc (chỉ xem) / đang diễn ra / sắp tới; mốc kết thúc tính là đã kết thúc', async () => {
  const { shiftState } = await import('../src/features/dutyShifts/shiftLayout.js');
  const shift = { startAt: '2026-11-10T06:00:00', endAt: '2026-11-10T14:00:00' };
  assert.equal(shiftState(shift, dayjs('2026-11-10T05:59:00')).key, 'UPCOMING');
  assert.equal(shiftState(shift, dayjs('2026-11-10T06:00:00')).key, 'RUNNING');
  assert.equal(shiftState(shift, dayjs('2026-11-10T14:00:00')).key, 'ENDED');
});

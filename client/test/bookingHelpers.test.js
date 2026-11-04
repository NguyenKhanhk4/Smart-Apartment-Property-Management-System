// Helper booking phía cư dân (Người 4): nhãn giữ chỗ chờ thanh toán, slot còn đổi lịch được.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holdLabel, rescheduleOptions } from '../src/features/bookings/bookingHelpers.js';

const now = new Date('2026-11-01T02:00:00Z'); // 09:00 giờ VN

test('holdLabel: còn hạn → giờ hết hạn (giờ VN) + số phút còn lại; hết hạn → báo hết', () => {
  assert.equal(holdLabel('2026-11-01T02:12:30Z', now), 'Giữ chỗ đến 09:12 · còn 12 phút');
  assert.equal(holdLabel('2026-11-01T02:00:30Z', now), 'Giữ chỗ đến 09:00 · còn dưới 1 phút');
  assert.equal(holdLabel('2026-11-01T01:59:00Z', now), 'Đã hết thời gian giữ chỗ');
  assert.equal(holdLabel(null, now), '');
});

test('rescheduleOptions: chỉ slot còn trống, bỏ slot đang đặt; nhãn có số chỗ còn', () => {
  const slots = [
    { slotStart: '08:00', slotEnd: '09:00', available: false, lockReason: 'PAST' },
    { slotStart: '10:00', slotEnd: '11:00', available: false, lockReason: 'ALREADY_BOOKED' },
    { slotStart: '11:00', slotEnd: '12:00', available: true, remaining: 2 },
    { slotStart: '12:00', slotEnd: '13:00', available: false, lockReason: 'FULL' },
  ];
  assert.deepEqual(rescheduleOptions(slots, { slotStart: '10:00', sameDay: true }), [
    { value: '11:00', label: '11:00–12:00 · còn 2 chỗ' },
  ]);
});

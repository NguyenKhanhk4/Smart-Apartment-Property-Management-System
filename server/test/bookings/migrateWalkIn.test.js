// Script bỏ tiện ích kiểu Vào cửa (gói tháng / vé lẻ): WALK_IN → BOOKING, xóa trường cũ; chạy thử không ghi, chạy lại không đổi gì.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { bookingFieldsOf, migrateWalkInAmenities } from '../../scripts/migrateWalkInAmenities.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const col = (name) => mongoose.connection.db.collection(name);

test('bookingFieldsOf: slot 60 phút (rút ngắn nếu giờ mở ít hơn), sức chứa theo số người tối đa, phí = vé người lớn', () => {
  assert.deepEqual(bookingFieldsOf({ openTime: '05:00', closeTime: '21:00', maxConcurrent: 40, perVisitFeeAdult: 40000 }), {
    accessMode: 'BOOKING',
    openTime: '05:00',
    closeTime: '21:00',
    slotDurationMinutes: 60,
    capacityPerSlot: 40,
    feePerBooking: 40000,
    changeDeadlineHours: 24,
  });
  const short = bookingFieldsOf({ openTime: '10:00', closeTime: '10:30' });
  assert.equal(short.slotDurationMinutes, 30);
  assert.equal(short.capacityPerSlot, 10);
  assert.equal(short.feePerBooking, 0);
});

test('chạy thử không ghi; --apply đổi WALK_IN → BOOKING, xóa trường cũ; chạy lại không đổi gì', async () => {
  await col('amenities').insertMany([
    { name: 'Gym', accessMode: 'WALK_IN', openTime: '05:00', closeTime: '22:00', perVisitFeeAdult: 50000, perVisitFeeChild: 30000, monthlyPassFeeAdult: 400000, monthlyPassFeeChild: 250000 },
    { name: 'Tennis', accessMode: 'BOOKING', openTime: '05:00', closeTime: '22:00', slotDurationMinutes: 60, capacityPerSlot: 1, feePerBooking: 100000, monthlyPassFeeAdult: 600000 },
  ]);
  await col('bookings').insertOne({ passId: null, fee: 0 });

  const plan = await migrateWalkInAmenities();
  assert.deepEqual(plan.converted.map((c) => c.name), ['Gym']);
  assert.equal(plan.cleaned, 2);
  assert.equal((await col('amenities').findOne({ name: 'Gym' })).accessMode, 'WALK_IN', 'chạy thử không ghi');

  const done = await migrateWalkInAmenities({ apply: true });
  assert.equal(done.cleaned, 2);
  assert.equal(done.bookings, 1);
  const gym = await col('amenities').findOne({ name: 'Gym' });
  assert.equal(gym.accessMode, 'BOOKING');
  assert.equal(gym.feePerBooking, 50000);
  assert.equal(gym.perVisitFeeAdult, undefined);
  assert.equal((await col('amenities').findOne({ name: 'Tennis' })).monthlyPassFeeAdult, undefined);

  const again = await migrateWalkInAmenities({ apply: true });
  assert.deepEqual([again.converted.length, again.cleaned, again.bookings], [0, 0, 0]);
});

// Sửa tiện ích khi còn booking sắp tới: không đổi lưới slot (giờ mở cửa / thời lượng slot), không giảm sức chứa
// xuống dưới số chỗ đã đặt của slot đông nhất. Đổi phí / tên vẫn được (booking giữ snapshot phí).
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Amenity } from '../../src/models/index.js';
import { updateAmenity } from '../../src/modules/amenities/amenities.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createApartment, createManager } from '../helpers/fixtures.js';
import { createAmenity, createBooking } from '../helpers/fixtures.moduleBDE.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const tomorrowAt = (hh) => {
  const d = new Date(Date.now() + 24 * 3_600_000);
  return new Date(`${d.toISOString().slice(0, 10)}T${hh}:00:00+07:00`);
};

test('còn booking sắp tới: không đổi thời lượng slot / giờ mở cửa; đổi phí, tên vẫn được', async () => {
  const manager = asUser(await createManager());
  const amenity = await createAmenity();
  await createBooking({ amenity, apartment: await createApartment(), startAt: tomorrowAt('09') });

  await assert.rejects(updateAmenity(manager, amenity._id, { slotDurationMinutes: 90 }), { errorCode: 'AMENITY_HAS_ACTIVE_BOOKINGS' });
  await assert.rejects(updateAmenity(manager, amenity._id, { openTime: '07:00' }), { errorCode: 'AMENITY_HAS_ACTIVE_BOOKINGS' });
  const updated = await updateAmenity(manager, amenity._id, { feePerBooking: 70000, name: 'Sân mới', changeDeadlineHours: 12 });
  assert.equal(updated.feePerBooking, 70000);
  assert.equal(updated.changeDeadlineHours, 12);
  assert.equal((await Amenity.findById(amenity._id).lean()).slotDurationMinutes, 60);
});

test('giảm sức chứa: không thấp hơn số chỗ đã đặt của slot đông nhất', async () => {
  const manager = asUser(await createManager());
  const amenity = await createAmenity({ capacityPerSlot: 3 });
  const at = tomorrowAt('09');
  await createBooking({ amenity, apartment: await createApartment(), startAt: at });
  await createBooking({ amenity, apartment: await createApartment(), startAt: at });

  await assert.rejects(updateAmenity(manager, amenity._id, { capacityPerSlot: 1 }), /đã đặt 2 chỗ/);
  assert.equal((await updateAmenity(manager, amenity._id, { capacityPerSlot: 2 })).capacityPerSlot, 2);
});

test('không có booking sắp tới thì đổi lưới slot bình thường', async () => {
  const manager = asUser(await createManager());
  const amenity = await createAmenity();
  assert.equal((await updateAmenity(manager, amenity._id, { slotDurationMinutes: 90 })).slotDurationMinutes, 90);
});

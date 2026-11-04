// Tham số hệ thống cho phép 0 = tắt; CCCD khách mã hóa; lookup tiện ích theo quyền; giới hạn dung lượng ảnh theo cấu hình.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { GuestLog, SystemConfig } from '../../src/models/index.js';
import { assertValidValue } from '../../src/modules/systemConfigs/configRules.js';
import * as guests from '../../src/modules/guests/guests.service.js';
import { uploadImages } from '../../src/services/upload.service.js';
import { errorHandler } from '../../src/middlewares/errorHandler.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createApartment, createBuilding, createHousehold, createSecurity } from '../helpers/fixtures.js';
import { createAmenity } from '../helpers/fixtures.moduleBDE.js';
import { startApp } from '../helpers/http.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

test('tham số: BOOKING_PAYMENT_HOLD_MINUTES đặt về 0 được; tham số khác vẫn phải > 0', () => {
  assert.doesNotThrow(() => assertValidValue('BOOKING_PAYMENT_HOLD_MINUTES', 15, 0));
  assert.throws(() => assertValidValue('BOOKING_PAYMENT_HOLD_MINUTES', 15, -1), { errorCode: 'VALIDATION_ERROR' });
  assert.throws(() => assertValidValue('SLA_HOURS_URGENT', 24, 0), { errorCode: 'VALIDATION_ERROR' });
});

test('khách vãng lai: CCCD lưu mã hóa + hash, trả về đã che', async () => {
  const { apartment } = await createHousehold();
  const guard = asUser(await createSecurity());
  const log = await guests.walkIn(guard, { apartmentId: apartment._id, guestName: 'Khách A', idNumber: '012345678901' });
  const raw = await GuestLog.findById(log._id).select('+idNumberEnc +idNumberHash').lean();
  assert.equal(raw.idNumber ?? null, null, 'không lưu CCCD dạng rõ');
  assert.ok(raw.idNumberEnc && raw.idNumberHash);
  assert.equal(log.idNumber, '********8901');

  const { items } = await guests.listGuests(guard, { page: 1, limit: 20 });
  assert.equal(items[0].idNumber, '********8901');
  assert.equal(items[0].idNumberEnc, undefined);
  assert.equal(items[0].idNumberHash, undefined);
});

test('sổ khách: dữ liệu cũ còn CCCD dạng rõ vẫn hiển thị đã che', async () => {
  const { apartment } = await createHousehold();
  const guard = asUser(await createSecurity());
  await GuestLog.collection.insertOne({ apartmentId: apartment._id, guestName: 'Cũ', idNumber: '079912345678', status: 'CHECKED_IN', createdAt: new Date() });
  const { items } = await guests.listGuests(guard, { page: 1, limit: 20 });
  assert.equal(items[0].idNumber, '********5678');
});

test('lookup tiện ích: cư dân chỉ thấy tiện ích đang mở, dùng chung hoặc thuộc tòa của mình', async () => {
  const { user, building } = await createHousehold();
  const other = await createBuilding();
  await createApartment(other);
  const shared = await createAmenity({ name: 'Chung' });
  const mine = await createAmenity({ name: 'Tòa mình', buildingId: building._id });
  await createAmenity({ name: 'Tòa khác', buildingId: other._id });
  await createAmenity({ name: 'Đã ngừng', isActive: false });

  const app = await startApp();
  try {
    const res = await app.request('GET', '/lookups/amenities', { user: { id: String(user._id), role: 'RESIDENT' } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.map((a) => a.name).sort(), [shared.name, mine.name].sort());

    const staff = await app.request('GET', '/lookups/amenities', { user: { role: 'MANAGER' } });
    assert.equal(staff.body.data.length, 4);
  } finally {
    await app.close();
  }
});

test('upload ảnh: vượt UPLOAD_MAX_SIZE_MB cấu hình → 400', async () => {
  await SystemConfig.create({ key: 'UPLOAD_MAX_SIZE_MB', value: 1, scope: 'TECHNICAL' });
  const app = express();
  app.post('/up', uploadImages('images', 2), (req, res) => res.json({ n: req.files.length }));
  app.use(errorHandler);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const png = (size) => {
      const buf = Buffer.alloc(size);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf);
      return new Blob([buf], { type: 'image/png' });
    };
    const send = async (size) => {
      const form = new FormData();
      form.append('images', png(size), 'a.png');
      const res = await fetch(`http://127.0.0.1:${server.address().port}/up`, { method: 'POST', body: form });
      return { status: res.status, body: await res.json() };
    };
    assert.equal((await send(500_000)).status, 200);
    const big = await send(1_500_000);
    assert.equal(big.status, 400);
    assert.match(big.body.message, /1MB/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

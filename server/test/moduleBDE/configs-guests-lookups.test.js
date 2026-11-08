// Kiểm thử Module 7: khách phải được đồng ý, bưu kiện chống bàn giao trùng, tuần tra đúng ca và cảnh báo khẩn đúng người.
import { randomUUID } from 'node:crypto';
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Writable } from 'node:stream';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../../src/config/env.js';
import guestsRouter from '../../src/modules/guests/guests.routes.js';
import { GuestLog, SystemConfig, DutyShift, Notification } from '../../src/models/index.js';
import { Parcel, PatrolTour, SecurityIncident } from '../../src/models/GuestLog.js';
import { assertValidValue } from '../../src/modules/systemConfigs/configRules.js';
import * as guests from '../../src/modules/guests/guests.service.js';
import { uploadImages } from '../../src/services/upload.service.js';
import { errorHandler } from '../../src/middlewares/errorHandler.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createApartment, createBuilding, createHousehold, createSecurity, createManager, createReceptionist, createTechnician, createTicket } from '../helpers/fixtures.js';
import { createAmenity } from '../helpers/fixtures.moduleBDE.js';
import { startApp, tokenFor } from '../helpers/http.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

test('tham số: BOOKING_PAYMENT_HOLD_MINUTES đặt về 0 được; tham số khác vẫn phải > 0', () => {
  assert.doesNotThrow(() => assertValidValue('BOOKING_PAYMENT_HOLD_MINUTES', 15, 0));
  assert.throws(() => assertValidValue('BOOKING_PAYMENT_HOLD_MINUTES', 15, -1), { errorCode: 'VALIDATION_ERROR' });
  assert.throws(() => assertValidValue('SLA_HOURS_URGENT', 24, 0), { errorCode: 'VALIDATION_ERROR' });
});

test('khách vãng lai: chỉ giữ 4 số cuối, dữ liệu mới không lưu toàn bộ CCCD', async () => {
  const { apartment } = await createHousehold();
  const guard = asUser(await createSecurity());
  const log = await guests.walkIn(guard, { apartmentId: apartment._id, guestName: 'Khách A', idNumber: '8901' });
  const raw = await GuestLog.findById(log._id).select('+idNumberEnc +idNumberHash').lean();
  assert.equal(raw.idNumber ?? null, null, 'không lưu CCCD dạng rõ');
  assert.equal(raw.idNumberEnc, null);
  assert.equal(raw.idNumberHash, null);
  assert.equal(raw.idLast4, '8901');
  assert.equal(log.idNumber, '********8901');

  const { items } = await guests.listGuests(guard, { page: 1, limit: 20 });
  assert.equal(items[0].idNumber, '********8901');
  assert.equal(items[0].idNumberEnc, undefined);
  assert.equal(items[0].idNumberHash, undefined);
});

test('Module 7: khách chờ cư dân đúng căn đồng ý; từ chối không được check-in', async () => {
  const home = await createHousehold();
  const other = await createHousehold();
  const guard = asUser(await createSecurity());
  const log = await guests.walkIn(guard, { apartmentId: home.apartment._id, guestName: 'Khách chờ' });
  assert.equal(log.status, 'EXPECTED');
  assert.equal(log.checkInTime, null);
  await assert.rejects(guests.checkIn(guard, log._id, {}), /cư dân đồng ý/);
  await assert.rejects(guests.confirmGuest(asUser(other.user), log._id, true), { status: 403 });
  await guests.confirmGuest(asUser(home.user), log._id, true);
  assert.equal((await guests.checkIn(guard, log._id, {})).status, 'CHECKED_IN');
  assert.equal((await guests.checkOut(guard, log._id)).status, 'CHECKED_OUT');
  await assert.rejects(guests.checkOut(guard, log._id));
  const denied = await guests.walkIn(guard, { apartmentId: home.apartment._id, guestName: 'Khách bị từ chối' });
  await guests.confirmGuest(asUser(home.user), denied._id, false);
  await assert.rejects(guests.checkIn(guard, denied._id, {}), /cư dân đồng ý/);
});

test('Module 7: bưu kiện chỉ giao thành viên đúng căn, hai request chỉ một lần bàn giao, chữ ký không lộ', async () => {
  const home = await createHousehold();
  const other = await createHousehold();
  const receptionist = asUser(await createReceptionist());
  const parcel = await guests.receiveParcel(receptionist, { apartmentId: home.apartment._id, trackingCode: 'VAN-DON-1', carrier: 'Đơn vị A' }, ['https://example.test/photo.png']);
  const signature = 'data:image/png;base64,' + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(120, 1)]).toString('base64');
  await assert.rejects(guests.handOverParcel(receptionist, parcel._id, { recipientId: other.user._id, signature }), /đúng căn/);
  const results = await Promise.allSettled([1, 2].map(() => guests.handOverParcel(receptionist, parcel._id, { recipientId: home.user._id, signature })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await Parcel.findById(parcel._id)).status, 'COLLECTED');
  const listed = await guests.listOperations(asUser(home.user), 'parcels');
  assert.equal(listed.items[0].signature, undefined);
  assert.equal((await guests.parcelReceipt(receptionist, parcel._id)).signature, signature);
  await assert.rejects(guests.parcelReceipt(asUser(home.user), parcel._id), { status: 403 });
  assert.equal((await guests.listOperations(asUser(other.user), 'parcels')).items.length, 0);
  await assert.rejects(guests.listOperations(asUser(other.user), 'parcels', { apartmentId: String(home.apartment._id) }), { status: 403 });
});

test('Module 7: tuần tra chỉ nhận QR thuộc lượt, đúng người/ca; không GPS vẫn được; quét trùng chỉ tính một', async () => {
  const manager = asUser(await createManager());
  const guard = asUser(await createSecurity());
  const stranger = asUser(await createSecurity());
  const now = new Date();
  const shift = await DutyShift.create({ roleTitle: 'SECURITY', userId: guard.id, startAt: new Date(+now - 60000), endAt: new Date(+now + 3600000) });
  const point = await guests.createCheckpoint(manager, { name: 'Góc hầm', location: 'Hầm B1' });
  const tour = await guests.createTour(manager, { name: 'Lượt 1', shiftId: shift._id, startAt: new Date(+now - 30000), endAt: new Date(+now + 1800000), checkpointIds: [String(point._id)] });
  const code = `CP1.${point.token}`;
  await assert.rejects(guests.scanCheckpoint(stranger, tour._id, { code }), { status: 403 });
  await assert.rejects(guests.scanCheckpoint(guard, tour._id, { code: 'CP1.sai' }));
  const results = await Promise.allSettled([1, 2].map(() => guests.scanCheckpoint(guard, tour._id, { code })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const saved = await PatrolTour.findById(tour._id).lean();
  assert.equal(saved.scans.length, 1);
  assert.equal(saved.scans[0].latitude, undefined);
  await assert.rejects(guests.scanCheckpoint(guard, tour._id, { code }, new Date(+now + 3600001)), { status: 403 });
  assert.equal((await guests.listOperations(guard, 'checkpoints')).items[0].token, undefined);
});

test('Module 7: cron nhắc bưu kiện 3 ngày một lần duy nhất, quá 14 ngày chờ trả rồi xác nhận trả thật', async () => {
  const home = await createHousehold();
  const receptionist = asUser(await createReceptionist());
  const now = new Date();
  const parcel = await Parcel.create({ apartmentId: home.apartment._id, trackingCode: 'OLD', carrier: 'Vận chuyển', imageUrls: ['https://example.test/p.png'], receivedBy: receptionist.id });
  await Parcel.collection.updateOne({ _id: parcel._id }, { $set: { createdAt: new Date(+now - 4 * 86400000) } });
  await guests.runOperationsJobs(now);
  await guests.runOperationsJobs(now);
  assert.equal(await Notification.countDocuments({ refId: parcel._id, title: 'Nhắc nhận bưu kiện' }), 1);
  await guests.runOperationsJobs(new Date(+now + 11 * 86400000));
  assert.equal((await Parcel.findById(parcel._id)).status, 'AWAITING_RETURN');
  assert.equal((await guests.handOverParcel(receptionist, parcel._id, { returned: true })).status, 'RETURNED');
  await assert.rejects(guests.handOverParcel(receptionist, parcel._id, { returned: true }));
});

test('Module 7: cảnh báo khẩn nhắc sau 15 phút, chỉ người đang trực/manager tiếp nhận và dừng nhắc', async () => {
  const manager = asUser(await createManager());
  const guard = asUser(await createSecurity());
  const onDuty = asUser(await createSecurity());
  const now = new Date();
  await DutyShift.create({ roleTitle: 'SECURITY', userId: onDuty.id, startAt: new Date(+now - 60000), endAt: new Date(+now + 3600000) });
  const incident = await guests.reportIncident(guard, { requestId: randomUUID(), type: 'FIRE', location: 'Tầng 1', description: 'Khói bất thường ở hành lang' }, ['https://example.test/scene.png']);
  assert.equal(await Notification.countDocuments({ refId: incident._id }), 2);
  await guests.runOperationsJobs(new Date(+now + 5 * 60000));
  assert.equal(await Notification.countDocuments({ refId: incident._id }), 2);
  await guests.runOperationsJobs(new Date(+now + 16 * 60000));
  assert.equal(await Notification.countDocuments({ refId: incident._id }), 4);
  await assert.rejects(guests.acknowledgeIncident(guard, incident._id), { status: 403 });
  assert.equal((await guests.activeAlerts(onDuty))[0].canAcknowledge, true);
  await guests.acknowledgeIncident(manager, incident._id);
  await guests.runOperationsJobs(new Date(+now + 32 * 60000));
  assert.equal(await Notification.countDocuments({ refId: incident._id }), 4);
  assert.equal((await guests.activeAlerts(manager)).length, 0);
});

test('Module 7: gửi báo khẩn đồng thời chỉ tạo một sự cố và một lượt cảnh báo', async () => {
  await createManager();
  const guard = asUser(await createSecurity());
  const data = { requestId: randomUUID(), type: 'SECURITY', location: 'Sảnh', description: 'Phát hiện người khả nghi' };
  const results = await Promise.all([guests.reportIncident(guard, data, ['https://example.test/scene.png']), guests.reportIncident(guard, data, ['https://example.test/scene.png'])]);
  assert.equal(String(results[0]._id), String(results[1]._id));
  assert.equal(await SecurityIncident.countDocuments({ requestId: data.requestId }), 1);
  assert.equal(await Notification.countDocuments({ refId: results[0]._id }), 1);
});

test('N5-01: service chặn ảnh hiện trường thiếu/rỗng/sai; không tạo sự cố hoặc thông báo', async () => {
  const guard = asUser(await createSecurity());
  const data = { requestId: randomUUID(), type: 'FIRE', location: 'Hầm', description: 'Có khói bất thường' };
  for (const images of [undefined, [], [''], ['javascript:alert(1)'], 'https://example.test/scene.png', Array(4).fill('https://example.test/a.png')]) {
    await assert.rejects(guests.reportIncident(guard, data, images), { status: 400 });
  }
  assert.equal(await SecurityIncident.countDocuments(), 0);
  assert.equal(await Notification.countDocuments(), 0);
});

test('N5-01: HTTP chặn thiếu/giả ảnh trước upload, ảnh hợp lệ lưu báo cáo và gửi cảnh báo', async (t) => {
  await createManager();
  const guard = asUser(await createSecurity());
  const enabled = env.cloudinary.enabled;
  env.cloudinary.enabled = true;
  t.after(() => { env.cloudinary.enabled = enabled; });
  const upload = t.mock.method(cloudinary.uploader, 'upload_stream', (_options, callback) => new Writable({
    write(_chunk, _encoding, done) { done(); },
    final(done) { callback(null, { secure_url: 'https://example.test/scene.png' }); done(); },
  }));
  const app = express(); app.use(express.json()); app.use('/guests', guestsRouter); app.use(errorHandler);
  const server = app.listen(0); await new Promise((resolve) => server.once('listening', resolve));
  try {
    const send = async (bytes, mime = 'image/png') => {
      const body = new FormData();
      for (const [key, value] of Object.entries({ requestId: randomUUID(), type: 'FIRE', location: 'Hầm', description: 'Khói bất thường' })) body.append(key, value);
      if (bytes !== undefined) body.append('images', new Blob([bytes], { type: mime }), 'scene.png');
      return fetch(`http://127.0.0.1:${server.address().port}/guests/incidents`, { method: 'POST', headers: { authorization: `Bearer ${tokenFor(guard)}` }, body });
    };
    assert.equal((await send()).status, 400);
    assert.equal((await send('<script>fake</script>')).status, 400);
    assert.equal((await send('not-an-image', 'text/plain')).status, 400);
    assert.equal(upload.mock.callCount(), 0);
    assert.equal(await SecurityIncident.countDocuments(), 0);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8S8AAAAASUVORK5CYII=', 'base64');
    assert.equal((await send(png)).status, 201);
    assert.equal(upload.mock.callCount(), 1);
    assert.deepEqual((await SecurityIncident.findOne().lean()).imageUrls, ['https://example.test/scene.png']);
    assert.equal(await Notification.countDocuments(), 1);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('Module 7: HTTP chặn sai quyền, CCCD dài, ảnh thiếu và dữ liệu scan sai', async () => {
  const app = await startApp();
  try {
    const guard = asUser(await createSecurity());
    const receptionist = asUser(await createReceptionist());
    const home = await createHousehold();
    const request = (method, url, user, body) => app.request(method, url, { user, body });
    assert.equal((await request('POST', '/guests/parcels', guard, {})).status, 403);
    assert.equal((await request('POST', '/guests/parcels', receptionist, { apartmentId: String(home.apartment._id), trackingCode: 'AB', carrier: 'A' })).status, 400);
    assert.equal((await request('POST', '/guests/walk-in', guard, { apartmentId: String(home.apartment._id), guestName: 'Khách', idNumber: '012345678901' })).status, 400);
    assert.equal((await request('GET', '/guests/operations/incidents', asUser(home.user))).status, 403);
    assert.equal((await request('GET', '/guests/alerts', asUser(home.user))).status, 200);
  } finally { await app.close(); }
});

test('Module 7: sự cố kỹ thuật dùng ticket gốc, tiếp nhận ở ticket dừng banner; retention đọc cấu hình', async () => {
  const home = await createHousehold();
  const manager = asUser(await createManager());
  const technician = await createTechnician();
  const ticket = await createTicket({ apartment: home.apartment, createdBy: home.user, priority: 'URGENT', ackDueAt: new Date(Date.now() - 60000) });
  await guests.runOperationsJobs();
  await guests.runOperationsJobs();
  assert.equal(await SecurityIncident.countDocuments({ sourceTicketId: ticket._id }), 1);
  ticket.assignedTo = technician._id; ticket.status = 'IN_PROGRESS'; await ticket.save();
  await guests.runOperationsJobs();
  assert.equal((await guests.activeAlerts(manager)).length, 0);
  await SystemConfig.create({ key: 'GUEST_RETENTION_MONTHS', value: 1, scope: 'BUSINESS' });
  await GuestLog.collection.insertOne({ apartmentId: home.apartment._id, guestName: 'Khách cũ', createdAt: new Date(Date.now() - 62 * 86400000) });
  await guests.runOperationsJobs();
  assert.equal(await GuestLog.countDocuments({ guestName: 'Khách cũ' }), 0);
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

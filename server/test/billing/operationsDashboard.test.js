// Mô đun 9 — Dashboard vận hành (UC60, 5.3–5.4): sự cố, phản ánh, bảo trì, cư dân, tiện ích; xuất file; phân quyền.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { AmenityVisit, Resident, WorkOrder } from '../../src/models/index.js';
import { operationsDashboard } from '../../src/modules/reports/operations.service.js';
import { exportReport } from '../../src/modules/reports/reports.export.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { createHousehold, createTechnician, createTicket } from '../helpers/fixtures.js';
import { createAmenity, createBooking } from '../helpers/fixtures.moduleBDE.js';
import { startApp } from '../helpers/http.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const NOW = new Date('2026-11-07T03:00:00Z');
const d = (s) => new Date(`${s}T03:00:00Z`);
const H = 3_600_000;

async function seed() {
  const { user, apartment } = await createHousehold();
  const techA = await createTechnician({ fullName: 'KTV An' });
  const techB = await createTechnician({ fullName: 'KTV Bình' });
  const at = (date, action, by) => ({ at: date, by: by._id, action });

  // Sự cố tháng 10: A nhận đúng hạn + xử lý đúng hạn (5 sao); B nhận trễ + xử lý trễ (3 sao)
  await createTicket({
    apartment, createdBy: user, createdAt: d('2026-10-01'), status: 'CLOSED', assignedTo: techA._id, rating: 5,
    ackDueAt: new Date(d('2026-10-01').getTime() + H), dueDate: d('2026-10-03'), resolvedAt: d('2026-10-02'), closedAt: d('2026-10-03'),
    history: [at(d('2026-10-01'), 'CREATED', user), at(new Date(d('2026-10-01').getTime() + 0.5 * H), 'CLAIMED', techA)],
  });
  await createTicket({
    apartment, createdBy: user, createdAt: d('2026-10-10'), status: 'CLOSED', assignedTo: techB._id, rating: 3,
    ackDueAt: new Date(d('2026-10-10').getTime() + H), dueDate: d('2026-10-12'), resolvedAt: d('2026-10-15'), closedAt: d('2026-10-16'),
    history: [at(d('2026-10-10'), 'CREATED', user), at(new Date(d('2026-10-10').getTime() + 3 * H), 'CLAIMED', techB)],
  });
  // Sự cố tháng 11 còn mở và đã quá hạn
  await createTicket({ apartment, createdBy: user, createdAt: d('2026-11-01'), status: 'IN_PROGRESS', assignedTo: techA._id, dueDate: d('2026-11-03') });

  // Phản ánh: 1 phản hồi đúng hạn, 1 chưa phản hồi đã quá hạn
  await createTicket({
    apartment, createdBy: user, type: 'COMPLAINT', createdAt: d('2026-10-05'), status: 'CLOSED',
    responseDueAt: d('2026-10-07'), respondedAt: new Date(d('2026-10-05').getTime() + 24 * H),
  });
  await createTicket({ apartment, createdBy: user, type: 'COMPLAINT', createdAt: d('2026-11-02'), status: 'NEW', responseDueAt: d('2026-11-04') });

  // Bảo trì: tháng 10 xong đúng hạn + xong trễ; tháng 11 còn mở đã quá hạn
  const assetId = new mongoose.Types.ObjectId();
  await WorkOrder.create([
    { assetId, type: 'SCHEDULED', status: 'DONE', scheduledDate: d('2026-10-05'), completedAt: d('2026-10-05') },
    { assetId, type: 'SCHEDULED', status: 'DONE', scheduledDate: d('2026-10-06'), completedAt: d('2026-10-10') },
    { assetId, type: 'SCHEDULED', status: 'PENDING', scheduledDate: d('2026-11-01') },
  ]);

  // Cư dân: 1 vào ở tháng 10, 1 chuyển đi tháng 11
  await Resident.updateOne({ userId: user._id }, { $set: { moveInDate: d('2026-10-01') } });
  const { user: leaver } = await createHousehold();
  await Resident.updateOne({ userId: leaver._id }, { $set: { moveInDate: d('2025-01-01'), moveOutDate: d('2026-11-02'), isActive: false } });

  // Tiện ích: 2 lượt đặt + 1 lượt vào cửa
  const gym = await createAmenity({ name: 'Phòng gym' });
  await createBooking({ amenity: gym, apartment, startAt: d('2026-10-20') });
  await createBooking({ amenity: gym, apartment, startAt: d('2026-10-21') });
  await createBooking({ amenity: gym, apartment, startAt: d('2026-10-22'), status: 'CANCELLED' });
  await AmenityVisit.create({ amenityId: gym._id, apartmentId: apartment._id, userId: user._id, visitedAt: d('2026-10-23'), ageGroup: 'ADULT', billingMonth: '2026-10', fee: 0, chargeType: 'FREE', recordedBy: techA._id });
  return { techA, techB };
}

test('sự cố: theo tháng, nhận / xử lý đúng hạn, đang quá hạn, xếp hạng kỹ thuật viên theo số sao', async () => {
  await seed();
  const r = await operationsDashboard({ from: '2026-10', to: '2026-11' }, { now: NOW });
  const inc = r.incidents;
  assert.equal(inc.total, 3);
  assert.equal(inc.open, 1);
  assert.equal(inc.overdueNow, 1);
  assert.equal(inc.resolved, 2);
  assert.equal(inc.onTimeRate, 0.5);
  assert.equal(inc.ackOnTimeRate, 0.5);
  assert.equal(inc.avgRating, 4);
  assert.deepEqual(inc.byMonth.map((m) => [m.period, m.created, m.resolved, m.onTime]), [
    ['2026-10', 2, 2, 1],
    ['2026-11', 1, 0, 0],
  ]);
  assert.deepEqual(inc.technicians.map((t) => [t.fullName, t.avgRating]), [
    ['KTV An', 5],
    ['KTV Bình', 3],
  ]);
});

test('phản ánh, bảo trì, cư dân, tiện ích', async () => {
  await seed();
  const r = await operationsDashboard({ from: '2026-10', to: '2026-11' }, { now: NOW });

  assert.equal(r.complaints.count, 2);
  assert.equal(r.complaints.responded, 1);
  assert.equal(r.complaints.overdue, 1);
  assert.equal(r.complaints.onTimeRate, 1);
  assert.equal(r.complaints.avgResponseHours, 24);
  assert.equal(r.complaints.byCategory.length, 2);

  assert.equal(r.maintenance.scheduled, 3);
  assert.equal(r.maintenance.done, 2);
  assert.equal(r.maintenance.onTimeRate, 0.5);
  assert.equal(r.maintenance.overdueOpen, 1);

  assert.equal(r.residents.moveIn, 1);
  assert.equal(r.residents.moveOut, 1);
  assert.deepEqual(r.residents.byMonth.map((m) => [m.moveIn, m.moveOut]), [[1, 0], [0, 1]]);
  assert.equal(r.residents.occupancy.total, 2);

  const gym = r.amenities.find((a) => a.name === 'Phòng gym');
  assert.equal(gym.bookings, 2, 'booking đã hủy không tính');
  assert.equal(gym.visits, 1);
  assert.equal(JSON.stringify(r).includes('totalAmount'), false, 'không có số liệu tài chính');
});

test('xuất Excel / PDF dashboard vận hành; chỉ Trưởng BQL xem', async () => {
  await seed();
  const q = { from: '2026-10', to: '2026-11' };
  assert.equal((await exportReport('operations', 'pdf', q)).buffer.subarray(0, 4).toString(), '%PDF');
  assert.equal((await exportReport('operations', 'xlsx', q)).buffer.subarray(0, 2).toString(), 'PK');

  const app = await startApp();
  try {
    assert.equal((await app.request('GET', '/reports/operations-kpi?from=2026-10&to=2026-11', { user: { role: 'MANAGER' } })).status, 200);
    assert.equal((await app.request('GET', '/reports/operations-kpi', { user: { role: 'ACCOUNTANT' } })).status, 403);
    assert.equal((await app.request('GET', '/reports/operations-kpi?from=2026-11&to=2026-10', { user: { role: 'MANAGER' } })).status, 400);
  } finally {
    await app.close();
  }
});

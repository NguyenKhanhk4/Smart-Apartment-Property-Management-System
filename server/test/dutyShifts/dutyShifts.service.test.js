// Service lịch ca trực trên MongoDB trong RAM: chặn trùng ca, ai đang trực, hủy ca.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DutyShift } from '../../src/models/index.js';
import * as service from '../../src/modules/dutyShifts/dutyShifts.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createManager, createSecurity, createTechnician } from '../helpers/fixtures.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const H = 3_600_000;
const window = (fromH, toH, base = Date.now()) => ({
  startAt: new Date(base + fromH * H).toISOString(),
  endAt: new Date(base + toH * H).toISOString(),
});

test('xếp ca lặp 3 ngày tạo 3 bản ghi', async () => {
  const manager = asUser(await createManager());
  const tech = await createTechnician();
  const shifts = await service.createShifts(manager, { roleTitle: 'TECHNICIAN', userId: tech._id, ...window(1, 9), repeatDays: 3 });
  assert.equal(shifts.length, 3);
  assert.equal(await DutyShift.countDocuments(), 3);
});

test('chặn ca trùng giờ của cùng nhân viên, cho phép ca nối tiếp', async () => {
  const manager = asUser(await createManager());
  const tech = await createTechnician();
  const base = Date.now();
  await service.createShifts(manager, { roleTitle: 'TECHNICIAN', userId: tech._id, ...window(1, 9, base) });
  await assert.rejects(
    service.createShifts(manager, { roleTitle: 'TECHNICIAN', userId: tech._id, ...window(8, 16, base) }),
    { errorCode: 'DUTY_SHIFT_OVERLAP' },
  );
  await service.createShifts(manager, { roleTitle: 'TECHNICIAN', userId: tech._id, ...window(9, 17, base) });
  assert.equal(await DutyShift.countDocuments(), 2);
});

test('không xếp ca cho người sai chức danh', async () => {
  const manager = asUser(await createManager());
  const guard = await createSecurity();
  await assert.rejects(
    service.createShifts(manager, { roleTitle: 'TECHNICIAN', userId: guard._id, ...window(1, 9) }),
    { errorCode: 'VALIDATION_ERROR' },
  );
});

test('getOnDuty: trực chính + dự phòng đang trong ca, bỏ ca chưa tới', async () => {
  const manager = asUser(await createManager());
  const [a, b, c] = await Promise.all([createTechnician(), createTechnician(), createTechnician()]);
  await service.createShifts(manager, { roleTitle: 'TECHNICIAN', userId: a._id, ...window(-1, 7) });
  await service.createShifts(manager, { roleTitle: 'TECHNICIAN', userId: b._id, ...window(-1, 7), isBackup: true });
  await service.createShifts(manager, { roleTitle: 'TECHNICIAN', userId: c._id, ...window(7, 15) });

  const onDuty = await service.getOnDuty('TECHNICIAN');
  assert.equal(onDuty.hasSchedule, true);
  assert.deepEqual(onDuty.primary.map((p) => String(p._id)), [String(a._id)]);
  assert.deepEqual(onDuty.backup.map((p) => String(p._id)), [String(b._id)]);
  assert.equal(await service.isUserOnDuty(a._id, 'TECHNICIAN'), true);
  assert.equal(await service.isUserOnDuty(c._id, 'TECHNICIAN'), false);
});

test('không xóa được ca đã kết thúc', async () => {
  const manager = asUser(await createManager());
  const tech = await createTechnician();
  const [past] = await DutyShift.create([{ roleTitle: 'TECHNICIAN', userId: tech._id, ...window(-10, -2) }]);
  await assert.rejects(service.deleteShift(manager, past._id), { errorCode: 'VALIDATION_ERROR' });
});

test('2 request xếp ca trùng nhau gửi đồng thời: không bao giờ tạo được cả 2', async () => {
  const manager = asUser(await createManager());
  const tech = await createTechnician();
  const body = { roleTitle: 'TECHNICIAN', userId: tech._id, ...window(1, 9) };
  const results = await Promise.allSettled([service.createShifts(manager, body), service.createShifts(manager, body)]);
  assert.ok(results.some((r) => r.status === 'rejected'));
  assert.ok((await DutyShift.countDocuments()) <= 1);
});

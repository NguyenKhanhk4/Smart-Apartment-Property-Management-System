// Service lịch ca trực trên MongoDB trong RAM: chặn trùng ca, ai đang trực, hủy ca.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DutyShift, User } from '../../src/models/index.js';
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
  const shifts = await service.createShifts(manager, { roleTitle: 'TECHNICIAN', userIds: [tech._id], ...window(1, 9), repeatDays: 3 });
  assert.equal(shifts.length, 3);
  assert.equal(await DutyShift.countDocuments(), 3);
});

test('chặn ca trùng giờ của cùng nhân viên, cho phép ca nối tiếp', async () => {
  const manager = asUser(await createManager());
  const tech = await createTechnician();
  const base = Date.now();
  await service.createShifts(manager, { roleTitle: 'TECHNICIAN', userIds: [tech._id], ...window(1, 9, base) });
  await assert.rejects(
    service.createShifts(manager, { roleTitle: 'TECHNICIAN', userIds: [tech._id], ...window(8, 16, base) }),
    { errorCode: 'DUTY_SHIFT_OVERLAP' },
  );
  await service.createShifts(manager, { roleTitle: 'TECHNICIAN', userIds: [tech._id], ...window(9, 17, base) });
  assert.equal(await DutyShift.countDocuments(), 2);
});

test('không xếp ca cho người sai chức danh', async () => {
  const manager = asUser(await createManager());
  const guard = await createSecurity();
  await assert.rejects(
    service.createShifts(manager, { roleTitle: 'TECHNICIAN', userIds: [guard._id], ...window(1, 9) }),
    { errorCode: 'VALIDATION_ERROR' },
  );
});

test('getOnDuty: mọi người đang trong ca (1 ca nhiều người trực), bỏ ca chưa tới', async () => {
  const manager = asUser(await createManager());
  const [a, b, c] = await Promise.all([createTechnician(), createTechnician(), createTechnician()]);
  // Ca đang diễn ra ghi thẳng vào DB (qua service, ca bắt đầu 1 giờ trước có thể rơi vào hôm qua nếu chạy lúc 0h)
  await DutyShift.insertMany([a, b].map((u) => ({ roleTitle: 'TECHNICIAN', userId: u._id, ...window(-1, 7) })));
  await service.createShifts(manager, { roleTitle: 'TECHNICIAN', userIds: [c._id], ...window(7, 15) });

  const duty = await service.getOnDuty('TECHNICIAN');
  assert.equal(duty.hasSchedule, true);
  assert.deepEqual(duty.onDuty.map((p) => String(p._id)).sort(), [String(a._id), String(b._id)].sort());
  assert.equal(await service.isUserOnDuty(a._id, 'TECHNICIAN'), true);
  assert.equal(await service.isUserOnDuty(c._id, 'TECHNICIAN'), false);
});

test('xếp ca nhiều người cùng lúc: 1 người trùng giờ thì không tạo ca nào', async () => {
  const manager = asUser(await createManager());
  const [a, b] = await Promise.all([createTechnician(), createTechnician()]);
  const base = Date.now();
  const shifts = await service.createShifts(manager, { roleTitle: 'TECHNICIAN', userIds: [a._id, b._id], ...window(1, 9, base), repeatDays: 2 });
  assert.equal(shifts.length, 4);
  const c = await createTechnician();
  await assert.rejects(
    service.createShifts(manager, { roleTitle: 'TECHNICIAN', userIds: [c._id, a._id], ...window(8, 12, base) }),
    { errorCode: 'DUTY_SHIFT_OVERLAP' },
  );
  assert.equal(await DutyShift.countDocuments({ userId: c._id }), 0);
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
  const body = { roleTitle: 'TECHNICIAN', userIds: [tech._id], ...window(1, 9) };
  const results = await Promise.allSettled([service.createShifts(manager, body), service.createShifts(manager, body)]);
  assert.ok(results.some((r) => r.status === 'rejected'));
  assert.ok((await DutyShift.countDocuments()) <= 1);
});

test('sửa ca: chuyển sang ngày khác (kéo thả), đổi người; trùng giờ với ca khác của người mới thì chặn', async () => {
  const manager = asUser(await createManager());
  const a = await createTechnician();
  const b = await createTechnician();
  const base = Date.now();
  const [shift] = await service.createShifts(manager, { roleTitle: 'TECHNICIAN', userIds: [a._id], ...window(1, 9, base) });
  await service.createShifts(manager, { roleTitle: 'TECHNICIAN', userIds: [b._id], ...window(25, 33, base) });

  const moved = await service.updateShift(manager, shift._id, window(49, 57, base)); // dời sang 2 ngày sau
  assert.equal(new Date(moved.startAt).getTime(), base + 49 * H);
  const swapped = await service.updateShift(manager, shift._id, { userId: String(b._id) });
  assert.equal(String(swapped.userId._id), String(b._id));
  await assert.rejects(service.updateShift(manager, shift._id, window(26, 30, base)), { errorCode: 'DUTY_SHIFT_OVERLAP' });
  assert.equal(new Date((await DutyShift.findById(shift._id)).startAt).getTime(), base + 49 * H, 'bị chặn thì giữ nguyên ca');
});

test('sửa ca: ca đang diễn ra không đổi giờ bắt đầu, ca đã kết thúc không sửa được, không dời về quá khứ, sai chức danh bị chặn', async () => {
  const manager = asUser(await createManager());
  const tech = await createTechnician();
  const guard = await createSecurity();
  const base = Date.now();
  const running = await DutyShift.create({ roleTitle: 'TECHNICIAN', userId: tech._id, startAt: new Date(base - H), endAt: new Date(base + 3 * H) });
  const ended = await DutyShift.create({ roleTitle: 'TECHNICIAN', userId: tech._id, startAt: new Date(base - 10 * H), endAt: new Date(base - 5 * H) });
  const [future] = await service.createShifts(manager, { roleTitle: 'TECHNICIAN', userIds: [tech._id], ...window(5, 9, base) });

  await assert.rejects(service.updateShift(manager, running._id, { startAt: new Date(base).toISOString() }), /bắt đầu/);
  const extended = await service.updateShift(manager, running._id, { endAt: new Date(base + 4 * H).toISOString() });
  assert.equal(new Date(extended.endAt).getTime(), base + 4 * H);
  await assert.rejects(service.updateShift(manager, ended._id, { note: 'x' }), /đã kết thúc/);
  await assert.rejects(service.updateShift(manager, future._id, window(-3, 2, base)), /đã qua/);
  await assert.rejects(service.updateShift(manager, future._id, { userId: String(guard._id) }), /chức danh/);
});

test('lịch cũ chỉ để xem: không xếp ca cho ngày đã qua, không xếp ca đã kết thúc; ca hôm nay đang diễn ra vẫn xếp thêm được', async () => {
  const manager = asUser(await createManager());
  const tech = await createTechnician();
  const now = new Date('2026-11-10T08:00:00+07:00');
  const at = (iso) => new Date(iso).toISOString();
  const create = (startAt, endAt) => service.createShifts(manager, { roleTitle: 'TECHNICIAN', userIds: [tech._id], startAt: at(startAt), endAt: at(endAt) }, { now });

  await assert.rejects(create('2026-11-09T06:00:00+07:00', '2026-11-09T14:00:00+07:00'), /ngày đã qua/);
  await assert.rejects(create('2026-11-10T00:00:00+07:00', '2026-11-10T06:00:00+07:00'), /đã kết thúc/);
  const [running] = await create('2026-11-10T06:00:00+07:00', '2026-11-10T14:00:00+07:00');
  assert.ok(running);
});

test('UC37: sao chép tuần trước sang tuần mới (+7 ngày); bỏ qua người bị khóa, ca trùng giờ, ca đã qua', async () => {
  const manager = asUser(await createManager());
  const [a, b, locked] = await Promise.all([createTechnician(), createTechnician(), createTechnician()]);
  const now = new Date('2026-11-09T08:00:00+07:00'); // thứ Hai
  const lastWeek = new Date('2026-11-02T00:00:00+07:00');
  const at = (d, h) => new Date(d.getTime() + h * H);
  await DutyShift.insertMany([
    { roleTitle: 'TECHNICIAN', userId: a._id, startAt: at(lastWeek, 1 * 24 + 6), endAt: at(lastWeek, 1 * 24 + 14) }, // T3 → copy
    { roleTitle: 'TECHNICIAN', userId: b._id, startAt: at(lastWeek, 2 * 24 + 6), endAt: at(lastWeek, 2 * 24 + 14) }, // T4 → trùng ca có sẵn
    { roleTitle: 'TECHNICIAN', userId: locked._id, startAt: at(lastWeek, 3 * 24 + 6), endAt: at(lastWeek, 3 * 24 + 14) },
    { roleTitle: 'TECHNICIAN', userId: a._id, startAt: at(lastWeek, 6), endAt: at(lastWeek, 7) }, // T2 06–07 → tuần mới đã qua
  ]);
  await User.updateOne({ _id: locked._id }, { $set: { isActive: false } });
  await DutyShift.create({ roleTitle: 'TECHNICIAN', userId: b._id, startAt: at(lastWeek, 9 * 24 + 8), endAt: at(lastWeek, 9 * 24 + 16) });

  const res = await service.copyWeek(manager, { roleTitle: 'TECHNICIAN', weekStart: '2026-11-09T00:00:00+07:00' }, { now });
  assert.deepEqual(res, { created: 1, skipped: 3 });
  const copied = await DutyShift.findOne({ userId: a._id, startAt: at(lastWeek, 8 * 24 + 6) });
  assert.ok(copied);
  await assert.rejects(service.copyWeek(manager, { roleTitle: 'SECURITY', weekStart: '2026-11-09T00:00:00+07:00' }, { now }), /chưa có ca/);
});

test('UC37 Alt 3b: khóa nhân viên → xóa ca sắp tới, ca đang diễn ra kết thúc ngay, ca đã qua giữ nguyên', async () => {
  const { setStatus } = await import('../../src/modules/users/users.service.js');
  const manager = asUser(await createManager());
  const tech = await createTechnician();
  const base = Date.now();
  await DutyShift.insertMany([
    { roleTitle: 'TECHNICIAN', userId: tech._id, startAt: new Date(base - 10 * H), endAt: new Date(base - 5 * H) },
    { roleTitle: 'TECHNICIAN', userId: tech._id, startAt: new Date(base - H), endAt: new Date(base + 3 * H) },
    { roleTitle: 'TECHNICIAN', userId: tech._id, startAt: new Date(base + 20 * H), endAt: new Date(base + 28 * H) },
  ]);
  await setStatus(manager, tech._id, { isActive: false });
  const left = await DutyShift.find({ userId: tech._id }).sort({ startAt: 1 }).lean();
  assert.equal(left.length, 2);
  assert.ok(left[1].endAt.getTime() <= Date.now(), 'ca đang diễn ra đã kết thúc');
});

// Giờ hành chính kỹ thuật: ngoài giờ (đêm, ngày nghỉ) chỉ sự cố Khẩn cấp / Cao báo người trực ngay; sự cố thường chờ
// đầu giờ làm việc tiếp theo, hạn nhận phiếu tính từ lúc đó. Quá hạn nhận chỉ báo Trưởng BQL.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DutyShift, Notification, SystemConfig } from '../../src/models/index.js';
import * as service from '../../src/modules/tickets/tickets.service.js';
import { alertSlaBreaches } from '../../src/modules/tickets/tickets.jobs.js';
import { ackStartAt, isWorkingTime, nextWorkingStart, normalizeWorkHours } from '../../src/modules/tickets/ticket.rules.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createCategory, createHousehold, createManager, createTechnician } from '../helpers/fixtures.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

const WH = { start: '07:00', end: '17:00', days: [1, 2, 3, 4, 5] };
const vn = (iso) => new Date(`${iso}+07:00`); // 2026-11-06 là Thứ 6, 2026-11-07 Thứ 7, 2026-11-09 Thứ 2

test('isWorkingTime: trong khung [07:00, 17:00) của Thứ 2–Thứ 6 theo giờ VN', () => {
  assert.equal(isWorkingTime(vn('2026-11-06T07:00:00'), WH), true);
  assert.equal(isWorkingTime(vn('2026-11-06T16:59:00'), WH), true);
  assert.equal(isWorkingTime(vn('2026-11-06T17:00:00'), WH), false);
  assert.equal(isWorkingTime(vn('2026-11-06T06:59:00'), WH), false);
  assert.equal(isWorkingTime(vn('2026-11-07T10:00:00'), WH), false, 'Thứ 7');
});

test('nextWorkingStart: tối Thứ 6 / Thứ 7 → 07:00 Thứ 2; rạng sáng Thứ 3 → 07:00 cùng ngày; trong giờ → chính lúc đó', () => {
  assert.equal(nextWorkingStart(vn('2026-11-06T22:00:00'), WH).getTime(), vn('2026-11-09T07:00:00').getTime());
  assert.equal(nextWorkingStart(vn('2026-11-07T09:00:00'), WH).getTime(), vn('2026-11-09T07:00:00').getTime());
  assert.equal(nextWorkingStart(vn('2026-11-10T02:00:00'), WH).getTime(), vn('2026-11-10T07:00:00').getTime());
  assert.equal(nextWorkingStart(vn('2026-11-10T09:30:00'), WH).getTime(), vn('2026-11-10T09:30:00').getTime());
});

test('ackStartAt: Khẩn cấp / Cao tính ngay; Thường / Thấp ngoài giờ chờ đầu giờ làm việc', () => {
  const night = vn('2026-11-06T23:00:00');
  assert.equal(ackStartAt('URGENT', night, WH).getTime(), night.getTime());
  assert.equal(ackStartAt('HIGH', night, WH).getTime(), night.getTime());
  assert.equal(ackStartAt('MEDIUM', night, WH).getTime(), vn('2026-11-09T07:00:00').getTime());
});

test('normalizeWorkHours: tham số sai thì dùng mặc định 07:00–17:00, Thứ 2–Thứ 6', () => {
  assert.deepEqual(normalizeWorkHours({ start: '7h', end: '17:00', days: [1, 9] }), WH);
  assert.deepEqual(normalizeWorkHours({ start: '18:00', end: '08:00', days: [6, 7] }), { ...WH, days: [6, 7] });
});

// Đặt giờ hành chính để "bây giờ" chắc chắn là ngoài giờ / trong giờ
const setWorkDays = (days, start = '00:00', end = '23:59') =>
  SystemConfig.insertMany([
    { key: 'TECH_WORK_DAYS', value: days, scope: 'BUSINESS' },
    { key: 'TECH_WORK_START', value: start, scope: 'BUSINESS' },
    { key: 'TECH_WORK_END', value: end, scope: 'BUSINESS' },
  ]);
const todayVn = () => new Date(Date.now() + 7 * 3_600_000).getUTCDay() || 7;
const onShift = (user) => DutyShift.create({ roleTitle: 'TECHNICIAN', userId: user._id, startAt: new Date(Date.now() - 3_600_000), endAt: new Date(Date.now() + 8 * 3_600_000) });
const body = (category, apartment) => ({ categoryId: category._id, title: 'Bóng đèn hành lang cháy', description: 'Bóng đèn hành lang tầng 5 bị cháy', apartmentId: apartment._id });

test('ngoài giờ: sự cố mức thường không báo người trực, hạn nhận tính từ đầu giờ làm việc; mức Cao báo ngay', async () => {
  await setWorkDays([1, 2, 3, 4, 5, 6, 7].filter((d) => d !== todayVn()), '08:00', '17:00'); // hôm nay là ngày nghỉ
  const { user, apartment } = await createHousehold();
  const tech = await createTechnician();
  await onShift(tech);

  const normal = await service.createTicket(asUser(user), body(await createCategory({ defaultPriority: 'MEDIUM' }), apartment), []);
  assert.equal(await Notification.countDocuments({ userId: tech._id }), 0);
  assert.ok(normal.ackDueAt.getTime() > Date.now() + 3_600_000, 'hạn nhận dời tới ngày làm việc tiếp theo');

  const high = await service.createTicket(asUser(user), body(await createCategory({ defaultPriority: 'HIGH' }), apartment), []);
  assert.equal(await Notification.countDocuments({ userId: tech._id }), 1);
  assert.ok(high.ackDueAt.getTime() <= Date.now() + 31 * 60_000);
});

test('trong giờ: sự cố mức thường báo mọi người đang trực, hạn nhận 30 phút', async () => {
  await setWorkDays([1, 2, 3, 4, 5, 6, 7]);
  const { user, apartment } = await createHousehold();
  const [a, b] = await Promise.all([createTechnician(), createTechnician()]);
  await Promise.all([onShift(a), onShift(b)]);
  const t = await service.createTicket(asUser(user), body(await createCategory({ defaultPriority: 'LOW' }), apartment), []);
  assert.equal(await Notification.countDocuments({ userId: { $in: [a._id, b._id] } }), 2);
  assert.ok(t.ackDueAt.getTime() <= Date.now() + 31 * 60_000);
});

test('quá hạn nhận: chỉ báo Trưởng BQL (kèm email), không báo KTV', async () => {
  await setWorkDays([1, 2, 3, 4, 5, 6, 7]);
  const { user, apartment } = await createHousehold();
  const manager = await createManager();
  const tech = await createTechnician();
  await onShift(tech);
  await service.createTicket(asUser(user), body(await createCategory({ defaultPriority: 'HIGH' }), apartment), []);
  const before = await Notification.countDocuments({ userId: tech._id });

  assert.equal(await alertSlaBreaches(new Date(Date.now() + 2 * 3_600_000)), 1);
  assert.ok(await Notification.exists({ userId: manager._id, title: /quá hạn nhận/ }));
  assert.equal(await Notification.countDocuments({ userId: tech._id }), before);
});

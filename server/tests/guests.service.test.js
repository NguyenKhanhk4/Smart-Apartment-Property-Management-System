import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { connectTestDB, clearTestDB, closeTestDB } from './helpers/db.js';
import {
  asUser,
  createApartment,
  createHousehold,
  createManager,
  createReceptionist,
  createResident,
  createSecurity,
  createUser,
  linkResident,
  tokenFor,
} from './helpers/fixtures.js';
import { createApp } from '../src/app.js';
import * as service from '../src/modules/guests/guests.service.js';
import { GuestLog, Notification } from '../src/models/index.js';
import { HOUR_MS } from '../src/utils/time.js';

const soon = () => new Date(Date.now() + 2 * HOUR_MS);

describe('guests.service', () => {
  beforeAll(connectTestDB, 120000);
  afterEach(clearTestDB);
  afterAll(closeTestDB);

  describe('registerGuest / cancelRegistration (UC-E07)', () => {
    it('cư dân đăng ký khách → EXPECTED, gắn đúng căn/tòa', async () => {
      const h = await createHousehold();
      const log = await service.registerGuest(asUser(h.user), { guestName: 'Nguyễn Văn A', expectedTime: soon(), numberOfGuests: 2 });
      expect(log.status).toBe('EXPECTED');
      expect(String(log.apartmentId)).toBe(String(h.apartment._id));
      expect(String(log.buildingId)).toBe(String(h.building._id));
      expect(String(log.registeredBy)).toBe(String(h.user._id));
      expect(log.isWalkIn).toBe(false);
    });

    it('thời gian quá khứ → VALIDATION_ERROR; căn của người khác → FORBIDDEN_ROLE', async () => {
      const h = await createHousehold();
      const other = await createHousehold();
      await expect(
        service.registerGuest(asUser(h.user), { guestName: 'A B', expectedTime: new Date(Date.now() - 3 * HOUR_MS) }),
      ).rejects.toMatchObject({ errorCode: 'VALIDATION_ERROR' });
      await expect(
        service.registerGuest(asUser(h.user), { guestName: 'A B', expectedTime: soon(), apartmentId: String(other.apartment._id) }),
      ).rejects.toMatchObject({ errorCode: 'FORBIDDEN_ROLE' });
    });

    it('hủy đăng ký: chỉ chủ căn và chỉ khi còn EXPECTED', async () => {
      const h = await createHousehold();
      const stranger = await createHousehold();
      const log = await service.registerGuest(asUser(h.user), { guestName: 'A B', expectedTime: soon() });
      await expect(service.cancelRegistration(asUser(stranger.user), log._id)).rejects.toMatchObject({ errorCode: 'FORBIDDEN_ROLE' });

      const guard = await createSecurity();
      await service.checkIn(asUser(guard), log._id, {});
      await expect(service.cancelRegistration(asUser(h.user), log._id)).rejects.toMatchObject({ errorCode: 'VALIDATION_ERROR' });

      const log2 = await service.registerGuest(asUser(h.user), { guestName: 'C D', expectedTime: soon() });
      expect(await service.cancelRegistration(asUser(h.user), log2._id)).toEqual({ deleted: true });
      expect(await GuestLog.findById(log2._id)).toBeNull();
    });
  });

  describe('checkIn / checkOut / walkIn (UC-E08, BR-O10)', () => {
    it('check-in khách đã đăng ký → CHECKED_IN, báo cư dân căn; check-in lần 2 lỗi; check-out → CHECKED_OUT', async () => {
      const h = await createHousehold();
      const roommate = await createResident();
      await linkResident(roommate, h.apartment);
      const guard = await createSecurity();
      const log = await service.registerGuest(asUser(h.user), { guestName: 'A B', expectedTime: soon() });

      const checked = await service.checkIn(asUser(guard), log._id, { note: 'Mang theo xe máy' });
      expect(checked.status).toBe('CHECKED_IN');
      expect(checked.checkInTime).toBeInstanceOf(Date);
      expect(String(checked.recordedBy)).toBe(String(guard._id));
      expect(checked.note).toBe('Mang theo xe máy');
      const notified = (await Notification.find({ type: 'GUEST' }).lean()).map((n) => String(n.userId)).sort();
      expect(notified).toEqual([String(h.user._id), String(roommate._id)].sort());

      await expect(service.checkIn(asUser(guard), log._id, {})).rejects.toMatchObject({ errorCode: 'VALIDATION_ERROR' });
      await expect(service.checkOut(asUser(guard), log._id)).resolves.toMatchObject({ status: 'CHECKED_OUT' });
      await expect(service.checkOut(asUser(guard), log._id)).rejects.toMatchObject({ errorCode: 'VALIDATION_ERROR' });
    });

    it('khách vãng lai: bắt buộc căn hộ tồn tại, tạo bản ghi CHECKED_IN isWalkIn, báo cư dân', async () => {
      const h = await createHousehold();
      const guard = await createSecurity();
      const log = await service.walkIn(asUser(guard), { guestName: 'Khách lạ', apartmentId: String(h.apartment._id), idNumber: '0123' });
      expect(log).toMatchObject({ status: 'CHECKED_IN', isWalkIn: true });
      expect(log.checkInTime).toBeInstanceOf(Date);
      expect(String(log.buildingId)).toBe(String(h.building._id));
      expect(await Notification.countDocuments({ userId: h.user._id, type: 'GUEST' })).toBe(1);

      await expect(service.walkIn(asUser(guard), { guestName: 'X Y', apartmentId: String(guard._id) })).rejects.toMatchObject({
        errorCode: 'VALIDATION_ERROR',
      });
    });
  });

  describe('listGuests', () => {
    it('cư dân chỉ thấy khách căn mình (kể cả khi truyền apartmentId khác); bảo vệ/manager thấy tất cả', async () => {
      const h1 = await createHousehold();
      const h2 = await createHousehold();
      const guard = await createSecurity();
      const manager = await createManager();
      const g1 = await service.registerGuest(asUser(h1.user), { guestName: 'Khách 1', expectedTime: soon() });
      await service.registerGuest(asUser(h2.user), { guestName: 'Khách 2', expectedTime: soon() });

      const mine = await service.listGuests(asUser(h1.user), { page: 1, limit: 20, apartmentId: String(h2.apartment._id) });
      expect(mine.items.map((g) => String(g._id))).toEqual([String(g1._id)]);
      expect((await service.listGuests(asUser(guard), { page: 1, limit: 20 })).pagination.total).toBe(2);
      expect((await service.listGuests(asUser(manager), { page: 1, limit: 20, apartmentId: String(h2.apartment._id) })).pagination.total).toBe(1);
    });

    it('lọc theo ngày (giờ VN), trạng thái và tìm theo tên/mã căn', async () => {
      const h = await createHousehold();
      const guard = await createSecurity();
      // 23:30 VN 10/03 = 16:30Z
      const lateNight = new Date('2026-03-10T16:30:00Z');
      await GuestLog.create({ apartmentId: h.apartment._id, guestName: 'Đêm Khuya', expectedTime: lateNight, status: 'EXPECTED' });
      await GuestLog.create({ apartmentId: h.apartment._id, guestName: 'Hôm Sau', expectedTime: new Date('2026-03-10T17:30:00Z'), status: 'CHECKED_IN', checkInTime: new Date('2026-03-10T17:30:00Z') });

      const day = await service.listGuests(asUser(guard), { page: 1, limit: 20, date: new Date('2026-03-10T05:00:00Z') });
      expect(day.items.map((g) => g.guestName)).toEqual(['Đêm Khuya']);

      const byStatus = await service.listGuests(asUser(guard), { page: 1, limit: 20, status: ['CHECKED_IN'] });
      expect(byStatus.items.map((g) => g.guestName)).toEqual(['Hôm Sau']);

      const byCode = await service.listGuests(asUser(guard), { page: 1, limit: 20, q: h.apartment.code.toLowerCase() });
      expect(byCode.pagination.total).toBe(2);
      const byName = await service.listGuests(asUser(guard), { page: 1, limit: 20, q: 'hôm', date: new Date('2026-03-11T05:00:00Z') });
      expect(byName.items.map((g) => g.guestName)).toEqual(['Hôm Sau']);
      // ký tự regex được escape
      const weird = await service.listGuests(asUser(guard), { page: 1, limit: 20, q: '.*' });
      expect(weird.pagination.total).toBe(0);
    });
  });

  describe('routes (phân quyền)', () => {
    const app = createApp();
    const call = (user) => (m, url, body) => request(app)[m](url).send(body).set('Authorization', `Bearer ${tokenFor(user)}`);

    it('chỉ bảo vệ được check-in/walk-in; cư dân/lễ tân/admin bị 403', async () => {
      const h = await createHousehold();
      const receptionist = await createReceptionist();
      const admin = await createUser('ADMIN');
      const body = { guestName: 'Khách', apartmentId: String(h.apartment._id) };
      for (const u of [h.user, receptionist, admin]) {
        expect((await call(u)('post', '/api/guests/walk-in', body)).status).toBe(403);
      }
      const guard = await createSecurity();
      expect((await call(guard)('post', '/api/guests/walk-in', body)).status).toBe(201);
      // thiếu tên/căn → VALIDATION_ERROR (BR-O10)
      expect((await call(guard)('post', '/api/guests/walk-in', { guestName: 'Khách' })).status).toBe(400);
    });

    it('cư dân không tự check-in khách; sort chỉ theo field cho phép', async () => {
      const h = await createHousehold();
      const log = await service.registerGuest(asUser(h.user), { guestName: 'A B', expectedTime: soon() });
      expect((await call(h.user)('patch', `/api/guests/${log._id}/check-in`, {})).status).toBe(403);
      expect((await call(h.user)('get', '/api/guests?sort=expectedTime')).status).toBe(200);
      expect((await call(h.user)('get', '/api/guests?sort=registeredBy')).status).toBe(400);
    });

    it('apartment helper dùng chung', async () => {
      const apt = await createApartment();
      expect(apt.code).toBeTruthy();
    });
  });
});

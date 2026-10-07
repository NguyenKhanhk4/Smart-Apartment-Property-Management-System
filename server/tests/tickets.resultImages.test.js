// UC-E04 (bổ sung): KTV báo "Đã xử lý xong" phải kèm ảnh kết quả; người giao việc xem được ảnh + ghi chú
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { connectTestDB, clearTestDB, closeTestDB } from './helpers/db.js';
import {
  asUser,
  createHousehold,
  createManager,
  createReceptionist,
  createResident,
  createTechnician,
  createTicket,
  tokenFor,
} from './helpers/fixtures.js';

// Không gọi Cloudinary thật, vẫn giữ middleware kiểm tra file thật
vi.mock('../src/services/upload.service.js', async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    uploadToCloudinary: vi.fn(async (files = [], folder) => files.map((f, i) => `https://cdn.test/${folder}/${i}-${f.originalname}`)),
  };
});

const { createApp } = await import('../src/app.js');
const { uploadToCloudinary } = await import('../src/services/upload.service.js');
const service = await import('../src/modules/tickets/tickets.service.js');
const { Notification, Ticket } = await import('../src/models/index.js');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PHOTO = { originalname: 'den-sau-sua.jpg', mimetype: 'image/jpeg', buffer: JPEG };

describe('ticket — ảnh kết quả khi báo đã xử lý xong', () => {
  const app = createApp();
  beforeAll(connectTestDB, 120000);
  afterEach(async () => {
    uploadToCloudinary.mockClear();
    await clearTestDB();
  });
  afterAll(closeTestDB);

  const setup = async () => {
    const h = await createHousehold();
    const tech = await createTechnician();
    const ticket = await createTicket({ apartment: h.apartment, createdBy: h.user, status: 'IN_PROGRESS', assignedTo: tech._id });
    return { h, tech, ticket };
  };
  const progress = (user, ticket, body, files) => {
    let req = request(app).patch(`/api/tickets/${ticket._id}/progress`);
    if (user) req = req.set('Authorization', `Bearer ${tokenFor(user)}`);
    if (!files) return req.send(body);
    Object.entries(body).forEach(([k, v]) => (req = req.field(k, v)));
    files.forEach(([name, buf, type]) => (req = req.attach('images', buf, { filename: name, contentType: type })));
    return req;
  };

  it('service: WAITING_CONFIRM không có ảnh → VALIDATION_ERROR, ticket không đổi, không báo cư dân', async () => {
    const { tech, ticket } = await setup();
    await expect(
      service.updateProgress(asUser(tech), ticket._id, { status: 'WAITING_CONFIRM', note: 'Đã thay bóng đèn' }),
    ).rejects.toMatchObject({ errorCode: 'VALIDATION_ERROR', status: 400 });
    const saved = await Ticket.findById(ticket._id).lean();
    expect(saved.status).toBe('IN_PROGRESS');
    expect(saved.resolvedAt).toBeUndefined();
    expect(await Notification.countDocuments()).toBe(0);
    expect(uploadToCloudinary).not.toHaveBeenCalled();
  });

  it('service: WAITING_CONFIRM kèm ảnh → ảnh + ghi chú lưu ở dòng lịch sử RESOLVED; IN_PROGRESS không cần ảnh', async () => {
    const { tech, ticket } = await setup();
    await service.updateProgress(asUser(tech), ticket._id, { status: 'IN_PROGRESS', note: 'Đang thay đèn' });
    expect(uploadToCloudinary).not.toHaveBeenCalled();

    await service.updateProgress(asUser(tech), ticket._id, { status: 'WAITING_CONFIRM', note: 'Đã thay bóng đèn' }, [PHOTO]);
    expect(uploadToCloudinary).toHaveBeenCalledWith([PHOTO], 'ticket-results');

    const { history } = await Ticket.findById(ticket._id).lean();
    const progressEntry = history.find((x) => x.action === 'PROGRESS');
    expect(progressEntry.imageUrls).toBeUndefined();
    expect(history.at(-1)).toMatchObject({
      action: 'RESOLVED',
      note: 'Đã thay bóng đèn',
      imageUrls: ['https://cdn.test/ticket-results/0-den-sau-sua.jpg'],
    });
  });

  it('HTTP: KTV gửi multipart kèm ảnh → 200; gửi JSON không ảnh → 400; file giả ảnh / quá 5 ảnh → 400', async () => {
    const { h, tech, ticket } = await setup();
    const body = { status: 'WAITING_CONFIRM', note: 'Đã thay bóng đèn' };

    const noImage = await progress(tech, ticket, body);
    expect(noImage.status).toBe(400);
    expect(noImage.body.details).toEqual([{ field: 'images', message: 'Bắt buộc có ít nhất 1 ảnh' }]);

    expect((await progress(tech, ticket, body, [['x.png', Buffer.from('không phải ảnh'), 'image/png']])).status).toBe(400);
    const six = Array.from({ length: 6 }, (_, i) => [`a${i}.jpg`, JPEG, 'image/jpeg']);
    expect((await progress(tech, ticket, body, six)).status).toBe(400);
    expect((await Ticket.findById(ticket._id).lean()).status).toBe('IN_PROGRESS');

    const ok = await progress(tech, ticket, body, [['a.jpg', JPEG, 'image/jpeg'], ['b.jpg', JPEG, 'image/jpeg']]);
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('WAITING_CONFIRM');
    expect(ok.body.data.history.at(-1).imageUrls).toHaveLength(2);

    // Cập nhật "đang xử lý" vẫn gửi JSON bình thường, không cần ảnh
    const t2 = await createTicket({ apartment: h.apartment, createdBy: h.user, status: 'ASSIGNED', assignedTo: tech._id });
    expect((await progress(tech, t2, { status: 'IN_PROGRESS', note: 'Đang xem' })).status).toBe(200);
  });

  it('Manager và Lễ tân (người giao việc) xem được ảnh + ghi chú trong chi tiết ticket; Manager không gửi được tiến độ', async () => {
    const { tech, ticket } = await setup();
    const manager = await createManager();
    const recep = await createReceptionist();
    await progress(tech, ticket, { status: 'WAITING_CONFIRM', note: 'Đã thay bóng đèn' }, [['a.jpg', JPEG, 'image/jpeg']]);

    for (const viewer of [manager, recep]) {
      const res = await request(app).get(`/api/tickets/${ticket._id}`).set('Authorization', `Bearer ${tokenFor(viewer)}`);
      expect(res.status).toBe(200);
      expect(res.body.data.history.at(-1)).toMatchObject({
        action: 'RESOLVED',
        note: 'Đã thay bóng đèn',
        imageUrls: ['https://cdn.test/ticket-results/0-a.jpg'],
      });
    }
    const asManager = await progress(manager, ticket, { status: 'IN_PROGRESS' });
    expect(asManager.status).toBe(403);

    // Cư dân căn khác không xem được ticket (và ảnh)
    const stranger = await createResident();
    expect((await request(app).get(`/api/tickets/${ticket._id}`).set('Authorization', `Bearer ${tokenFor(stranger)}`)).status).toBe(403);
  });
});

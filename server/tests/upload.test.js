import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { connectTestDB, clearTestDB, closeTestDB } from './helpers/db.js';
import { createCategory, createHousehold, tokenFor } from './helpers/fixtures.js';

// Chỉ mock bước đẩy lên Cloudinary, giữ nguyên middleware kiểm tra file
vi.mock('../src/services/upload.service.js', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, uploadToCloudinary: vi.fn(async (files = [], folder) => files.map((f, i) => `https://cdn.test/${folder}/${i}-${f.originalname}`)) };
});

const { createApp } = await import('../src/app.js');
const { uploadToCloudinary } = await import('../src/services/upload.service.js');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const FAKE = Buffer.from('<?php system($_GET["c"]); ?>');

describe('upload ảnh ticket (UC-E02, NFR-10)', () => {
  const app = createApp();
  beforeAll(connectTestDB, 120000);
  afterEach(async () => {
    uploadToCloudinary.mockClear();
    await clearTestDB();
  });
  afterAll(closeTestDB);

  const post = (user, files, fields) => {
    let req = request(app).post('/api/tickets').set('Authorization', `Bearer ${tokenFor(user)}`);
    Object.entries(fields).forEach(([k, v]) => (req = req.field(k, v)));
    files.forEach(([name, buf, type]) => (req = req.attach('images', buf, { filename: name, contentType: type })));
    return req;
  };

  it('ảnh jpg/png hợp lệ → 201, URL ảnh lưu vào ticket', async () => {
    const h = await createHousehold();
    const category = await createCategory();
    const res = await post(h.user, [['a.png', PNG, 'image/png'], ['b.jpg', JPEG, 'image/jpeg']], {
      categoryId: String(category._id),
      title: 'Hỏng đèn hành lang',
      description: 'Đèn hành lang tầng 3 hỏng từ tối qua',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.imageUrls).toHaveLength(2);
    expect(uploadToCloudinary).toHaveBeenCalledTimes(1);
  });

  it('mimetype giả mạo (file không phải ảnh nhưng khai image/png) → 400, không upload', async () => {
    const h = await createHousehold();
    const category = await createCategory();
    const res = await post(h.user, [['shell.png', FAKE, 'image/png']], {
      categoryId: String(category._id),
      title: 'Hỏng đèn hành lang',
      description: 'Đèn hành lang tầng 3 hỏng từ tối qua',
    });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(uploadToCloudinary).not.toHaveBeenCalled();
  });

  it('mimetype không phải jpg/png → 400; quá 5 ảnh → 400', async () => {
    const h = await createHousehold();
    const category = await createCategory();
    const fields = { categoryId: String(category._id), title: 'Hỏng đèn hành lang', description: 'Đèn hành lang tầng 3 hỏng từ tối qua' };
    const gif = await post(h.user, [['a.gif', PNG, 'image/gif']], fields);
    expect(gif.status).toBe(400);
    expect(gif.body.message).toMatch(/jpg\/png/);
    const six = await post(h.user, Array.from({ length: 6 }, (_, i) => [`${i}.png`, PNG, 'image/png']), fields);
    expect(six.status).toBe(400);
    expect(six.body.message).toMatch(/Tối đa 5/);
    expect(uploadToCloudinary).not.toHaveBeenCalled();
  });

  it('ảnh quá 5MB → 400', async () => {
    const h = await createHousehold();
    const category = await createCategory();
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    const res = await post(h.user, [['big.png', big, 'image/png']], {
      categoryId: String(category._id),
      title: 'Hỏng đèn hành lang',
      description: 'Đèn hành lang tầng 3 hỏng từ tối qua',
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/5MB/);
  });
});

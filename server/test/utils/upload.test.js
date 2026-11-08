// UC63 – Tải ảnh lên: kiểm tra định dạng, chữ ký file, số ảnh, dung lượng; lỗi Cloudinary không lộ chi tiết (MSG-G04, MSG-G07)
import { after, afterEach, before, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../../src/config/env.js';
import { errorHandler } from '../../src/middlewares/errorHandler.js';
import { SystemConfig } from '../../src/models/index.js';
import { isImageBuffer, uploadImages, uploadToCloudinary } from '../../src/services/upload.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPG_HEAD = [0xff, 0xd8, 0xff, 0xe0];
const fileOf = (head, size = 1000) => {
  const buf = Buffer.alloc(size);
  Buffer.from(head).copy(buf);
  return buf;
};

let server;
let base;
before(async () => {
  await connectTestDB();
  const app = express();
  app.post('/up', uploadImages('images', 5), async (req, res) => res.json({ urls: await uploadToCloudinary(req.files, 'test') }));
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  mock.restoreAll();
  env.cloudinary.enabled = false;
  await clearTestDB();
});
after(async () => {
  await new Promise((r) => server.close(r));
  await closeTestDB();
});

/** files: [[tên, buffer, mimetype]] */
async function send(files) {
  const form = new FormData();
  files.forEach(([name, buffer, type]) => form.append('images', new Blob([buffer], { type }), name));
  const res = await fetch(`${base}/up`, { method: 'POST', body: form });
  return { status: res.status, body: await res.json() };
}
const stubCloudinary = (fail = false) => {
  env.cloudinary.enabled = true;
  let n = 0;
  mock.method(cloudinary.uploader, 'upload_stream', (options, callback) => ({
    end() {
      if (fail) callback(new Error('Invalid api_key 123secret'));
      else callback(null, { secure_url: `https://cdn.test/${options.folder}/${(n += 1)}` });
    },
  }));
};

test('chữ ký file: chỉ nhận nội dung thật là jpg / png', () => {
  assert.equal(isImageBuffer(fileOf(PNG_HEAD)), true);
  assert.equal(isImageBuffer(fileOf(JPG_HEAD)), true);
  assert.equal(isImageBuffer(Buffer.from('<?php echo 1; ?>')), false);
  assert.equal(isImageBuffer(Buffer.alloc(0)), false);
});

test('1a: sai định dạng, file giả đuôi .png, quá 5 ảnh → 400 có tên file; không gọi Cloudinary', async () => {
  stubCloudinary();
  const gif = await send([['a.gif', Buffer.from('GIF89a'), 'image/gif']]);
  assert.equal(gif.status, 400);
  assert.match(gif.body.message, /"a\.gif" sai định dạng/);

  const fake = await send([['virus.png', Buffer.from('<?php echo 1; ?>'), 'image/png']]);
  assert.equal(fake.status, 400);
  assert.match(fake.body.message, /"virus\.png" không phải file jpg\/png hợp lệ/);

  const six = await send(Array.from({ length: 6 }, (_, i) => [`${i}.png`, fileOf(PNG_HEAD), 'image/png']));
  assert.equal(six.status, 400);
  assert.match(six.body.message, /Tối đa 5 ảnh/);
  assert.equal(cloudinary.uploader.upload_stream.mock.callCount(), 0);
});

test('dung lượng: mặc định 10MB khi chưa có tham số; theo UPLOAD_MAX_SIZE_MB nếu Trưởng BQL đặt', async () => {
  stubCloudinary();
  assert.equal((await send([['ok.jpg', fileOf(JPG_HEAD, 6 * 1024 * 1024), 'image/jpeg']])).status, 200);
  const big = await send([['big.jpg', fileOf(JPG_HEAD, 11 * 1024 * 1024), 'image/jpeg']]);
  assert.equal(big.status, 400);
  assert.match(big.body.message, /"big\.jpg" vượt quá 10MB/);

  await SystemConfig.create({ key: 'UPLOAD_MAX_SIZE_MB', value: 2, scope: 'TECHNICAL' });
  assert.match((await send([['b.jpg', fileOf(JPG_HEAD, 3 * 1024 * 1024), 'image/jpeg']])).body.message, /vượt quá 2MB/);
});

test('2–3: hợp lệ → trả URL Cloudinary theo thư mục', async () => {
  stubCloudinary();
  const res = await send([['a.png', fileOf(PNG_HEAD), 'image/png'], ['b.jpg', fileOf(JPG_HEAD), 'image/jpeg']]);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.urls, ['https://cdn.test/sapms/test/1', 'https://cdn.test/sapms/test/2']);
});

test('2a: Cloudinary lỗi hoặc chưa cấu hình → thông báo chung (MSG-G07), không lộ lỗi gốc hay tên biến môi trường', async () => {
  const errors = mock.method(console, 'error', () => {});
  stubCloudinary(true);
  const failed = await send([['a.png', fileOf(PNG_HEAD), 'image/png']]);
  assert.equal(failed.status, 500);
  assert.equal(failed.body.message, 'Upload ảnh thất bại, vui lòng thử lại sau');
  assert.ok(!JSON.stringify(failed.body).includes('api_key'));

  mock.restoreAll();
  mock.method(console, 'error', () => {});
  env.cloudinary.enabled = false;
  const missing = await send([['a.png', fileOf(PNG_HEAD), 'image/png']]);
  assert.equal(missing.status, 500);
  assert.equal(missing.body.message, 'Upload ảnh thất bại, vui lòng thử lại sau');
  assert.ok(!JSON.stringify(missing.body).includes('CLOUDINARY'));
  assert.ok(errors.mock.callCount() >= 1); // chi tiết vẫn được ghi log để tra cứu
});

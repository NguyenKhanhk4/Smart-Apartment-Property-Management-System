import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DIMENSION, checkImageFile, jpegName, needsProcessing, prepareFormData, scaledSize } from '../src/utils/imageUpload.js';

const MB = 1024 * 1024;

test('chọn ảnh: nhận mọi loại ảnh (webp, heic...), chặn file không phải ảnh và ảnh gốc quá 30MB', () => {
  assert.equal(checkImageFile({ name: 'a.webp', type: 'image/webp', size: 2 * MB }), null);
  assert.equal(checkImageFile({ name: 'b.heic', type: 'image/heic', size: 3 * MB }), null);
  assert.equal(checkImageFile({ name: 'c.jpg', type: 'image/jpeg', size: 12 * MB }), null); // ảnh chụp lớn: sẽ thu nhỏ
  assert.match(checkImageFile({ name: 'd.pdf', type: 'application/pdf', size: 1000 }), /"d\.pdf" không phải ảnh/);
  assert.match(checkImageFile({ name: 'e.jpg', type: 'image/jpeg', size: 31 * MB }), /"e\.jpg" quá lớn/);
});

test('thu nhỏ giữ tỷ lệ theo cạnh dài; ảnh nhỏ giữ nguyên', () => {
  assert.deepEqual(scaledSize(4000, 3000), { width: MAX_DIMENSION, height: 1500 });
  assert.deepEqual(scaledSize(3000, 6000), { width: 1000, height: MAX_DIMENSION });
  assert.deepEqual(scaledSize(800, 600), { width: 800, height: 600 });
});

test('chỉ vẽ lại khi cần: khác jpg/png, quá nặng hoặc quá lớn', () => {
  assert.equal(needsProcessing({ type: 'image/jpeg', size: 500_000, width: 1200, height: 900 }), false);
  assert.equal(needsProcessing({ type: 'image/png', size: 200_000, width: 800, height: 600 }), false);
  assert.equal(needsProcessing({ type: 'image/webp', size: 100_000, width: 800, height: 600 }), true);
  assert.equal(needsProcessing({ type: 'image/jpeg', size: 6 * MB, width: 1200, height: 900 }), true);
  assert.equal(needsProcessing({ type: 'image/jpeg', size: 500_000, width: 4000, height: 3000 }), true);
});

test('tên file đổi đuôi sang .jpg', () => {
  assert.equal(jpegName('IMG_0001.HEIC'), 'IMG_0001.jpg');
  assert.equal(jpegName('anh.chup.webp'), 'anh.chup.jpg');
  assert.equal(jpegName(''), 'anh.jpg');
});

test('FormData không có ảnh (vd Excel) thì trả nguyên bản, không đụng tới', async () => {
  const form = new FormData();
  form.append('file', new Blob(['x'], { type: 'application/vnd.ms-excel' }), 'a.xlsx');
  form.append('note', 'abc');
  assert.equal(await prepareFormData(form), form);
});

// Tiện ích cho test Mô đun 10 (thiết bị & bảo trì): gọi API, so khớp một phần, giả lập Cloudinary.
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../../src/config/env.js';
import { asUser } from './fixtures.js';
import { startApp, tokenFor } from './http.js';

/** So khớp một phần: chỉ kiểm tra các key có trong `expected`, kể cả key lồng nhau */
export function assertMatch(actual, expected) {
  if (expected === null || typeof expected !== 'object' || expected instanceof Date) {
    assert.deepEqual(actual, expected);
    return;
  }
  assert.ok(actual, `Thiếu giá trị để so với ${JSON.stringify(expected)}`);
  for (const [key, value] of Object.entries(expected)) assertMatch(actual[key], value);
}

/** Chạy app thật. `api(method, path, user, body)` gửi JSON; `upload` gửi multipart như trình duyệt */
export async function startApi() {
  const app = await startApp();
  const authHeader = (user) => (user ? { authorization: `Bearer ${tokenFor(asUser(user))}` } : {});

  return {
    close: app.close,
    api: (method, path, user, body) => app.request(method, path, { user: user ? asUser(user) : undefined, body }),
    // files: [[tên, buffer, mimetype, fieldName?]]
    upload: async (method, path, user, fields, files) => {
      const form = new FormData();
      Object.entries(fields).forEach(([key, value]) => form.append(key, value));
      files.forEach(([name, buffer, type, fieldName]) => form.append(fieldName || 'images', new Blob([buffer], { type }), name));
      const res = await fetch(`${app.base}${path}`, { method, headers: authHeader(user), body: form });
      return { status: res.status, body: await res.json() };
    },
  };
}

/**
 * Không gọi Cloudinary thật nhưng vẫn chạy uploadToCloudinary và middleware kiểm tra file.
 * URL giả theo thứ tự file: https://cdn.test/sapms/<thư mục>/<số thứ tự>. Gọi lại sau mỗi mock.restoreAll().
 */
export function stubCloudinary() {
  env.cloudinary.enabled = true;
  const folders = [];
  let failNext = false;
  mock.method(cloudinary.uploader, 'upload_stream', (options, callback) => ({
    end() {
      if (failNext) {
        failNext = false;
        callback(new Error('Cloudinary lỗi'));
        return;
      }
      folders.push(options.folder);
      callback(null, { secure_url: `https://cdn.test/${options.folder}/${folders.length - 1}` });
    },
  }));
  return {
    folders,
    failNext: () => {
      failNext = true;
    },
  };
}

// Chạy app Express thật trên cổng ngẫu nhiên để test phân quyền / validate (các nhánh này trả lỗi trước khi chạm DB).
import jwt from 'jsonwebtoken';
import { env } from '../../src/config/env.js';
import { createApp } from '../../src/app.js';

export async function startApp() {
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  const request = (method, path, { user, body } = {}) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(user && { authorization: `Bearer ${tokenFor(user)}` }),
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (res) => ({ status: res.status, body: await res.json() }));

  return { request, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** Access token đúng shape middleware authenticate yêu cầu */
export function tokenFor({ id = '64b000000000000000000001', role, roleTitle = null }) {
  return jwt.sign({ sub: id, role, roleTitle, boardTitle: null }, env.jwt.accessSecret, { expiresIn: '5m' });
}

export const USERS = {
  manager: { role: 'MANAGER' },
  technician: { role: 'STAFF', roleTitle: 'TECHNICIAN' },
  security: { role: 'STAFF', roleTitle: 'SECURITY' },
  receptionist: { role: 'STAFF', roleTitle: 'RECEPTIONIST' },
  resident: { role: 'RESIDENT' },
};

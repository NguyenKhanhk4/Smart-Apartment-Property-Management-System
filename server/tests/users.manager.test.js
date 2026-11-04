// N2: gộp ADMIN vào MANAGER. MANAGER quản trị tài khoản, không tự đổi vai trò; script thay Trưởng BQL.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { setManager } from '../scripts/set-manager.js';
import { createApp } from '../src/app.js';
import { AuditLog, User } from '../src/models/index.js';
import { connectTestDB, clearTestDB, closeTestDB } from './helpers/db.js';
import { createManager, createUser, tokenFor } from './helpers/fixtures.js';

const app = createApp();
const patch = (actor, id, body) =>
  request(app).patch(`/api/users/internal/${id}`).set('Authorization', `Bearer ${tokenFor(actor)}`).send(body);

beforeAll(connectTestDB, 120000);
afterEach(clearTestDB);
afterAll(closeTestDB);

describe('Quyền của MANAGER sau khi gộp role', () => {
  it('MANAGER gọi được các API trước đây của ADMIN; role khác 403', async () => {
    const manager = await createManager();
    const accountant = await createUser('ACCOUNTANT');
    const get = (actor, url) => request(app).get(url).set('Authorization', `Bearer ${tokenFor(actor)}`);

    for (const url of ['/api/users/internal', '/api/admin/dashboard', '/api/system-configs']) {
      expect((await get(manager, url)).status, url).toBe(200);
      expect((await get(accountant, url)).status, url).toBe(403);
    }
  });

  it('không tự đổi được vai trò của chính mình, vẫn sửa được thông tin khác', async () => {
    const manager = await createManager();

    expect((await patch(manager, manager._id, { role: 'ACCOUNTANT' })).status).toBe(400);
    expect((await patch(manager, manager._id, { fullName: 'Tên Mới' })).status).toBe(200);

    const saved = await User.findById(manager._id).lean();
    expect(saved.role).toBe('MANAGER');
    expect(saved.fullName).toBe('Tên Mới');
  });

  it('vẫn đổi được vai trò của nhân viên khác', async () => {
    const manager = await createManager();
    const staff = await createUser('ACCOUNTANT');

    expect((await patch(manager, staff._id, { role: 'STAFF', roleTitle: 'SECURITY' })).status).toBe(200);
  });
});

describe('setManager (script cài đặt)', () => {
  it('tạo Trưởng BQL mới, đăng nhập được, có ghi Audit Log', async () => {
    const { user, lockedCount } = await setManager({
      email: ' Moi@Test.Local ',
      fullName: 'Trưởng BQL Mới',
      password: 'MatKhau123',
    });

    expect(user.email).toBe('moi@test.local');
    expect(lockedCount).toBe(0);
    const saved = await User.findById(user._id).select('+passwordHash').lean();
    expect(await bcrypt.compare('MatKhau123', saved.passwordHash)).toBe(true);
    expect(await AuditLog.exists({ action: 'ROLE_ASSIGNED', targetId: user._id })).toBeTruthy();
  });

  it('thay người: khóa Trưởng BQL cũ và tài khoản ADMIN còn sót lại, thu hồi phiên của họ', async () => {
    const oldManager = await createManager();
    // Tài khoản cũ từ trước khi gộp role; ghi trực tiếp vì model không còn nhận role này
    const { insertedId: oldAdminId } = await User.collection.insertOne({
      email: 'admin.cu@test.local',
      fullName: 'Admin cũ',
      passwordHash: 'x',
      role: 'ADMIN',
      isActive: true,
      tokenVersion: 0,
    });

    const { lockedCount } = await setManager({ email: 'moi@test.local', fullName: 'Mới', password: 'MatKhau123' });

    expect(lockedCount).toBe(2);
    const oldManagerNow = await User.findById(oldManager._id).select('+tokenVersion').lean();
    expect(oldManagerNow.isActive).toBe(false);
    expect(oldManagerNow.tokenVersion).toBe(1);
    expect((await User.collection.findOne({ _id: oldAdminId })).isActive).toBe(false);
  });

  it('nâng nhân viên có sẵn lên, giữ mật khẩu nếu không truyền, xóa chức danh cũ', async () => {
    const staff = await createUser('STAFF', { roleTitle: 'SECURITY', email: 'nv@test.local' });

    const { user } = await setManager({ email: 'nv@test.local' });

    expect(String(user._id)).toBe(String(staff._id));
    expect(user.role).toBe('MANAGER');
    expect(user.roleTitle).toBeNull();
    expect(user.passwordHash).toBe('x');
  });

  it('chạy lại với cùng người không khóa chính họ', async () => {
    await setManager({ email: 'moi@test.local', fullName: 'Mới', password: 'MatKhau123' });

    const { user, lockedCount } = await setManager({ email: 'moi@test.local' });

    expect(lockedCount).toBe(0);
    expect(user.isActive).toBe(true);
  });

  it('từ chối cư dân, thiếu thông tin khi tạo mới, mật khẩu yếu; không khóa ai khi lỗi', async () => {
    const manager = await createManager();
    await createUser('RESIDENT', { email: 'cudan@test.local' });

    await expect(setManager({ email: 'cudan@test.local' })).rejects.toThrow(/cư dân/);
    await expect(setManager({ email: 'moi@test.local', fullName: 'Mới' })).rejects.toThrow(/MANAGER_PASSWORD/);
    await expect(setManager({ email: 'moi@test.local', fullName: 'Mới', password: 'ngan' })).rejects.toThrow(/Mật khẩu/);

    expect((await User.findById(manager._id).lean()).isActive).toBe(true);
  });
});

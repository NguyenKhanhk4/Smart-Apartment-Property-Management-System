import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import { connectTestDB, clearTestDB, closeTestDB } from './helpers/db.js';
import { createManager, createResident, createUser, tokenFor } from './helpers/fixtures.js';
import { createApp } from '../src/app.js';
import { AuditLog, ComplaintCategory, SystemConfig } from '../src/models/index.js';
import { ensureDefaultConfigs, getConfig, getConfigs } from '../src/services/systemConfig.service.js';

describe('system-configs & complaint-categories (UC-E01)', () => {
  const app = createApp();
  const call = (user) => (m, url, body) => request(app)[m](url).send(body).set('Authorization', `Bearer ${tokenFor(user)}`);

  beforeAll(connectTestDB, 120000);
  beforeEach(ensureDefaultConfigs);
  afterEach(clearTestDB);
  afterAll(closeTestDB);

  it('getConfig: chưa có trong DB → mặc định; ensureDefaultConfigs không ghi đè giá trị đã sửa', async () => {
    expect(await getConfig('SLA_HOURS_URGENT')).toBe(24);
    await SystemConfig.updateOne({ key: 'SLA_HOURS_URGENT' }, { value: 10 });
    expect(await ensureDefaultConfigs()).toBe(0);
    expect(await getConfig('SLA_HOURS_URGENT')).toBe(10);
    expect(await getConfigs(['SLA_HOURS_URGENT', 'PAYMENT_TERM_DAYS'])).toEqual({ SLA_HOURS_URGENT: 10, PAYMENT_TERM_DAYS: 15 });
  });

  it('GET: Manager chỉ thấy BUSINESS, Admin chỉ TECHNICAL, role khác 403', async () => {
    const manager = await createManager();
    const admin = await createUser('ADMIN');
    const m = await call(manager)('get', '/api/system-configs');
    expect(m.status).toBe(200);
    expect(m.body.data.every((c) => c.scope === 'BUSINESS')).toBe(true);
    expect(m.body.data.length).toBeGreaterThan(5);
    const a = await call(admin)('get', '/api/system-configs');
    expect(a.body.data.map((c) => c.key)).toEqual(['UPLOAD_MAX_SIZE_MB']);
    for (const role of ['ACCOUNTANT', 'BOARD', 'RESIDENT']) {
      expect((await call(await createUser(role))('get', '/api/system-configs')).status).toBe(403);
    }
  });

  it('PATCH: đúng scope theo role (Manager ↔ BUSINESS, Admin ↔ TECHNICAL), ghi audit CONFIG_CHANGED', async () => {
    const manager = await createManager();
    const admin = await createUser('ADMIN');
    expect((await call(manager)('patch', '/api/system-configs/UPLOAD_MAX_SIZE_MB', { value: 10 })).status).toBe(403);
    expect((await call(admin)('patch', '/api/system-configs/SLA_HOURS_URGENT', { value: 10 })).status).toBe(403);
    expect((await call(manager)('patch', '/api/system-configs/KHONG_CO', { value: 10 })).status).toBe(404);

    const ok = await call(manager)('patch', '/api/system-configs/sla_hours_urgent', { value: 12 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.value).toBe(12);
    expect(await getConfig('SLA_HOURS_URGENT')).toBe(12);
    const log = await AuditLog.findOne({ action: 'CONFIG_CHANGED' }).lean();
    expect(log.metadata).toMatchObject({ key: 'SLA_HOURS_URGENT', before: 24, after: 12 });
    expect(String(log.performedBy)).toBe(String(manager._id));
  });

  it('validate giá trị: số ≤ 0, sai kiểu, mảng có số ≤ 0, tỷ lệ > 1 → VALIDATION_ERROR', async () => {
    const manager = await createManager();
    const bad = [
      ['SLA_HOURS_URGENT', 0],
      ['SLA_HOURS_URGENT', -5],
      ['SLA_HOURS_URGENT', '24'],
      ['SLA_HOURS_URGENT', { $gt: 1 }],
      ['TICKET_AUTO_CLOSE_DAYS', 1.5],
      ['DEBT_REMINDER_DAYS', [1, 0]],
      ['DEBT_REMINDER_DAYS', []],
      ['DEBT_REMINDER_DAYS', 7],
      ['FUND_APPROVAL_RATIO', 1.5],
    ];
    for (const [key, value] of bad) {
      const res = await call(manager)('patch', `/api/system-configs/${key}`, { value });
      expect(res.status, `${key}=${JSON.stringify(value)}`).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    }
    expect((await call(manager)('patch', '/api/system-configs/FUND_APPROVAL_RATIO', { value: 0.6 })).status).toBe(200);
    expect((await call(manager)('patch', '/api/system-configs/DEBT_REMINDER_DAYS', { value: [3, 10] })).status).toBe(200);
    expect(await getConfig('SLA_HOURS_URGENT')).toBe(24);
  });

  it('complaint-categories: Manager CRUD, slaHours ≤ 0 → 400, cư dân chỉ thấy loại đang dùng, xóa loại đã có ticket → chỉ ẩn', async () => {
    const manager = await createManager();
    const resident = await createResident();
    expect((await call(manager)('post', '/api/complaint-categories', { name: 'Điện', defaultPriority: 'HIGH', slaHours: 0 })).status).toBe(400);
    expect((await call(resident)('post', '/api/complaint-categories', { name: 'Điện', defaultPriority: 'HIGH', slaHours: 24 })).status).toBe(403);
    const created = await call(manager)('post', '/api/complaint-categories', { name: 'Điện', defaultPriority: 'HIGH', slaHours: 24 });
    expect(created.status).toBe(201);
    const id = created.body.data._id;
    expect((await call(manager)('post', '/api/complaint-categories', { name: 'Điện', defaultPriority: 'LOW', slaHours: 24 })).status).toBe(409);

    const upd = await call(manager)('patch', `/api/complaint-categories/${id}`, { slaHours: 48, isActive: false, _id: String(manager._id) });
    expect(upd.status).toBe(200);
    expect(upd.body.data.slaHours).toBe(48);
    expect(await AuditLog.countDocuments({ action: 'COMPLAINT_CATEGORY_CHANGED' })).toBe(2);

    expect((await call(resident)('get', '/api/complaint-categories')).body.data).toHaveLength(0);
    expect((await call(resident)('get', '/api/complaint-categories?includeInactive=true')).body.data).toHaveLength(0);
    expect((await call(manager)('get', '/api/complaint-categories?includeInactive=true')).body.data).toHaveLength(1);

    const del = await call(manager)('delete', `/api/complaint-categories/${id}`);
    expect(del.body.data).toEqual({ deleted: true, deactivated: false });
    expect(await ComplaintCategory.countDocuments()).toBe(0);
  });
});

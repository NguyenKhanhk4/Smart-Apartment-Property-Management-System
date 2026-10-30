// Dashboard hệ thống chỉ liệt kê cron job thực sự được đăng ký chạy (jobs/index.js), không liệt kê job chưa có handler.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { JOBS } from '../../src/jobs/index.js';
import { getDashboard } from '../../src/modules/adminDashboard/adminDashboard.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

test('getDashboard: danh sách cron = các job đã đăng ký', async () => {
  const dashboard = await getDashboard();
  assert.deepEqual(dashboard.system.jobs.map((j) => j.jobName).sort(), JOBS.map((j) => j.name).sort());
});

// Chọn nhà thầu qua API thật: chỉ Trưởng ban quản trị (BOARD:CHAIRMAN); dữ liệu sai bị chặn; báo hỏng không còn nhận nhà thầu
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { FundProposal } from '../../src/models/index.js';
import { createProposal, recordIncome } from '../../src/modules/fund/fund.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { stubCloudinary } from '../helpers/equipment.js';
import { asUser, createManager, createUser } from '../helpers/fixtures.js';
import { startApp, tokenFor } from '../helpers/http.js';

let app;
before(async () => {
  await connectTestDB();
  app = await startApp();
});
beforeEach(() => stubCloudinary());
afterEach(async () => {
  mock.restoreAll();
  await clearTestDB();
});
after(async () => {
  await app.close();
  await closeTestDB();
});

test('POST /fund/proposals/:id/select-vendor: thành viên, Trưởng BQL, Kế toán → 403; Trưởng ban → 200 và đổi số tiền', async () => {
  const accountant = asUser(await createUser('ACCOUNTANT'));
  const manager = asUser(await createManager());
  const chairman = asUser(await createUser('BOARD', { boardTitle: 'CHAIRMAN' }));
  const member = asUser(await createUser('BOARD', { boardTitle: 'MEMBER' }));
  await recordIncome(accountant, { incomeSource: 'INITIAL_HANDOVER', amount: 100_000_000, documentNo: 'BB' });
  const p = await createProposal(manager, { title: 'Sửa bơm', description: 'Bơm rò nước', amount: 60_000_000, planType: 'UNSCHEDULED', urgentReason: 'Mất nước' });
  const path = `/fund/proposals/${p._id}/select-vendor`;
  const body = { name: 'Công ty Hưng Phát', phone: null, amount: 55_000_000 };
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);

  for (const user of [member, manager, accountant]) assert.equal((await app.request('POST', path, { user, body })).status, 403);
  assert.equal((await app.request('POST', path, { user: chairman, body: { ...body, name: '' } })).status, 400);
  assert.equal((await app.request('POST', path, { user: chairman, body: { ...body, amount: 0 } })).status, 400);
  const noPhoto = await app.request('POST', path, { user: chairman, body });
  assert.equal(noPhoto.status, 400, 'thiếu ảnh báo giá');
  // Gửi multipart như trình duyệt
  const form = new FormData();
  form.append('name', body.name);
  form.append('amount', String(body.amount));
  form.append('images', new Blob([JPEG], { type: 'image/jpeg' }), 'bao-gia.jpg');
  const res = await fetch(`${app.base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${tokenFor(chairman)}` }, body: form });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const doc = await FundProposal.findById(p._id).lean();
  assert.equal(doc.amount, 55_000_000);
  assert.equal(doc.vendor.name, 'Công ty Hưng Phát');
  assert.equal(doc.vendor.quoteUrls.length, 1);
});

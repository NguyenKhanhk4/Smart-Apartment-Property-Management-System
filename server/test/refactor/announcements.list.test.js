// Module 8: kiểm thử phạm vi bảng tin, kiểm duyệt, khảo sát đồng thời một phiếu/căn và quyền HTTP.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Announcement } from '../../src/models/index.js';
import * as service from '../../src/modules/announcements/announcements.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createManager, createHousehold, createResidentUser, linkResident, createReceptionist } from '../helpers/fixtures.js';
import { startApp } from '../helpers/http.js';
import { Notification, Resident } from '../../src/models/index.js';
import express from 'express';
import { uploadImages } from '../../src/services/upload.service.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

async function survey(manager, extra = {}) {
  return service.publish(asUser(manager), { title: 'Khảo sát cư dân', content: 'Lấy ý kiến tham khảo', targetScope: 'ALL',
    poll: { audience: 'ACTIVE_RESIDENT', options: ['Đồng ý', 'Không đồng ý'], closesAt: new Date(Date.now() + 3600000) }, ...extra });
}

test('Module 8: gửi đồng thời hai thành viên chỉ tính một phiếu, chỉ người gửi được sửa', async () => {
  const manager = await createManager();
  const home = await createHousehold();
  const member = await createResidentUser(); await linkResident(member, home.apartment);
  const poll = await survey(manager);
  const results = await Promise.allSettled([home.user, member].map((u, option) => service.vote(asUser(u), poll._id, { apartmentId: String(home.apartment._id), option })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const winner = results[0].status === 'fulfilled' ? home.user : member;
  const loser = winner === home.user ? member : home.user;
  await service.vote(asUser(winner), poll._id, { apartmentId: String(home.apartment._id), option: 1 });
  const result = await service.pollResults(asUser(manager), poll._id);
  assert.equal(result.total, 1); assert.equal(result.options[1].count, 1);
  await assert.rejects(service.vote(asUser(loser), poll._id, { apartmentId: String(home.apartment._id), option: 0 }));
  assert.equal((await service.getById(asUser(home.user), poll._id)).poll.votes, undefined);
  assert.equal((await service.list(asUser(manager), {})).items[0].poll.votes, undefined);
  assert.equal(JSON.stringify(result).includes(String(winner._id)), false);
});

test('Module 8: sai căn, chuyển đi, sai nhóm chủ hộ, phương án sai và đóng khảo sát đều bị chặn', async () => {
  const manager = await createManager(); const home = await createHousehold({ relationType: 'FAMILY_MEMBER' });
  const other = await createHousehold();
  const poll = await survey(manager, { poll: { audience: 'OWNER', options: ['A', 'B'], closesAt: new Date(Date.now() + 3600000) } });
  await assert.rejects(service.vote(asUser(home.user), poll._id, { apartmentId: String(home.apartment._id), option: 0 }), { status: 403 });
  await assert.rejects(service.vote(asUser(other.user), poll._id, { apartmentId: String(home.apartment._id), option: 0 }), { status: 403 });
  await assert.rejects(service.vote(asUser(other.user), poll._id, { apartmentId: String(other.apartment._id), option: 10 }));
  await service.vote(asUser(other.user), poll._id, { apartmentId: String(other.apartment._id), option: 0 });
  await Resident.updateOne({ userId: other.user._id }, { $set: { isActive: false } });
  await assert.rejects(service.vote(asUser(other.user), poll._id, { apartmentId: String(other.apartment._id), option: 1 }), { status: 403 });
  await service.closePoll(asUser(manager), poll._id);
  assert.equal((await service.pollResults(asUser(manager), poll._id)).closed, true);
});

test('Module 8: người có hai căn không dùng căn thứ hai bỏ phiếu vào khảo sát riêng căn thứ nhất', async () => {
  const manager = await createManager(); const first = await createHousehold(); const second = await createHousehold();
  await linkResident(first.user, second.apartment);
  const poll = await survey(manager, { targetScope: 'APARTMENT', targetId: first.apartment._id });
  await assert.rejects(service.vote(asUser(first.user), poll._id, { apartmentId: String(second.apartment._id), option: 0 }), { status: 403 });
  await assert.rejects(service.pollResults(asUser(first.user), poll._id, String(second.apartment._id)), { status: 403 });
  assert.equal((await service.list(asUser(first.user), { apartmentId: String(second.apartment._id) })).items.length, 0);
});

test('Module 8: khảo sát hết hạn không nhận phiếu; số phiếu bằng 0 trả tỷ lệ 0', async () => {
  const manager = await createManager(); const home = await createHousehold(); const poll = await survey(manager);
  assert.deepEqual((await service.pollResults(asUser(manager), poll._id)).options.map((o) => o.percentage), [0, 0]);
  await Announcement.updateOne({ _id: poll._id }, { $set: { 'poll.closesAt': new Date(Date.now() - 1000) } });
  await assert.rejects(service.vote(asUser(home.user), poll._id, { apartmentId: String(home.apartment._id), option: 0 }));
});

test('Module 8: bài riêng đúng căn, bình luận ẩn không lộ cho cư dân, chỉ quản lý kiểm duyệt', async () => {
  const manager = await createManager(); const home = await createHousehold(); const other = await createHousehold();
  const article = await survey(manager, { targetScope: 'APARTMENT', targetId: home.apartment._id });
  await assert.rejects(service.getById(asUser(other.user), article._id), { status: 404 });
  await assert.rejects(service.addComment(asUser(other.user), article._id, 'Không được đọc'), { status: 404 });
  const comment = await service.addComment(asUser(home.user), article._id, '<script>alert(1)</script>');
  await assert.rejects(service.hideComment(asUser(home.user), article._id, comment._id), { status: 403 });
  await service.hideComment(asUser(manager), article._id, comment._id);
  assert.equal((await service.comments(asUser(home.user), article._id)).items.length, 0);
  assert.equal((await service.comments(asUser(manager), article._id)).items.length, 1);
  await service.remove(asUser(manager), article._id);
  assert.equal(await Notification.countDocuments({ refId: article._id, userId: other.user._id }), 0);
});

test('Module 8: HTTP chỉ quản lý đăng, từ chối khảo sát trùng phương án; cư dân vẫn đọc bảng tin', async () => {
  const manager = await createManager(); const home = await createHousehold(); const reception = await createReceptionist();
  const app = await startApp();
  try {
    const body = { title: 'Thông báo mới', content: 'Nội dung thông báo', targetScope: 'ALL' };
    assert.equal((await app.request('POST', '/announcements', { user: asUser(reception), body })).status, 403);
    assert.equal((await app.request('POST', '/announcements', { user: asUser(manager), body: { ...body, poll: { audience: 'OWNER', options: ['A', 'A'], closesAt: new Date(Date.now() + 3600000) } } })).status, 400);
    const created = await app.request('POST', '/announcements', { user: asUser(manager), body });
    assert.equal(created.status, 201);
    assert.equal((await app.request('GET', '/announcements', { user: asUser(home.user) })).status, 200);
    assert.equal((await app.request('PATCH', `/announcements/${created.body.data._id}/poll/close`, { user: asUser(home.user) })).status, 403);
  } finally { await app.close(); }
});

test('Module 8: Ban quản trị xem kết quả tổng hợp, không lộ danh tính, không được đóng khảo sát', async () => {
  const manager = await createManager(); const poll = await survey(manager);
  const board = { ...asUser(manager), role: 'BOARD' };
  assert.equal((await service.pollResults(board, poll._id)).total, 0);
  await assert.rejects(service.closePoll(board, poll._id), { status: 403 });
  await assert.rejects(service.pollResults({ ...board, role: 'STAFF' }, poll._id), { status: 403 });
});

test('Module 8: upload PDF chỉ được bật ở bảng tin; từ chối file giả định dạng và HTML', async () => {
  const app = express();
  app.post('/board', uploadImages('attachments', 5, true), (req, res) => res.json({ count: req.files.length }));
  app.post('/photo', uploadImages('attachments'), (_req, res) => res.json({ ok: true }));
  app.use((error, _req, res, _next) => res.status(400).json({ message: error.message }));
  const server = app.listen(0); await new Promise((resolve) => server.once('listening', resolve));
  try {
    const send = (path, content, type, name) => {
      const body = new FormData(); body.append('attachments', new Blob([content], { type }), name);
      return fetch(`http://127.0.0.1:${server.address().port}/${path}`, { method: 'POST', body });
    };
    assert.equal((await send('board', '%PDF-1.7\nexample', 'application/pdf', 'test.pdf')).status, 200);
    assert.equal((await send('photo', '%PDF-1.7\nexample', 'application/pdf', 'test.pdf')).status, 400);
    assert.equal((await send('board', '<script>bad</script>', 'application/pdf', 'fake.pdf')).status, 400);
    assert.equal((await send('board', '<html>bad</html>', 'text/html', 'bad.html')).status, 400);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('bài ghim lên đầu rồi mới nhất trước; phân trang', async () => {
  const manager = await createManager();
  const t0 = Date.now();
  const make = (title, isPinned, minutesAgo) =>
    Announcement.create({ title, content: 'x', targetScope: 'ALL', isPinned, createdBy: manager._id, createdAt: new Date(t0 - minutesAgo * 60_000) });
  await make('cu', false, 30);
  await make('ghim-cu', true, 20);
  await make('moi', false, 1);
  await make('ghim-moi', true, 10);

  const page1 = await service.list(asUser(manager), { page: 1, limit: 3 });
  assert.deepEqual(page1.items.map((a) => a.title), ['ghim-moi', 'ghim-cu', 'moi']);
  assert.deepEqual(page1.pagination, { page: 1, limit: 3, total: 4 });
  const page2 = await service.list(asUser(manager), { page: 2, limit: 3 });
  assert.deepEqual(page2.items.map((a) => a.title), ['cu']);
});

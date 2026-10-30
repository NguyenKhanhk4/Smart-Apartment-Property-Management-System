// Chốt hành vi danh sách bảng tin trước khi đổi sang paginate(): bài ghim lên đầu, sau đó mới nhất; phân trang đúng.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Announcement } from '../../src/models/index.js';
import * as service from '../../src/modules/announcements/announcements.service.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createManager } from '../helpers/fixtures.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

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

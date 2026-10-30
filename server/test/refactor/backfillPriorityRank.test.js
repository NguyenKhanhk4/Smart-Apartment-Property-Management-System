// Ticket cũ (trước khi có priorityRank) phải được bổ sung để sort=priority sắp đúng mức nghiêm trọng.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Ticket } from '../../src/models/index.js';
import { backfillPriorityRank } from '../../scripts/backfillTicketPriorityRank.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { createHousehold, createTicket } from '../helpers/fixtures.js';

before(connectTestDB);
afterEach(clearTestDB);
after(closeTestDB);

test('bổ sung priorityRank cho ticket cũ, chạy lại không đổi gì', async () => {
  const { user, apartment } = await createHousehold();
  const t1 = await createTicket({ apartment, createdBy: user, priority: 'URGENT' });
  const t2 = await createTicket({ apartment, createdBy: user, priority: 'LOW' });
  await Ticket.collection.updateMany({}, { $unset: { priorityRank: '' } }); // giả lập dữ liệu cũ

  assert.equal(await backfillPriorityRank(), 2);
  assert.equal((await Ticket.findById(t1._id).lean()).priorityRank, 3);
  assert.equal((await Ticket.findById(t2._id).lean()).priorityRank, 0);
  assert.equal(await backfillPriorityRank(), 0);
});

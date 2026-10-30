/**
 * Bổ sung tickets.priorityRank cho ticket tạo trước khi có field này (để sort=priority sắp theo mức nghiêm trọng).
 * Chạy 1 lần, chạy lại không đổi gì:  node scripts/backfillTicketPriorityRank.js
 */
import { pathToFileURL } from 'node:url';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { PRIORITY_ORDER } from '../src/constants/enums.js';
import { Ticket } from '../src/models/index.js';

/** Trả về số ticket đã cập nhật (dùng được khi đã có kết nối DB, vd trong test) */
export async function backfillPriorityRank() {
  let updated = 0;
  for (const [rank, priority] of PRIORITY_ORDER.entries()) {
    const res = await Ticket.updateMany(
      { priority, priorityRank: { $ne: rank } },
      { $set: { priorityRank: rank } },
    );
    updated += res.modifiedCount;
  }
  return updated;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await connectDB();
  try {
    console.log(`[backfillTicketPriorityRank] Đã cập nhật ${await backfillPriorityRank()} ticket`);
  } finally {
    await disconnectDB();
  }
}

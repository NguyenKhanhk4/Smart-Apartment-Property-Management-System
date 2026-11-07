// Xem trước: node scripts/migrateResidentHistoryIndex.js
// Áp dụng sau khi xem trước và sao lưu: node scripts/migrateResidentHistoryIndex.js --apply
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { migrateResidentHistoryIndex } from '../src/modules/residents/residentHistoryIndexes.js';

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--apply')) throw new Error('Chỉ hỗ trợ tùy chọn --apply; mặc định chỉ xem trước.');
try {
  // Không để autoIndex của ứng dụng tự thay chỉ mục trước khi đã xem kế hoạch.
  await mongoose.connect(env.mongodbUri, { autoIndex: false, serverSelectionTimeoutMS: 15000 });
  console.log(JSON.stringify(await migrateResidentHistoryIndex({ apply: args.includes('--apply') }), null, 2));
} finally {
  await mongoose.disconnect();
}

// Tạo đủ 27 collection + đồng bộ index theo Mongoose model + tham số mặc định system_configs.
// Chạy lại bao nhiêu lần cũng được (idempotent). Cách chạy: npm run db:sync
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import * as models from '../src/models/index.js';
import { ensureDefaultConfigs } from '../src/services/systemConfig.service.js';

await connectDB();
const db = mongoose.connection.db;
const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));

for (const Model of Object.values(models)) {
  const name = Model.collection.collectionName;
  if (!existing.has(name)) await Model.createCollection();
  const dropped = await Model.syncIndexes(); // tạo index mới, xóa index không còn khai báo
  const indexes = await Model.collection.indexes();
  console.log(
    `${existing.has(name) ? '✓' : '+'} ${name.padEnd(22)} ${String(indexes.length).padStart(2)} index` +
      (dropped.length ? ` (đã xóa: ${dropped.join(', ')})` : ''),
  );
}

const added = await ensureDefaultConfigs();
console.log(`\nsystem_configs: thêm ${added} tham số mặc định còn thiếu`);
await disconnectDB();

// Tạo đủ 27 collection + đồng bộ index theo Mongoose model + tham số mặc định system_configs.
// Chạy lại bao nhiêu lần cũng được (idempotent). Cách chạy: npm run db:sync
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import * as models from '../src/models/index.js';
import { normalizePhone } from '../src/utils/validators.js';
import { ensureDefaultConfigs } from '../src/services/systemConfig.service.js';

await connectDB();
const db = mongoose.connection.db;
const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));

// Tài khoản cũ: SĐT phải đủ và không trùng thì mới tạo được index unique. Thiếu hoặc trùng thì dừng để sửa tay.
if (existing.has('users')) {
  const users = db.collection('users');
  const accounts = await users.find({}, { projection: { email: 1, phone: 1 } }).toArray();
  const byPhone = new Map();
  for (const u of accounts.filter((account) => account.phone)) {
    const phone = normalizePhone(u.phone);
    byPhone.set(phone, [...(byPhone.get(phone) ?? []), u]);
  }
  const missing = accounts.filter((u) => !u.phone);
  const duplicated = [...byPhone].filter(([, group]) => group.length > 1);
  if (missing.length || duplicated.length) {
    missing.forEach((u) => console.error(`Thiếu SĐT: ${u.email ?? u._id}`));
    duplicated.forEach(([phone, group]) => console.error(`Trùng SĐT ${phone}: ${group.map((u) => u.email ?? u._id).join(', ')}`));
    console.error('\nHãy sửa các tài khoản trên rồi chạy lại. Dữ liệu tài khoản chưa bị thay đổi.');
    await disconnectDB();
    process.exit(1);
  }

  for (const u of accounts) {
    const phone = normalizePhone(u.phone);
    if (phone !== u.phone) await users.updateOne({ _id: u._id }, { $set: { phone } });
  }
  // Tài khoản đã có mật khẩu coi như đã kích hoạt, nếu không sẽ không đăng nhập được khi UC01 kiểm tra activatedAt
  const activated = await users.updateMany(
    { activatedAt: null, passwordHash: { $exists: true, $ne: null } },
    [{ $set: { activatedAt: { $ifNull: ['$createdAt', '$$NOW'] } } }],
  );
  console.log(`users: đánh dấu đã kích hoạt ${activated.modifiedCount} tài khoản cũ\n`);
}

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

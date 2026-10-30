// MongoDB trong RAM cho test (mongodb-memory-server, replica set 1 node để có transaction).
// KHÔNG BAO GIỜ kết nối MONGODB_URI thật. Dùng trong 1 file test:
//   before(connectTestDB); afterEach(clearTestDB); after(closeTestDB);
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let replSet = null;

export async function connectTestDB() {
  if (process.env.NODE_ENV !== 'test') throw new Error('Test helper chỉ chạy khi NODE_ENV=test');
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)/.test(uri)) throw new Error(`URI test không phải máy cục bộ: ${uri}`);
  await mongoose.connect(uri, { autoIndex: true });
  // unique / partial index (mã sinh tự động, 1 chủ hộ / căn...) phải có trước khi test chạy
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  return mongoose.connection;
}

export async function clearTestDB() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

export async function closeTestDB() {
  await mongoose.disconnect();
  if (replSet) {
    await replSet.stop();
    replSet = null;
  }
}

// MongoDB trong RAM cho test (mongodb-memory-server) — KHÔNG BAO GIỜ kết nối MONGODB_URI thật.
// Dùng: beforeAll(connectTestDB); afterEach(clearTestDB); afterAll(closeTestDB);
// Test cần MongoDB transaction: beforeAll(() => connectTestDB({ replSet: true }), 120000);
import mongoose from 'mongoose';
import { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server';

let mongo = null;

/**
 * Không tham số: MongoDB standalone (như cũ). `{ replSet: true }`: replica set 1 node, hỗ trợ transaction.
 * Không khai báo tham số: `beforeAll(connectTestDB)` truyền thẳng hàm này, vitest sẽ coi tham số đầu là fixture (kể cả `...args`).
 */
export async function connectTestDB() {
  const options = arguments[0]?.replSet === true ? arguments[0] : undefined;
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Test helper chỉ chạy khi NODE_ENV=test');
  }
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  mongo =
    options?.replSet === true
      ? await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
      : await MongoMemoryServer.create();
  const uri = mongo.getUri();
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)/.test(uri)) {
    throw new Error(`URI test không phải máy cục bộ: ${uri}`);
  }
  await mongoose.connect(uri, { autoIndex: true });
  // Đảm bảo unique index đã có (code sinh mã, email...) trước khi test chạy
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  return mongoose.connection;
}

export async function clearTestDB() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

export async function closeTestDB() {
  await mongoose.disconnect();
  if (mongo) {
    await mongo.stop();
    mongo = null;
  }
}

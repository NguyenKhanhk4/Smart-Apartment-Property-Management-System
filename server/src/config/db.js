import mongoose from 'mongoose';
import { env } from './env.js';

mongoose.set('strictQuery', true);

export async function connectDB(uri = env.mongodbUri) {
  const conn = await mongoose.connect(uri, {
    autoIndex: !env.isProd,
    serverSelectionTimeoutMS: 15000,
  });
  if (!env.isTest) {
    console.log(`✅ MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
    if (conn.connection.name === 'test') {
      console.warn(
        '⚠️  Đang dùng database mặc định "test". Hãy thêm tên DB vào MONGODB_URI (vd .../sapms_dev).',
      );
    }
  }
  return conn;
}

export async function disconnectDB() {
  await mongoose.disconnect();
}

export function dbStatus() {
  return mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import Joi from 'joi';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(serverRoot, '.env'), quiet: true });

const isTest = process.env.NODE_ENV === 'test';

// Chỉ validate biến core cần. Module nào cần biến riêng (VNPay, Cloudinary, SMTP...) thì thêm vào đây.
const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(5000),
  MONGODB_URI: isTest ? Joi.string().allow('') : Joi.string().required(),
  CLIENT_URL: Joi.string().default('http://localhost:5173'),
  JWT_ACCESS_SECRET: isTest
    ? Joi.string().default('test-access-secret')
    : Joi.string().min(16).required(),
  JWT_REFRESH_SECRET: isTest
    ? Joi.string().default('test-refresh-secret')
    : Joi.string().min(16).required(),
  // Tuỳ chọn — thiếu thì tính năng tương ứng tự tắt (email chỉ ghi log, upload ảnh báo lỗi rõ ràng)
  CLOUDINARY_CLOUD_NAME: Joi.string().allow('').default(''),
  CLOUDINARY_API_KEY: Joi.string().allow('').default(''),
  CLOUDINARY_API_SECRET: Joi.string().allow('').default(''),
  SMTP_HOST: Joi.string().allow('').default('smtp.gmail.com'),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASS: Joi.string().allow('').default(''),
  MAIL_FROM: Joi.string().allow('').default(''),
  // false = không chạy node-cron trong process này (vd chạy nhiều instance)
  ENABLE_CRON: Joi.boolean().default(true),
}).unknown(true);

const { value, error } = schema.validate(process.env, { abortEarly: false, convert: true });

if (error) {
  const problems = error.details.map((d) => `  - ${d.message}`).join('\n');
  console.error(`❌ Cấu hình .env không hợp lệ (xem server/.env.example):\n${problems}`);
  process.exit(1);
}

export const env = {
  nodeEnv: value.NODE_ENV,
  isDev: value.NODE_ENV === 'development',
  isProd: value.NODE_ENV === 'production',
  isTest: value.NODE_ENV === 'test',
  port: value.PORT,
  mongodbUri: value.MONGODB_URI,
  // Cho phép nhiều origin, phân tách bằng dấu phẩy
  clientUrls: value.CLIENT_URL.split(',').map((s) => s.trim()),
  jwt: {
    accessSecret: value.JWT_ACCESS_SECRET,
    refreshSecret: value.JWT_REFRESH_SECRET,
  },
  cloudinary: {
    cloudName: value.CLOUDINARY_CLOUD_NAME,
    apiKey: value.CLOUDINARY_API_KEY,
    apiSecret: value.CLOUDINARY_API_SECRET,
    enabled: Boolean(
      value.CLOUDINARY_CLOUD_NAME && value.CLOUDINARY_API_KEY && value.CLOUDINARY_API_SECRET,
    ),
  },
  smtp: {
    host: value.SMTP_HOST,
    port: value.SMTP_PORT,
    user: value.SMTP_USER,
    pass: value.SMTP_PASS,
    from: value.MAIL_FROM || value.SMTP_USER,
    enabled: Boolean(value.SMTP_USER && value.SMTP_PASS),
  },
  enableCron: value.ENABLE_CRON && value.NODE_ENV !== 'test',
  timezone: 'Asia/Ho_Chi_Minh',
};

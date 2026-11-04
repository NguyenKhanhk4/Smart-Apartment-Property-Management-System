import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import Joi from 'joi';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(serverRoot, '.env'), quiet: true });

const ID_KEY_BYTES = 32;

// Chỉ validate biến core cần. Module nào cần biến riêng (VNPay, Cloudinary, SMTP...) thì thêm vào đây.
const buildSchema = (isTest, isProd) =>
  Joi.object({
    // Bắt buộc khai báo rõ: thiếu NODE_ENV mà tự coi là development thì production sẽ mở dev-login + lộ stack trace
    NODE_ENV: Joi.string().valid('development', 'production', 'test').required(),
    PORT: Joi.number().port().default(5000),
    MONGODB_URI: isTest ? Joi.string().allow('') : Joi.string().required(),
    CLIENT_URL: Joi.string().default('http://localhost:5173'),
    JWT_ACCESS_SECRET: isTest ? Joi.string().default('test-access-secret') : Joi.string().min(16).required(),
    JWT_REFRESH_SECRET: isTest ? Joi.string().default('test-refresh-secret') : Joi.string().min(16).required(),
    JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
    // Khóa mã hóa CCCD (AES-256-GCM): production bắt buộc; dev/test thiếu thì idCrypto dùng khóa dev cố định
    ID_ENCRYPTION_KEY: isProd
      ? Joi.string()
          .trim()
          .required()
          .custom((v, h) => (Buffer.from(v, 'base64').length === ID_KEY_BYTES ? v : h.error('any.invalid')))
          .messages({ 'any.invalid': 'ID_ENCRYPTION_KEY phải là 32 byte dạng base64' })
      : Joi.string().trim().allow('').default(''),
    // Đăng nhập nhanh không mật khẩu (modules/devAuth): chỉ có tác dụng khi NODE_ENV=development
    ENABLE_DEV_AUTH: Joi.boolean().default(true),
    // Swagger UI: mặc định tắt ở production
    ENABLE_SWAGGER: Joi.boolean().default(!isProd),
    // Giới hạn số lần gọi API đăng nhập / đăng ký / làm mới token theo IP
    AUTH_RATE_LIMIT_MAX: Joi.number().integer().min(1).default(10),
    AUTH_RATE_LIMIT_WINDOW_MINUTES: Joi.number().integer().min(1).default(15),
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

/**
 * Đọc + validate biến môi trường (hàm thuần để test). Sai cấu hình → throw Error liệt kê từng biến lỗi.
 */
export function parseEnv(source) {
  const isTest = source.NODE_ENV === 'test';
  const isProd = source.NODE_ENV === 'production';
  const { value, error } = buildSchema(isTest, isProd).validate(source, { abortEarly: false, convert: true });
  if (error) throw new Error(error.details.map((d) => `  - ${d.message}`).join('\n'));

  const isDev = value.NODE_ENV === 'development';
  return {
    nodeEnv: value.NODE_ENV,
    isDev,
    isProd,
    isTest,
    port: value.PORT,
    mongodbUri: value.MONGODB_URI,
    // Cho phép nhiều origin, phân tách bằng dấu phẩy
    clientUrls: value.CLIENT_URL.split(',').map((s) => s.trim()),
    jwt: {
      accessSecret: value.JWT_ACCESS_SECRET,
      refreshSecret: value.JWT_REFRESH_SECRET,
      accessExpiresIn: value.JWT_ACCESS_EXPIRES_IN,
      refreshExpiresIn: value.JWT_REFRESH_EXPIRES_IN,
    },
    idEncryptionKey: value.ID_ENCRYPTION_KEY ? Buffer.from(value.ID_ENCRYPTION_KEY, 'base64') : null,
    devAuthEnabled: isDev && value.ENABLE_DEV_AUTH,
    swaggerEnabled: value.ENABLE_SWAGGER,
    authRateLimit: {
      max: value.AUTH_RATE_LIMIT_MAX,
      windowMs: value.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
    },
    cloudinary: {
      cloudName: value.CLOUDINARY_CLOUD_NAME,
      apiKey: value.CLOUDINARY_API_KEY,
      apiSecret: value.CLOUDINARY_API_SECRET,
      enabled: Boolean(value.CLOUDINARY_CLOUD_NAME && value.CLOUDINARY_API_KEY && value.CLOUDINARY_API_SECRET),
    },
    smtp: {
      host: value.SMTP_HOST,
      port: value.SMTP_PORT,
      user: value.SMTP_USER,
      pass: value.SMTP_PASS,
      from: value.MAIL_FROM || value.SMTP_USER,
      enabled: Boolean(value.SMTP_USER && value.SMTP_PASS),
    },
    enableCron: value.ENABLE_CRON && !isTest,
    timezone: 'Asia/Ho_Chi_Minh',
  };
}

function loadEnv() {
  try {
    return parseEnv(process.env);
  } catch (err) {
    console.error(`❌ Cấu hình .env không hợp lệ (xem server/.env.example):\n${err.message}`);
    process.exit(1);
  }
}

export const env = loadEnv();

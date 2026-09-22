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
};

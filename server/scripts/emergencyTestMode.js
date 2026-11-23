/**
 * Bật / tắt chế độ test cảnh báo sự cố khẩn cấp (BR-X6) trên DB đang cấu hình trong .env.
 *   npm run emergency:test   → hạn nhận sự cố 1 phút, lặp cảnh báo khẩn mỗi 1 phút (thấy modal + mail sau ~1–2 phút)
 *   npm run emergency:reset  → trả về mặc định trong code (TICKET_ACK_MINUTES 30, EMERGENCY_REPEAT_MINUTES 15)
 * Không cần khởi động lại server: job đọc tham số từ DB mỗi lần chạy. Chỉ phiếu tạo SAU khi đổi mới theo hạn nhận mới.
 */
import { CONFIG_DEFAULTS, CONFIG_KEYS } from '../src/constants/enums.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { SystemConfig } from '../src/models/index.js';

const KEYS = [CONFIG_KEYS.TICKET_ACK_MINUTES, CONFIG_KEYS.EMERGENCY_REPEAT_MINUTES];
const mode = process.argv[2];
if (!['on', 'off'].includes(mode)) {
  console.error('Dùng: node scripts/emergencyTestMode.js on|off');
  process.exit(1);
}

await connectDB();
try {
  for (const key of KEYS) {
    const value = mode === 'on' ? 1 : CONFIG_DEFAULTS[key];
    await SystemConfig.updateOne({ key }, { $set: { value } });
    console.log(`${key} = ${value} phút`);
  }
  console.log(mode === 'on' ? '⚠️  Đang ở chế độ TEST — test xong chạy: npm run emergency:reset' : '✅ Đã trả về giá trị mặc định');
} finally {
  await disconnectDB();
}

import { DEFAULT_CONFIGS } from '../constants/enums.js';
import { SystemConfig } from '../models/index.js';

const DEFAULTS = Object.fromEntries(DEFAULT_CONFIGS.map((c) => [c.key, c.value]));

/**
 * Đọc tham số hệ thống (system_configs). Chưa có trong DB thì dùng giá trị mặc định ở
 * constants/enums.js → DEFAULT_CONFIGS. Không cache để thay đổi có hiệu lực ngay (UC-E01 bước 6).
 * @example const days = await getConfig('PAYMENT_TERM_DAYS')
 */
export async function getConfig(key, fallback = DEFAULTS[key]) {
  const doc = await SystemConfig.findOne({ key }).select('value').lean();
  return doc?.value ?? fallback;
}

export async function getConfigs(keys) {
  const docs = await SystemConfig.find({ key: { $in: keys } })
    .select('key value')
    .lean();
  const map = Object.fromEntries(docs.map((d) => [d.key, d.value]));
  return Object.fromEntries(keys.map((k) => [k, map[k] ?? DEFAULTS[k]]));
}

/** Tạo các tham số mặc định còn thiếu (không ghi đè giá trị đã sửa). */
export async function ensureDefaultConfigs() {
  const ops = DEFAULT_CONFIGS.map((c) => ({
    updateOne: { filter: { key: c.key }, update: { $setOnInsert: c }, upsert: true },
  }));
  const res = await SystemConfig.bulkWrite(ops);
  return res.upsertedCount;
}

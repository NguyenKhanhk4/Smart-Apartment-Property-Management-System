import { vnPeriod } from './time.js';

/**
 * Sinh mã tăng dần dạng `<PREFIX>-YYYYMM-xxxxx` (vd TK-202610-00012, PT-202610-00001).
 * Đọc mã lớn nhất cùng tiền tố rồi +1; nơi gọi nên retry khi gặp lỗi trùng (E11000) do ghi đồng thời.
 */
export async function nextMonthlyCode(Model, prefix, { field = 'code', digits = 5, date } = {}) {
  const base = `${prefix}-${vnPeriod(date).replace('-', '')}-`;
  const last = await Model.findOne({ [field]: { $regex: `^${base}` } })
    .sort({ [field]: -1 })
    .select(field)
    .lean();
  const seq = last ? Number.parseInt(last[field].slice(base.length), 10) + 1 : 1;
  return `${base}${String(seq).padStart(digits, '0')}`;
}

/** Chạy `fn` và thử lại khi trùng unique key (mã sinh đồng thời). */
export async function retryOnDuplicate(fn, attempts = 3) {
  for (let i = 1; ; i += 1) {
    try {
      return await fn();
    } catch (err) {
      if (err?.code !== 11000 || i >= attempts) throw err;
    }
  }
}

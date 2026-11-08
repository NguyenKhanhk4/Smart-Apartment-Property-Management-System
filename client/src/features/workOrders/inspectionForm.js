// UC08: chấm từng mục checklist ở trình duyệt (cùng quy tắc với server workOrders.inspection.js) — thuần JS để test

/** Mục đo: có đơn vị hoặc khoảng cho phép; còn lại là mục tick Đạt / Không đạt */
export const isMeasured = (item) => Boolean(item?.unit) || item?.minValue != null || item?.maxValue != null;

/** Trạng thái một mục: 'ok' | 'fail' | 'empty' */
export function itemStatus(item, input = {}) {
  if (isMeasured(item)) {
    const v = input.value;
    if (v === '' || v === null || v === undefined || !Number.isFinite(Number(v))) return 'empty';
    const n = Number(v);
    const inRange = (item.minValue == null || n >= item.minValue) && (item.maxValue == null || n <= item.maxValue);
    return inRange ? 'ok' : 'fail';
  }
  if (input.ok === true) return 'ok';
  if (input.ok === false) return 'fail';
  return 'empty';
}

/** Vị trí các mục bắt buộc đang không đạt → gợi ý Có sự cố và không cho chọn Đạt (bước 5a) */
export const failingRequired = (checklist = [], inputs = []) =>
  checklist.map((item, i) => (item.required !== false && itemStatus(item, inputs[i]) === 'fail' ? i : -1)).filter((i) => i >= 0);

/** Khoảng cho phép để hiện cạnh ô nhập: '370 – 400 V', '≥ 2 bar' */
export function rangeText(item) {
  const unit = item.unit ? ` ${item.unit}` : '';
  if (item.minValue != null && item.maxValue != null) return `${item.minValue} – ${item.maxValue}${unit}`;
  if (item.minValue != null) return `≥ ${item.minValue}${unit}`;
  if (item.maxValue != null) return `≤ ${item.maxValue}${unit}`;
  return unit.trim();
}

/** Dữ liệu form → mảng gửi server, cùng thứ tự checklist: { value } cho mục đo, { ok } cho mục tick */
export const toPayload = (checklist = [], inputs = []) =>
  checklist.map((item, i) => {
    const input = inputs[i] ?? {};
    if (isMeasured(item)) return { value: input.value === undefined || input.value === '' ? null : input.value };
    return { ok: typeof input.ok === 'boolean' ? input.ok : null };
  });

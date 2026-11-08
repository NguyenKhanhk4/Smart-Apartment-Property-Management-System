// UC07: hiển thị chu kỳ, bảo hành, checklist của thiết bị (thuần JS để test bằng node:test)

const UNIT_TEXT = { DAY: 'ngày', MONTH: 'tháng', QUARTER: 'quý' };

/** { cycleValue: 1, cycleUnit: 'MONTH' } → '1 tháng'; thiếu dữ liệu → '—' */
export function cycleText(asset) {
  if (!asset?.cycleValue || !UNIT_TEXT[asset.cycleUnit]) return '—';
  return `${asset.cycleValue} ${UNIT_TEXT[asset.cycleUnit]}`;
}

export const WARRANTY_WARNING_DAYS = 30; // giống server (BR-E07)
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Tình trạng bảo hành để hiện nhãn: null (không có ngày), 'EXPIRED', 'EXPIRING' (còn ≤ 30 ngày), 'VALID'.
 * So theo ngày (bỏ giờ) để ngày cuối bảo hành vẫn tính là còn hạn.
 */
export function warrantyState(warrantyEnd, now = new Date()) {
  if (!warrantyEnd) return null;
  const end = new Date(warrantyEnd);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const days = Math.round((endDay - today) / DAY_MS);
  if (days < 0) return 'EXPIRED';
  if (days <= WARRANTY_WARNING_DAYS) return 'EXPIRING';
  return 'VALID';
}

/** Mục checklist → mô tả ngắn: 'Đo (V): 370 – 400', 'Đo (bar): ≥ 2', 'Kiểm tra (tick)' */
export function checklistRule(item) {
  const hasMin = item.minValue != null && item.minValue !== '';
  const hasMax = item.maxValue != null && item.maxValue !== '';
  if (!item.unit && !hasMin && !hasMax) return 'Kiểm tra (tick)';
  const unit = item.unit ? ` (${item.unit})` : '';
  if (hasMin && hasMax) return `Đo${unit}: ${item.minValue} – ${item.maxValue}`;
  if (hasMin) return `Đo${unit}: ≥ ${item.minValue}`;
  if (hasMax) return `Đo${unit}: ≤ ${item.maxValue}`;
  return `Đo${unit}`;
}

/** Tên mục ở vị trí `index` trùng (không phân biệt hoa thường, khoảng trắng) với mục khác trong checklist */
export function isDuplicateLabel(rows = [], index, label) {
  const key = label?.trim().toLowerCase();
  if (!key) return false;
  return rows.some((r, i) => i !== index && r?.label?.trim().toLowerCase() === key);
}

/**
 * Chữ đi kèm ngày bảo trì tiếp theo: đã qua ngày → 'quá hạn N ngày', đúng hôm nay → 'đến hạn hôm nay', còn lại null.
 * So theo ngày, bỏ giờ.
 */
export function dueText(nextMaintenanceDate, now = new Date()) {
  if (!nextMaintenanceDate) return null;
  const d = new Date(nextMaintenanceDate);
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const late = Math.round((day(now) - day(d)) / DAY_MS);
  if (late > 0) return `quá hạn ${late} ngày`;
  if (late === 0) return 'đến hạn hôm nay';
  return null;
}

/** Dữ liệu form checklist → dữ liệu gửi server: bỏ dòng trống, ô số trống thành null */
export function cleanChecklist(rows = []) {
  const num = (v) => (v === '' || v === undefined || v === null ? null : Number(v));
  return rows
    .filter((r) => r?.label?.trim())
    .map((r) => ({
      label: r.label.trim(),
      unit: r.unit?.trim() || null,
      minValue: num(r.minValue),
      maxValue: num(r.maxValue),
      required: r.required !== false,
    }));
}

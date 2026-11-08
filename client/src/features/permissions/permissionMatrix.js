// UC04: tính toán cho trang Phân quyền (thuần JS để test bằng node:test)

export const ACTIONS = ['VIEW', 'CREATE', 'UPDATE', 'DELETE', 'APPROVE'];
export const ACTION_LABELS = { VIEW: 'Xem', CREATE: 'Tạo', UPDATE: 'Sửa', DELETE: 'Xóa', APPROVE: 'Duyệt' };
export const CORE_MESSAGE = 'Đây là quyền lõi của vai trò, không thể bỏ.'; // MSG-S14

export const keyOf = (featureCode, action) => `${featureCode}:${action}`;

/** Các ô đang bật của ma trận server trả về */
export function grantedOf(matrix) {
  const keys = new Set();
  for (const feature of matrix?.features ?? []) {
    for (const action of ACTIONS) if (feature.actions[action]?.granted) keys.add(keyOf(feature.code, action));
  }
  return keys;
}

/** Số ô khác nhau giữa bản đang sửa và bản đã lưu */
export function changedCount(saved, editing) {
  let n = 0;
  for (const k of saved) if (!editing.has(k)) n += 1;
  for (const k of editing) if (!saved.has(k)) n += 1;
  return n;
}

/** Bật / tắt một ô; ô ngoài phạm vi hoặc ô lõi thì giữ nguyên */
export function toggle(editing, feature, action) {
  const cell = feature.actions[action];
  if (!cell?.available || cell.core) return editing;
  const next = new Set(editing);
  const key = keyOf(feature.code, action);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** Gom chức năng theo nhóm, giữ thứ tự server trả về */
export function groupFeatures(features = []) {
  const groups = new Map();
  for (const f of features) {
    if (!groups.has(f.group)) groups.set(f.group, []);
    groups.get(f.group).push(f);
  }
  return [...groups].map(([group, items]) => ({ group, items }));
}

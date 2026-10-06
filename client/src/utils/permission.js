// Cùng ngữ nghĩa với middleware `authorize` của backend (srs_final.md §2.3):
//   'RESIDENT' | 'STAFF' | 'ACCOUNTANT' | 'MANAGER' | 'BOARD' | 'ADMIN' → đúng role đó
//   'STAFF:TECHNICIAN' → STAFF có roleTitle TECHNICIAN (RECEPTIONIST / SECURITY / TECHNICIAN)
//   'BOARD:CHAIRMAN'   → BOARD có boardTitle CHAIRMAN (CHAIRMAN / MEMBER)
// ADMIN không tự có quyền nghiệp vụ của role khác (BR-R3).
// Danh sách spec rỗng/không truyền = chỉ cần đăng nhập.

const TITLE_FIELD = { STAFF: 'roleTitle', BOARD: 'boardTitle' };

export function matchSpec(user, spec) {
  if (!user) return false;
  const [role, title] = spec.split(':');
  if (user.role !== role) return false;
  return !title || user[TITLE_FIELD[role]] === title;
}

export function hasRole(user, specs) {
  if (!user) return false;
  if (!specs || specs.length === 0) return true;
  return specs.some((spec) => matchSpec(user, spec));
}

// Cùng ngữ nghĩa với middleware `authorize` của backend:
//   'STAFF'            → mọi STAFF + ADMIN (BR10: Admin có toàn bộ quyền của Staff)
//   'STAFF:TECHNICIAN' → STAFF có roleTitle TECHNICIAN + ADMIN
//   'ADMIN' | 'BOARD' | 'RESIDENT' → đúng role đó
// Danh sách spec rỗng/không truyền = chỉ cần đăng nhập.

export function matchSpec(user, spec) {
  if (!user) return false;
  const [role, title] = spec.split(':');
  if (role === 'STAFF') {
    if (user.role === 'ADMIN') return true;
    return user.role === 'STAFF' && (!title || user.roleTitle === title);
  }
  return user.role === role;
}

export function hasRole(user, specs) {
  if (!user) return false;
  if (!specs || specs.length === 0) return true;
  return specs.some((spec) => matchSpec(user, spec));
}

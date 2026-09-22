// Role dùng cho phân quyền (SRS mục 3). Enum nghiệp vụ khác do từng module tự thêm vào file này.

export const ROLES = Object.freeze({
  RESIDENT: 'RESIDENT',
  STAFF: 'STAFF',
  BOARD: 'BOARD',
  ADMIN: 'ADMIN',
});

// Chức danh của STAFF
export const ROLE_TITLES = Object.freeze({
  RECEPTIONIST: 'RECEPTIONIST',
  SECURITY: 'SECURITY',
  TECHNICIAN: 'TECHNICIAN',
  ACCOUNTANT: 'ACCOUNTANT',
});

export const values = (enumObj) => Object.values(enumObj);

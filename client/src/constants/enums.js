// Nhãn tiếng Việt + màu antd Tag cho enum. Key phải khớp server/src/constants/enums.js.
// Module nào thêm enum nghiệp vụ thì thêm vào đây theo cùng dạng { VALUE: { label, color } }.

export const ROLES = {
  RESIDENT: { label: 'Cư dân', color: 'blue' },
  STAFF: { label: 'Nhân viên', color: 'cyan' },
  BOARD: { label: 'Ban quản trị', color: 'purple' },
  ADMIN: { label: 'Quản trị viên', color: 'red' },
};

export const ROLE_TITLES = {
  RECEPTIONIST: { label: 'Lễ tân', color: 'geekblue' },
  SECURITY: { label: 'Bảo vệ', color: 'volcano' },
  TECHNICIAN: { label: 'Kỹ thuật viên', color: 'orange' },
  ACCOUNTANT: { label: 'Kế toán', color: 'green' },
};

// Dùng cho <Select options={enumOptions(ROLES)} />
export const enumOptions = (enumObj) =>
  Object.entries(enumObj).map(([value, { label }]) => ({ value, label }));

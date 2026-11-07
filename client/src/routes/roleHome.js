// Trang đầu tiên sau khi đăng nhập, theo role
export const roleHome = (user) => (user?.role === 'RESIDENT' ? '/r/home' : '/app/home');

// Các role dùng giao diện nội bộ /app
<<<<<<< HEAD
export const ADMIN_AREA_ROLES = ['STAFF', 'ACCOUNTANT', 'MANAGER', 'BOARD'];
=======
export const ADMIN_AREA_ROLES = ['STAFF', 'ACCOUNTANT', 'MANAGER', 'BOARD', 'ADMIN'];
>>>>>>> origin/minh
export const RESIDENT_AREA_ROLES = ['RESIDENT'];

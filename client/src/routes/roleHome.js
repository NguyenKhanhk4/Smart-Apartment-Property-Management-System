// Trang đầu tiên sau khi đăng nhập, theo role
export const roleHome = (user) => (user?.role === 'RESIDENT' ? '/r/home' : '/app/home');

// Các role dùng giao diện quản trị (spec 'STAFF' đã bao gồm ADMIN)
export const ADMIN_AREA_ROLES = ['STAFF', 'BOARD'];
export const RESIDENT_AREA_ROLES = ['RESIDENT'];

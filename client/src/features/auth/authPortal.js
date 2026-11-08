import { createContext, useContext } from 'react';

// Hai cổng đăng nhập tách riêng: cư dân (/login, giao diện B xanh lá) và Ban quản lý (/staff/login, giao diện A).
// Kích hoạt / quên mật khẩu có ở cả hai cổng; trang dùng portalPath() để link về đúng cổng đang đứng.
export const PORTALS = {
  resident: { prefix: '', label: 'Cổng cư dân', other: 'staff' },
  staff: { prefix: '/staff', label: 'Cổng Ban quản lý', other: 'resident' },
};

export const AuthPortalContext = createContext('resident');

export const useAuthPortal = () => useContext(AuthPortalContext);

/** Đường dẫn trang tài khoản trong cổng: portalPath('staff', '/login') → '/staff/login' */
export const portalPath = (portal, path) => `${PORTALS[portal].prefix}${path}`;

/** Tài khoản có thuộc cổng này không: cư dân → cổng cư dân, còn lại (nhân viên, Ban quản trị) → cổng quản lý */
export const belongsToPortal = (user, portal) => (user?.role === 'RESIDENT') === (portal === 'resident');

/** Trang đăng nhập phù hợp khi chưa đăng nhập mà vào một đường dẫn */
export const loginPathFor = (pathname = '') => (pathname.startsWith('/app') ? '/staff/login' : '/login');

import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import ForbiddenPage from '../features/errors/ForbiddenPage';
import { roleHome } from './roleHome';
import { loginPathFor } from '../features/auth/authPortal';

// Chưa đăng nhập → trang đăng nhập đúng cổng (/app → cổng quản lý, còn lại → cổng cư dân), nhớ trang đang vào;
// không đủ quyền → trang 403
export function RequireAuth({ roles, menuKey, children }) {
  const { user, hasRole, canSee } = useAuth();
  const location = useLocation();

  if (!user) return <Navigate to={loginPathFor(location.pathname)} replace state={{ from: location }} />;
  if (roles?.length && !hasRole(...roles)) return <ForbiddenPage />;
  // UC04: mở thẳng đường dẫn của mục bị Trưởng BQL tắt quyền Xem cũng ra trang 403
  if (menuKey && !canSee({ key: menuKey, roles })) return <ForbiddenPage />;
  return children;
}

// Trang chỉ dành cho khách (login, register): đã đăng nhập thì về trang chủ theo role
export function GuestOnly({ children }) {
  const { user } = useAuth();
  return user ? <Navigate to={roleHome(user)} replace /> : children;
}

export function RootRedirect() {
  const { user } = useAuth();
  return <Navigate to={user ? roleHome(user) : '/login'} replace />;
}

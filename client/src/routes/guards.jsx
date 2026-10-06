import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import ForbiddenPage from '../features/errors/ForbiddenPage';
import { roleHome } from './roleHome';

// Chưa đăng nhập → /login (nhớ trang đang vào); không đủ quyền → trang 403
export function RequireAuth({ roles, children }) {
  const { user, hasRole } = useAuth();
  const location = useLocation();

  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (roles?.length && !hasRole(...roles)) return <ForbiddenPage />;
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

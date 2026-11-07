import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { adminMenu, residentMenu } from '../config/menu';
import { GuestOnly, RequireAuth, RootRedirect } from './guards';
import { ADMIN_AREA_ROLES, RESIDENT_AREA_ROLES } from './roleHome';
import AuthLayout from '../layouts/AuthLayout';
import AdminLayout from '../layouts/AdminLayout';
import ResidentLayout from '../layouts/ResidentLayout';
import LoginPage from '../features/auth/LoginPage';
import ActivationPage from '../features/auth/ActivationPage';
import ForgotPasswordPage from '../features/auth/ForgotPasswordPage';
import NotFoundPage from '../features/errors/NotFoundPage';

// Mỗi mục trong config/menu.js thành một route con, có kiểm tra quyền riêng
const toRoutes = (menu) =>
  menu.map(({ key, path, roles, component: Page }) => ({
    path,
    element: (
      <RequireAuth roles={roles} menuKey={key}>
        <Page />
      </RequireAuth>
    ),
  }));

const router = createBrowserRouter([
  { path: '/', element: <RootRedirect /> },
  {
    element: (
      <GuestOnly>
        <AuthLayout />
      </GuestOnly>
    ),
    children: [
      {
        path: '/login',
        element: <LoginPage />,
      },
      {
        path: '/activate',
        element: <ActivationPage />,
      },
      {
        path: '/forgot-password',
        element: <ForgotPasswordPage />,
      },
    ],
  },
  {
    path: '/app',
    element: (
      <RequireAuth roles={ADMIN_AREA_ROLES}>
        <AdminLayout />
      </RequireAuth>
    ),
    children: [{ index: true, element: <Navigate to="home" replace /> }, ...toRoutes(adminMenu)],
  },
  {
    path: '/r',
    element: (
      <RequireAuth roles={RESIDENT_AREA_ROLES}>
        <ResidentLayout />
      </RequireAuth>
    ),
    children: [{ index: true, element: <Navigate to="home" replace /> }, ...toRoutes(residentMenu)],
  },
  { path: '*', element: <NotFoundPage /> },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}

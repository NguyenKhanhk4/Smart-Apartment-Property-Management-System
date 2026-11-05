import { Link } from 'react-router';
import { Button, Result } from 'antd';
import { useAuth } from '../../hooks/useAuth';

export default function ForbiddenPage() {
  const { isAuthenticated, logout } = useAuth();

  return (
    <Result
      status="403"
      title="403"
      subTitle="Bạn không có quyền truy cập trang này."
      extra={[
        <Link key="home" to="/">
          <Button type="primary">Về trang chủ</Button>
        </Link>,
        // Trang chủ của tài khoản cũng có thể bị 403: luôn có đường đăng nhập bằng tài khoản khác
        isAuthenticated && (
          <Button key="logout" onClick={logout}>
            Đăng xuất
          </Button>
        ),
      ]}
    />
  );
}

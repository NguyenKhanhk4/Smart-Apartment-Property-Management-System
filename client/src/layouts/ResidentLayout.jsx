import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router';
import { Layout, Typography, theme } from 'antd';
import { residentMenu } from '../config/menu';
import { useAuth } from '../hooks/useAuth';
import UserMenu from '../components/UserMenu';
import PageLoader from '../components/PageLoader';

const { Header, Content } = Layout;
const MAX_WIDTH = 720;

// Layout cư dân, mobile-first: header gọn + thanh điều hướng dưới cùng sinh từ config/menu.js
export default function ResidentLayout() {
  const { hasRole } = useAuth();
  const { token } = theme.useToken();

  const visible = residentMenu.filter((item) => !item.hideInMenu && hasRole(...(item.roles ?? [])));

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Typography.Title level={4} style={{ margin: 0 }}>
          SAPMS
        </Typography.Title>
        <UserMenu compact />
      </Header>

      <Content
        style={{ width: '100%', maxWidth: MAX_WIDTH, margin: '0 auto', padding: '16px 16px 76px' }}
      >
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </Content>

      <nav className="resident-bottom-nav" aria-label="Điều hướng chính">
        {visible.map(({ key, path, label, icon: Icon }) => (
          <NavLink key={key} to={`/r/${path}`}>
            {Icon && <Icon />}
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </Layout>
  );
}

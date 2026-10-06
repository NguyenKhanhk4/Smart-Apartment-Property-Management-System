import { Suspense, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { Button, Flex, Layout, Menu, Typography, theme } from 'antd';
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import { adminMenu } from '../config/menu';
import { useAuth } from '../hooks/useAuth';
import UserMenu from '../components/UserMenu';
import PageLoader from '../components/PageLoader';
import NotificationBell from '../features/notifications/NotificationBell';

const { Header, Sider, Content } = Layout;

// Layout nội bộ (STAFF / ACCOUNTANT / MANAGER / BOARD / ADMIN): sidebar sinh từ config/menu.js, lọc theo quyền
export default function AdminLayout() {
  const { hasRole } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const visible = adminMenu.filter((item) => !item.hideInMenu && hasRole(...(item.roles ?? [])));
  const activeKey = pathname.split('/')[2];
  const activeItem = adminMenu.find((item) => item.path === activeKey);

  const handleNavigate = ({ key }) => {
    navigate(`/app/${key}`);
    if (isMobile) setCollapsed(true);
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        theme="light"
        trigger={null}
        collapsible
        collapsed={collapsed}
        breakpoint="lg"
        width={232}
        collapsedWidth={isMobile ? 0 : 80}
        onBreakpoint={(broken) => {
          setIsMobile(broken);
          setCollapsed(broken);
        }}
        style={{ borderRight: `1px solid ${token.colorBorderSecondary}` }}
      >
        <Typography.Title
          level={4}
          style={{ margin: 0, padding: '16px 24px', whiteSpace: 'nowrap' }}
        >
          {collapsed ? 'S' : 'SAPMS'}
        </Typography.Title>
        <Menu
          mode="inline"
          selectedKeys={activeItem ? [activeItem.path] : []}
          items={visible.map(({ path, label, icon: Icon }) => ({
            key: path,
            label,
            icon: Icon && <Icon />,
          }))}
          onClick={handleNavigate}
          style={{ borderInlineEnd: 'none' }}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            padding: '0 16px',
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Flex align="center" gap={8}>
            <Button
              type="text"
              aria-label={collapsed ? 'Mở menu' : 'Thu gọn menu'}
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((c) => !c)}
            />
            <Typography.Text strong>{activeItem?.label}</Typography.Text>
          </Flex>
          <Flex align="center" gap={8}>
            <NotificationBell area="app" />
            <UserMenu compact={isMobile} />
          </Flex>
        </Header>

        <Content style={{ padding: isMobile ? 12 : 24 }}>
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </Content>
      </Layout>
    </Layout>
  );
}

import { createElement } from 'react';
<<<<<<< HEAD
import { useNavigate } from 'react-router';
=======
import { useLocation, useNavigate } from 'react-router';
>>>>>>> origin/minh
import { Card, Empty, Flex, Space, Tag, Typography } from 'antd';
import { PushpinFilled } from '@ant-design/icons';
import { useAuth } from '../../hooks/useAuth';
import { useApi } from '../../hooks/useApi';
import { announcementApi } from '../../api/moduleE.api';
<<<<<<< HEAD
import { adminMenu } from '../../config/menu';
=======
import { adminMenu, residentMenu } from '../../config/menu';
>>>>>>> origin/minh
import { roleLabelOf } from '../../constants/enums';
import { formatDateTime } from '../../utils/format';
import ReceptionHomePage from './reception/ReceptionHomePage';

<<<<<<< HEAD
// Trang chủ giao diện nội bộ (/app): lối tắt tới các chức năng được phép + bảng tin mới nhất.
// Cư dân dùng ResidentHomePage.
=======
// Trang chủ cho cả hai giao diện: lối tắt tới các chức năng được phép + bảng tin mới nhất.
>>>>>>> origin/minh
// Dashboard số liệu chi tiết nằm ở mục Báo cáo (UC-E10..E14).
function DefaultHome() {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();
<<<<<<< HEAD
  const shortcuts = adminMenu.filter(
    (m) => m.key !== 'home' && !m.hideInMenu && !m.path.includes(':') && hasRole(...(m.roles ?? [])),
=======
  const area = useLocation().pathname.startsWith('/r') ? 'r' : 'app';
  const menu = area === 'r' ? residentMenu : adminMenu;
  const shortcuts = menu.filter(
    (m) => m.key !== 'home' && !m.path.includes(':') && hasRole(...(m.roles ?? [])),
>>>>>>> origin/minh
  );
  const role = roleLabelOf(user);
  const { data: news = [], loading } = useApi(() => announcementApi.list({ limit: 5 }), []);

  return (
    <Flex vertical gap={16}>
      <Card>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          Xin chào, {user.fullName}
        </Typography.Title>
        <Space wrap>{role && <Tag color={role.color}>{role.label}</Tag>}</Space>
      </Card>

      {shortcuts.length > 0 && (
        <Flex gap={12} wrap>
          {shortcuts.map((m) => (
            <Card
              key={m.key}
              hoverable
              size="small"
<<<<<<< HEAD
              onClick={() => navigate(`/app/${m.path}`)}
=======
              onClick={() => navigate(`/${area}/${m.path}`)}
>>>>>>> origin/minh
              style={{ flex: '1 1 150px', maxWidth: 220, textAlign: 'center' }}
            >
              {m.icon && <div style={{ fontSize: 24, color: '#1E3A5F' }}>{createElement(m.icon)}</div>}
              <Typography.Text>{m.label}</Typography.Text>
            </Card>
          ))}
        </Flex>
      )}

      <Card
        title="Bảng tin mới"
        size="small"
        loading={loading}
<<<<<<< HEAD
        extra={<Typography.Link onClick={() => navigate('/app/announcements')}>Xem tất cả</Typography.Link>}
=======
        extra={<Typography.Link onClick={() => navigate(`/${area}/announcements`)}>Xem tất cả</Typography.Link>}
>>>>>>> origin/minh
      >
        {!news.length && <Empty description="Chưa có bài đăng" />}
        <Flex vertical gap={12}>
          {news.map((a) => (
            <Flex key={a._id} vertical>
              <Typography.Text strong>
                {a.isPinned && <PushpinFilled style={{ color: '#fa8c16', marginRight: 6 }} />}
                {a.title}
              </Typography.Text>
              <Typography.Text type="secondary" ellipsis>
                {a.content}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {formatDateTime(a.createdAt)}
              </Typography.Text>
            </Flex>
          ))}
        </Flex>
      </Card>
    </Flex>
  );
}

// Lễ tân có trang chủ riêng (tra mã, việc cần xử lý); các vai trò khác dùng trang chung ở trên
export default function HomePage() {
  const { hasRole } = useAuth();
  return hasRole('STAFF:RECEPTIONIST') ? <ReceptionHomePage /> : <DefaultHome />;
}

import { Card, Space, Tag, Typography } from 'antd';
import { useAuth } from '../../hooks/useAuth';
import { ROLES, ROLE_TITLES } from '../../constants/enums';

// Trang chủ tạm cho cả hai giao diện. Dashboard (Module 10) sẽ thay thế.
export default function HomePage() {
  const { user } = useAuth();
  const title = user.roleTitle && ROLE_TITLES[user.roleTitle];

  return (
    <Card>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Xin chào, {user.fullName}
      </Typography.Title>
      <Space wrap>
        <Tag color={ROLES[user.role]?.color}>{ROLES[user.role]?.label ?? user.role}</Tag>
        {title && <Tag color={title.color}>{title.label}</Tag>}
      </Space>
    </Card>
  );
}

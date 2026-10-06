import { Avatar, Dropdown, Flex, Tag, Typography } from 'antd';
import { LogoutOutlined, UserOutlined } from '@ant-design/icons';
import { useAuth } from '../hooks/useAuth';
import { roleLabelOf } from '../constants/enums';

// Avatar + tên + role ở góc phải header, click để đăng xuất
export default function UserMenu({ compact = false }) {
  const { user, logout } = useAuth();
  const role = roleLabelOf(user);

  const items = [{ key: 'logout', icon: <LogoutOutlined />, label: 'Đăng xuất', danger: true }];

  return (
    <Dropdown
      menu={{ items, onClick: ({ key }) => key === 'logout' && logout() }}
      trigger={['click']}
    >
      <Flex align="center" gap={8} style={{ cursor: 'pointer' }}>
        <Avatar src={user.avatarUrl} icon={<UserOutlined />} />
        {!compact && (
          <>
            <Typography.Text strong>{user.fullName}</Typography.Text>
            {role && <Tag color={role.color}>{role.label}</Tag>}
          </>
        )}
      </Flex>
    </Dropdown>
  );
}

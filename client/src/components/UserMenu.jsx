import { useNavigate } from 'react-router';
import { Avatar, Dropdown } from 'antd';
import { LogoutOutlined, UserOutlined } from '@ant-design/icons';
import { useAuth } from '../hooks/useAuth';
import { roleLabelOf } from '../constants/enums';

// Avatar + tên + chức danh ở góc phải header; xem hồ sơ và đăng xuất
export default function UserMenu({ compact = false }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const role = roleLabelOf(user);

  const profilePath = user?.role === 'RESIDENT' ? '/r/profile' : '/app/profile';

  const items = [
    { key: 'profile', icon: <UserOutlined />, label: 'Hồ sơ cá nhân' },
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Đăng xuất', danger: true },
  ];

  const handleMenuClick = ({ key }) => {
    if (key === 'profile') {
      navigate(profilePath, { viewTransition: true });
    } else if (key === 'logout') {
      logout();
    }
  };

  return (
    <Dropdown menu={{ items, onClick: handleMenuClick }} trigger={['click']}>
      <button type="button" className="flex items-center gap-2.5 pl-1 cursor-pointer bg-transparent border-0">
        <Avatar size={32} src={user.avatarUrl} icon={<UserOutlined />} className="border border-gold/40" />
        {!compact && (
          <span className="text-left leading-tight">
            <span className="block text-[13px] font-semibold text-ink dark:text-[#EEF1F6]">{user.fullName}</span>
            {role && <span className="block text-[11px] text-ink-2 dark:text-[#A7B0BF] mt-0.5">{role.label}</span>}
          </span>
        )}
      </button>
    </Dropdown>
  );
}

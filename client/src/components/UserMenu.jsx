import { useNavigate } from 'react-router';
import { Avatar, Dropdown } from 'antd';
import { CarOutlined, HomeOutlined, LogoutOutlined, UserOutlined } from '@ant-design/icons';
import { useAuth } from '../hooks/useAuth';
import { roleLabelOf } from '../constants/enums';

const initials = (name) =>
  String(name ?? '')
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

// Avatar + tên + chức danh ở góc phải header; xem hồ sơ và đăng xuất
// variant="reception": avatar chữ cái đầu + dòng phụ "Lễ tân" theo giao diện mới của Lễ tân
export default function UserMenu({ compact = false, variant }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const role = roleLabelOf(user);

  const profilePath = user?.role === 'RESIDENT' ? '/r/profile' : '/app/profile';

  const items = [
    { key: 'profile', icon: <UserOutlined />, label: 'Hồ sơ cá nhân' },
    ...(user?.role === 'RESIDENT'
      ? [
          { key: 'my-apartment', icon: <HomeOutlined />, label: 'Căn hộ của tôi' },
          { key: 'my-vehicles', icon: <CarOutlined />, label: 'Xe của tôi' },
        ]
      : []),
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Đăng xuất', danger: true },
  ];

  const handleMenuClick = ({ key }) => {
    if (key === 'profile') {
      navigate(profilePath, { viewTransition: true });
    } else if (key === 'my-apartment') {
      navigate('/r/my-apartment', { viewTransition: true });
    } else if (key === 'my-vehicles') {
      navigate('/r/my-vehicles', { viewTransition: true });
    } else if (key === 'logout') {
      logout();
    }
  };

  return (
    <Dropdown menu={{ items, onClick: handleMenuClick }} trigger={['click']}>
      <button type="button" className="flex items-center gap-2.5 pl-1 cursor-pointer bg-transparent border-0">
        {variant === 'reception' ? (
          <Avatar size={44} src={user.avatarUrl} style={{ background: '#E7EEF8', color: '#1F4F8F', fontWeight: 600 }}>
            {initials(user.fullName)}
          </Avatar>
        ) : (
          <Avatar size={32} src={user.avatarUrl} icon={<UserOutlined />} className="border border-gold/40" />
        )}
        {!compact && (
          <span className="text-left leading-tight">
            <span className={`block font-semibold text-ink dark:text-[#EEF1F6] ${variant === 'reception' ? 'text-[15px]' : 'text-[13px]'}`}>{user.fullName}</span>
            {role && <span className="block text-[11px] text-ink-2 dark:text-[#A7B0BF] mt-0.5">{role.label}</span>}
          </span>
        )}
      </button>
    </Dropdown>
  );
}

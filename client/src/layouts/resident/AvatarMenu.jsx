import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Dropdown } from 'antd';
import { CarOutlined, DownOutlined, HomeOutlined, LogoutOutlined, UserOutlined } from '@ant-design/icons';
import ResidentAvatar from '../../components/resident/ResidentAvatar';
import { useAuth } from '../../hooks/useAuth';
import { useResident } from '../../hooks/useResident';

const itemClass =
  'w-full flex items-center gap-3 px-3 py-3 rounded-[10px] border-0 bg-transparent text-left text-sm cursor-pointer hover:bg-r-bg';

// Menu avatar góc phải: hồ sơ, căn hộ và gia đình, xe, đăng xuất. Trên web có thêm mũi tên xuống.
export default function AvatarMenu({ withCaret = false }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { memberCount, vehicleCount } = useResident();
  const [open, setOpen] = useState(false);

  const go = (path) => {
    setOpen(false);
    navigate(path, { viewTransition: true });
  };

  const rows = [
    { key: 'profile', icon: <UserOutlined />, label: 'Hồ sơ cá nhân', path: '/r/profile' },
    {
      key: 'apartment',
      icon: <HomeOutlined />,
      label: 'Căn hộ và gia đình',
      hint: memberCount != null ? `${memberCount} người` : null,
      path: '/r/my-apartment',
    },
    {
      key: 'vehicles',
      icon: <CarOutlined />,
      label: 'Xe của tôi',
      hint: vehicleCount != null ? `${vehicleCount} xe` : null,
      path: '/r/my-vehicles',
    },
  ];

  const panel = (
    <div
      role="menu"
      className="w-[228px] md:w-60 p-1.5 bg-white border border-r-border rounded-[14px] shadow-[0_12px_32px_rgba(30,35,48,0.14)]"
    >
      {rows.map((r) => (
        <button key={r.key} type="button" role="menuitem" onClick={() => go(r.path)} className={`${itemClass} text-r-text`}>
          <span className="text-[18px] leading-none">{r.icon}</span>
          <span className="flex-1">{r.label}</span>
          {r.hint && <span className="text-xs text-r-muted">{r.hint}</span>}
        </button>
      ))}
      <div className="h-px bg-r-divider mx-2 my-1" />
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setOpen(false);
          logout();
        }}
        className={`${itemClass} text-r-danger-text`}
      >
        <span className="text-[18px] leading-none">
          <LogoutOutlined />
        </span>
        Đăng xuất
      </button>
    </div>
  );

  return (
    <Dropdown open={open} onOpenChange={setOpen} trigger={['click']} placement="bottomRight" popupRender={() => panel}>
      <button
        type="button"
        aria-label="Tài khoản"
        aria-haspopup="menu"
        aria-expanded={open}
        className="h-11 min-w-11 flex items-center justify-center gap-2 border-0 bg-transparent cursor-pointer text-r-text"
      >
        <ResidentAvatar fullName={user.fullName} avatarUrl={user.avatarUrl} />
        {withCaret && <DownOutlined style={{ fontSize: 12 }} />}
      </button>
    </Dropdown>
  );
}

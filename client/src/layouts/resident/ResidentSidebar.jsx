import { createElement } from 'react';
import { Link, useLocation } from 'react-router';
import { Tooltip } from 'antd';
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import { motion } from 'motion/react';
import { residentMenu, residentSideNav } from '../../config/menu';
import { useAuth } from '../../hooks/useAuth';
import BrandLogo from '../../components/BrandLogo';
import SlidingIndicator from '../../motion/SlidingIndicator';
import { springConfig } from '../../motion/presets';

const WIDE = 236;
const NARROW = 68;

/**
 * Sidebar khu cư dân trên máy tính: khung nổi bo góc, menu chia nhóm (Tổng quan / Dịch vụ / Của tôi),
 * nút thu gọn ở đáy (thu gọn còn cột icon, rê chuột hiện tên). Ẩn mục bị Trưởng BQL tắt quyền Xem (UC04).
 */
export default function ResidentSidebar({ collapsed, onToggle }) {
  const { pathname } = useLocation();
  const { canSee } = useAuth();
  const activeKey = pathname.split('/')[2];
  const groups = residentSideNav
    .map(({ group, keys }) => ({
      group,
      items: keys.map((k) => residentMenu.find((m) => m.key === k)).filter((m) => m && canSee(m)),
    }))
    .filter((g) => g.items.length);

  return (
    <motion.aside
      animate={{ width: collapsed ? NARROW : WIDE }}
      transition={springConfig}
      className="h-[calc(100vh-24px)] sticky top-3 shrink-0 flex flex-col overflow-hidden bg-white border border-r-border rounded-[18px] shadow-float-r select-none z-30"
    >
      <Link
        to="/r/home"
        viewTransition
        className={`h-[60px] shrink-0 flex items-center gap-2.5 border-b border-r-divider no-underline text-r-text! ${collapsed ? 'justify-center' : 'px-4'}`}
      >
        <BrandLogo size={34} />
        {!collapsed && (
          <span className="vt-brand-title leading-tight whitespace-nowrap">
            <span className="block text-[14px] font-semibold">SAPMS</span>
            <span className="block text-[11px] text-r-subtle">Cổng cư dân</span>
          </span>
        )}
      </Link>

      <nav className="flex-1 overflow-y-auto px-2.5 py-3 flex flex-col gap-4" aria-label="Điều hướng chính">
        {groups.map(({ group, items }) => (
          <div key={group} className="flex flex-col gap-0.5">
            {!collapsed && (
              <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-r-subtle">{group}</div>
            )}
            {items.map((item) => {
              const active = activeKey === item.path.split('/')[0];
              const link = (
                <Link
                  key={item.key}
                  to={`/r/${item.path}`}
                  viewTransition
                  aria-current={active ? 'page' : undefined}
                  className="relative block no-underline rounded-[10px]"
                >
                  {active && <SlidingIndicator layoutId="resident-side-active" className="absolute inset-0 rounded-[10px] bg-r-ok-bg" />}
                  <span
                    className={`relative flex items-center gap-3 h-10 rounded-[10px] text-[13.5px] transition-colors ${
                      collapsed ? 'justify-center' : 'px-3'
                    } ${active ? 'text-r-navy font-semibold' : 'text-r-muted font-medium hover:text-r-text hover:bg-r-bg'}`}
                  >
                    {item.icon && <span className="text-[15px] leading-none shrink-0">{createElement(item.icon)}</span>}
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </span>
                </Link>
              );
              return collapsed ? (
                <Tooltip key={item.key} title={item.label} placement="right">
                  {link}
                </Tooltip>
              ) : (
                link
              );
            })}
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-r-divider p-2">
        <Tooltip title={collapsed ? 'Mở rộng menu' : undefined} placement="right">
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? 'Mở rộng menu' : 'Thu gọn menu'}
            aria-expanded={!collapsed}
            className={`w-full h-9 flex items-center gap-2.5 rounded-[10px] border-0 bg-transparent text-[13px] font-medium text-r-muted hover:text-r-text hover:bg-r-bg cursor-pointer ${
              collapsed ? 'justify-center' : 'px-3'
            }`}
          >
            {collapsed ? <MenuUnfoldOutlined className="text-base" /> : <MenuFoldOutlined className="text-base" />}
            {!collapsed && <span>Thu gọn menu</span>}
          </button>
        </Tooltip>
      </div>
    </motion.aside>
  );
}

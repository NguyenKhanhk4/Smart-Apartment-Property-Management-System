import { createElement } from 'react';
import { Link, useLocation } from 'react-router';
import { Tooltip } from 'antd';
import { adminMenu, receptionNav } from '../config/menu';
import { selectCounts, useReceptionDashboard } from '../features/home/reception/receptionDashboard';
import { useAuth } from '../hooks/useAuth';

// Sidebar riêng của Lễ tân: nhóm lại các mục có sẵn trong adminMenu (route và quyền không đổi),
// kèm badge số việc chờ. Badge vàng = việc cần duyệt / xử lý, xám = thông tin (số khách chưa đến). Ẩn khi bằng 0.
export default function ReceptionSidebarNav({ collapsed, onNavigate }) {
  const { pathname } = useLocation();
  const { hasRole } = useAuth();
  const counts = selectCounts(useReceptionDashboard());
  const activeKey = pathname.split('/')[2];
  const byKey = Object.fromEntries(adminMenu.map((m) => [m.key, m]));

  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5" aria-label="Menu chính">
      {receptionNav.map(({ group, items }, gi) => {
        const visible = items.map((i) => ({ ...i, menu: byKey[i.key] })).filter((i) => i.menu && hasRole(...(i.menu.roles ?? [])));
        if (!visible.length) return null;
        return (
          <div key={group ?? gi} className="space-y-1">
            {group && !collapsed && (
              <div className="px-3 pb-1 pt-1 text-[11px] font-bold tracking-[0.12em] uppercase text-[#C9A24A] select-none">{group}</div>
            )}
            {visible.map(({ menu, badge, badgeTone }) => {
              const active = activeKey === menu.path.split('/')[0];
              const count = badge ? counts[badge] : 0;
              const link = (
                <Link
                  key={menu.key}
                  to={`/app/${menu.path}`}
                  viewTransition
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className="block no-underline rounded-[10px]"
                >
                  {/* Màu chữ đặt ở thẻ con: CSS toàn cục của thẻ <a> không phân lớp nên sẽ đè class Tailwind đặt trên <a> */}
                  <span
                    className={`flex items-center gap-3 min-h-11 px-3 rounded-[10px] text-sm transition-colors ${
                      active ? 'bg-[#2C3858] text-white font-semibold' : 'text-[#C8D1DE] font-medium hover:bg-[#232E4D] hover:text-white'
                    } ${collapsed ? 'justify-center' : ''}`}
                  >
                    {menu.icon && <span className={`text-lg shrink-0 ${active ? 'text-[#C9A24A]' : 'text-[#8C93A0]'}`}>{createElement(menu.icon)}</span>}
                    {!collapsed && <span className="flex-1 truncate">{menu.label}</span>}
                    {!collapsed && count > 0 && (
                      <span
                        className={`min-w-6 h-6 px-2 rounded-full text-xs font-bold flex items-center justify-center ${
                          badgeTone === 'neutral' ? 'bg-[#3A4768] text-white' : 'bg-[#C9A24A] text-[#1A2440]'
                        }`}
                        aria-label={`${count} việc đang chờ`}
                      >
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                  </span>
                </Link>
              );
              return collapsed ? (
                <Tooltip key={menu.key} title={count > 0 ? `${menu.label} (${count})` : menu.label} placement="right">
                  {link}
                </Tooltip>
              ) : (
                link
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

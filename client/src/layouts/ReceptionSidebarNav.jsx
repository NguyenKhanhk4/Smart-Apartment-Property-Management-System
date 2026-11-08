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
  const { canSee } = useAuth();
  const counts = selectCounts(useReceptionDashboard());
  const activeKey = pathname.split('/')[2];
  const byKey = Object.fromEntries(adminMenu.map((m) => [m.key, m]));

  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5" aria-label="Menu chính">
      {receptionNav.map(({ group, items }, gi) => {
        const visible = items.map((i) => ({ ...i, menu: byKey[i.key] })).filter((i) => canSee(i.menu));
        if (!visible.length) return null;
        return (
          <div key={group ?? gi} className="space-y-1">
            {group && !collapsed && (
              <div className="px-3 pb-1 pt-1 text-[11px] font-medium tracking-wider uppercase text-ink-3 dark:text-[#8B8B94] select-none">{group}</div>
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
                  className="block no-underline rounded-md"
                >
                  {/* Màu chữ đặt ở thẻ con: CSS toàn cục của thẻ <a> không phân lớp nên sẽ đè class Tailwind đặt trên <a> */}
                  <span
                    className={`flex items-center gap-3 min-h-10 px-3 rounded-md text-[13px] transition-colors ${
                      active ? 'bg-navy-bg text-navy font-semibold dark:bg-[#27272A] dark:text-white' : 'text-ink-2 font-medium hover:bg-surface-alt hover:text-ink dark:text-[#A1A1AA] dark:hover:bg-[#27272A] dark:hover:text-white'
                    } ${collapsed ? 'justify-center' : ''}`}
                  >
                    {menu.icon && <span className={`text-lg shrink-0 ${active ? 'text-navy dark:text-[#60A5FA]' : 'text-ink-3'}`}>{createElement(menu.icon)}</span>}
                    {!collapsed && <span className="flex-1 truncate">{menu.label}</span>}
                    {!collapsed && count > 0 && (
                      <span
                        className={`min-w-6 h-6 px-2 rounded-full text-[11px] font-semibold flex items-center justify-center ${
                          badgeTone === 'neutral' ? 'bg-surface-alt text-ink-2 dark:bg-[#27272A] dark:text-[#A1A1AA]' : 'bg-navy text-white'
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

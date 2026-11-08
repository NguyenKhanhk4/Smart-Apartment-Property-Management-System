import { createElement } from 'react';
import { NavLink, useLocation } from 'react-router';
import { residentBottomNav, residentMenu } from '../../config/menu';
import { useAuth } from '../../hooks/useAuth';

const allItems = residentBottomNav.map((key) => residentMenu.find((m) => m.key === key)).filter(Boolean);
const CENTER_KEY = 'my-code';

/** Thanh điều hướng dưới (mobile): khung nổi cách mép 10px, 5 mục, "Mã của tôi" là nút tròn màu chính nổi ở giữa */
export default function BottomNav() {
  const activeKey = useLocation().pathname.split('/')[2];
  const { canSee } = useAuth();
  const items = allItems.filter(canSee); // UC04: ẩn mục bị Trưởng BQL tắt quyền Xem

  return (
    <nav
      aria-label="Điều hướng chính"
      className="fixed inset-x-2.5 z-40 grid bg-white border border-r-border rounded-[20px] shadow-float-r pt-2 pb-2 px-1"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, bottom: 'max(10px, env(safe-area-inset-bottom))' }}
    >
      {items.map(({ key, path, label, icon }) => {
        const active = activeKey === path.split('/')[0];
        const common = 'flex flex-col items-center gap-1 text-xs no-underline select-none';

        if (key === CENTER_KEY) {
          return (
            <NavLink key={key} to={`/r/${path}`} viewTransition aria-current={active ? 'page' : undefined} className={`${common} ${active ? 'text-r-navy! font-semibold' : 'text-r-text! font-medium'}`}>
              <span className="w-14 h-14 -mt-[30px] rounded-full bg-r-navy text-white flex items-center justify-center border-4 border-white shadow-float-r text-2xl">
                {createElement(icon)}
              </span>
              {label}
            </NavLink>
          );
        }
        return (
          <NavLink
            key={key}
            to={`/r/${path}`}
            viewTransition
            aria-current={active ? 'page' : undefined}
            className={`${common} min-h-12 justify-center ${active ? 'text-r-navy! font-semibold' : 'text-r-muted!'}`}
          >
            <span className="text-lg leading-none">{createElement(icon)}</span>
            {label}
          </NavLink>
        );
      })}
    </nav>
  );
}

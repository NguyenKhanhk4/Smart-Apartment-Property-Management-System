import { createElement } from 'react';
import { NavLink, useLocation } from 'react-router';
import { residentBottomNav, residentMenu } from '../../config/menu';

const items = residentBottomNav.map((key) => residentMenu.find((m) => m.key === key)).filter(Boolean);
const CENTER_KEY = 'my-code';

/** Thanh điều hướng dưới (mobile): 5 mục, "Mã của tôi" là nút tròn navy nổi ở giữa */
export default function BottomNav() {
  const activeKey = useLocation().pathname.split('/')[2];

  return (
    <nav
      aria-label="Điều hướng chính"
      className="fixed bottom-0 inset-x-0 z-40 grid grid-cols-5 bg-white border-t border-r-border pt-2 px-1"
      style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
    >
      {items.map(({ key, path, label, icon }) => {
        const active = activeKey === path.split('/')[0];
        const common = 'flex flex-col items-center gap-1 text-xs no-underline select-none';

        if (key === CENTER_KEY) {
          return (
            <NavLink key={key} to={`/r/${path}`} viewTransition aria-current={active ? 'page' : undefined} className={`${common} ${active ? 'text-r-navy! font-semibold' : 'text-r-text! font-medium'}`}>
              <span className="w-14 h-14 -mt-[30px] rounded-full bg-r-navy text-white flex items-center justify-center border-4 border-r-bg text-2xl">
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
            <span className="text-[22px] leading-none">{createElement(icon)}</span>
            {label}
          </NavLink>
        );
      })}
    </nav>
  );
}

import { Suspense, createElement } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { residentMenu } from '../config/menu';
import { useAuth } from '../hooks/useAuth';
import UserMenu from '../components/UserMenu';
import PageLoader from '../components/PageLoader';
import BrandLogo from '../components/BrandLogo';
import NotificationBell from '../features/notifications/NotificationBell';
import SlidingIndicator from '../motion/SlidingIndicator';
import PageTransition from '../motion/PageTransition';

const MAX_WIDTH = 720;

// Layout cư dân, mobile-first (tối đa 720px): header gọn + thanh điều hướng dưới cùng sinh từ config/menu.js.
// Mục đang chọn có vạch vàng trượt (layoutId); đổi trang có morph (view transition).
export default function ResidentLayout() {
  const { hasRole } = useAuth();
  const { pathname } = useLocation();
  const activeKey = pathname.split('/')[2];
  const visible = residentMenu.filter((item) => !item.hideInMenu && hasRole(...(item.roles ?? [])));

  return (
    <div className="min-h-screen bg-[#EDE7DC] dark:bg-[#080E18] flex justify-center">
      <div
        className="w-full min-h-screen flex flex-col bg-ivory dark:bg-[#0B1422] border-x border-line dark:border-[#24344D]"
        style={{ maxWidth: MAX_WIDTH }}
      >
        <header className="h-14 sticky top-0 z-30 px-4 flex items-center justify-between border-b border-line bg-white/95 backdrop-blur-md dark:bg-[#121E31]/95 dark:border-[#24344D]">
          <div className="flex items-center gap-2.5">
            <BrandLogo size={28} />
            <span className="vt-brand-title text-sm font-bold tracking-tight text-ink dark:text-[#EEF1F6]">SAPMS</span>
          </div>
          <div className="flex items-center gap-1">
            <NotificationBell area="r" />
            <UserMenu compact />
          </div>
        </header>

        <main className="flex-1 p-4 pb-24">
          <Suspense fallback={<PageLoader />}>
            <PageTransition key={pathname}>
              <Outlet />
            </PageTransition>
          </Suspense>
        </main>

        <nav
          aria-label="Điều hướng chính"
          className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full z-40 flex items-stretch justify-around h-16 px-2 border-t border-line bg-white shadow-[0_-2px_10px_rgba(15,27,45,0.05)] dark:bg-[#121E31] dark:border-[#24344D]"
          style={{ maxWidth: MAX_WIDTH, paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {visible.map(({ key, path, label, icon }) => {
            const active = activeKey === path.split('/')[0];
            return (
              <NavLink
                key={key}
                to={`/r/${path}`}
                viewTransition
                className="relative flex-1 flex flex-col items-center justify-center no-underline select-none"
              >
                {active && (
                  <SlidingIndicator layoutId="resident-nav" className="absolute top-1 w-10 h-1 rounded-full bg-gold" />
                )}
                <span
                  className={`flex flex-col items-center gap-1 transition-colors ${
                    active ? 'text-navy dark:text-gold' : 'text-ink-3 hover:text-ink-2'
                  }`}
                >
                  {icon && <span className="text-lg leading-none">{createElement(icon)}</span>}
                  <span className={`text-[11px] leading-none ${active ? 'font-semibold' : ''}`}>{label}</span>
                </span>
              </NavLink>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

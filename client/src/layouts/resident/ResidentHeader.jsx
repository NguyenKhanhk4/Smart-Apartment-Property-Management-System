import { createElement } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { IdcardOutlined } from '@ant-design/icons';
import { residentMenu, residentWebNav } from '../../config/menu';
import { useAuth } from '../../hooks/useAuth';
import { useResident } from '../../hooks/useResident';
import { givenName } from '../../utils/format';
import NotificationBell from '../../features/notifications/NotificationBell';
import SlidingIndicator from '../../motion/SlidingIndicator';
import ApartmentLabel from './ApartmentLabel';
import AvatarMenu from './AvatarMenu';

// Logo vuông navy theo thiết kế; giữ class morph để bay từ trang đăng nhập
function Logo({ size }) {
  return (
    <span
      className="vt-brand-logo shrink-0 flex items-center justify-center bg-r-navy text-[#F3D9A0]"
      style={{ width: size, height: size, borderRadius: size >= 40 ? 10 : 9 }}
      aria-hidden="true"
    >
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />
        <path d="M16 9h2a2 2 0 0 1 2 2v10" />
        <path d="M8 7h4M8 11h4M8 15h4M2 21h20" />
      </svg>
    </span>
  );
}

/** Header mobile (<768px): logo + lời chào + căn hộ, chuông, avatar. Có `title` (Tiện ích, Mã của tôi) thì chỉ hiện tiêu đề + chuông */
export function MobileHeader({ title }) {
  const { user } = useAuth();
  if (title) {
    return (
      <header className="sticky top-0 z-30 flex items-center justify-between pt-4 pb-3 px-5 bg-white border-b border-r-border">
        <h1 className="m-0 text-xl font-semibold">{title}</h1>
        <NotificationBell area="r" variant="resident" />
      </header>
    );
  }
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between pt-4 pb-3 px-5 bg-white border-b border-r-border">
      <div className="flex items-center gap-3 min-w-0">
        <Logo size={40} />
        <div className="min-w-0">
          <div className="text-base font-semibold leading-snug truncate">Chào {givenName(user.fullName)}</div>
          <ApartmentLabel />
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <NotificationBell area="r" variant="resident" />
        <AvatarMenu />
      </div>
    </header>
  );
}

const navItems = residentWebNav.map((key) => residentMenu.find((m) => m.key === key)).filter(Boolean);

/** Header web (≥768px): logo, nav ngang có gạch chân vàng, nút Mã của tôi, chuông, avatar */
export function WebHeader() {
  const { pathname } = useLocation();
  const { code } = useResident();
  const activeKey = pathname.split('/')[2];

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-r-border">
      <div className="max-w-[1200px] mx-auto px-6 min-h-[68px] flex flex-wrap items-center gap-x-8 gap-y-2">
        <Link to="/r/home" viewTransition className="flex items-center gap-2.5 no-underline text-r-text!">
          <Logo size={36} />
          <span className="vt-brand-title text-[17px] font-semibold tracking-[0.02em]">SAPMS</span>
        </Link>

        <nav aria-label="Điều hướng chính" className="flex flex-wrap gap-1 flex-1">
          {navItems.map(({ key, path, label }) => {
            const active = activeKey === path.split('/')[0];
            return (
              <NavLink
                key={key}
                to={`/r/${path}`}
                viewTransition
                aria-current={active ? 'page' : undefined}
                className={`relative px-3.5 pt-[22px] pb-5 text-[15px] no-underline ${
                  active ? 'font-semibold text-r-text!' : 'text-r-muted! hover:text-r-text!'
                }`}
              >
                {label}
                {active && (
                  <SlidingIndicator layoutId="resident-web-nav" className="absolute left-0 right-0 bottom-0 h-[3px] bg-r-gold" />
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            to="/r/my-code"
            viewTransition
            className="h-10 px-3.5 flex items-center gap-2 rounded-[10px] border border-r-border-control text-sm font-medium text-r-text! no-underline hover:bg-r-bg"
          >
            {createElement(IdcardOutlined, { style: { fontSize: 18 } })}
            Mã của tôi{code ? ` · ${code}` : ''}
          </Link>
          <NotificationBell area="r" variant="resident" />
          <AvatarMenu withCaret />
        </div>
      </div>
    </header>
  );
}

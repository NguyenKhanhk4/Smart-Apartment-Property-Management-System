import { createElement } from 'react';
import { Link } from 'react-router';
import { IdcardOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useAuth } from '../../hooks/useAuth';
import { useResident } from '../../hooks/useResident';
import { givenName } from '../../utils/format';
import NotificationBell from '../../features/notifications/NotificationBell';
import BrandLogo from '../../components/BrandLogo';
import ApartmentLabel from './ApartmentLabel';
import AvatarMenu from './AvatarMenu';

// Khung nổi: header là một khung trắng bo góc, đứng yên khi cuộn. Lớp nền phía sau che nội dung cuộn qua khe trên.
const FLOAT = 'bg-white border border-r-border rounded-[18px] shadow-float-r';

/** Header mobile (<768px): logo + lời chào + căn hộ, chuông, avatar. Có `title` (Tiện ích, Mã của tôi) thì chỉ hiện tiêu đề + chuông */
export function MobileHeader({ title }) {
  const { user } = useAuth();
  if (title) {
    return (
      <div className="sticky top-0 z-30 bg-r-bg px-2.5 pt-2.5">
        <header className={`${FLOAT} flex items-center justify-between h-14 px-4`}>
          <h1 className="m-0 text-lg font-semibold">{title}</h1>
          <NotificationBell area="r" variant="resident" />
        </header>
      </div>
    );
  }
  return (
    <div className="sticky top-0 z-30 bg-r-bg px-2.5 pt-2.5">
    <header className={`${FLOAT} flex items-center justify-between py-2.5 px-3.5`}>
      <div className="flex items-center gap-3 min-w-0">
        <BrandLogo size={38} />
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
    </div>
  );
}

/** Thanh trên khu cư dân trên máy tính (≥768px): khung nổi gồm lời chào + căn hộ đang chọn (đổi căn được) + ngày,
 *  nút Mã của tôi, chuông, avatar. Điều hướng nằm ở ResidentSidebar. */
export function WebHeader() {
  const { user } = useAuth();
  const { code } = useResident();
  const today = dayjs().format('dddd, DD/MM/YYYY').replace(/^./, (c) => c.toUpperCase());

  return (
    <div className="sticky top-0 z-20 bg-r-bg pt-3 -mt-3">
      <header className={`${FLOAT} h-[60px] px-4 flex items-center gap-4`}>
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-semibold leading-tight truncate">Chào {givenName(user.fullName)}</div>
          <div className="flex items-center gap-1.5 text-[12.5px] text-r-muted">
            <ApartmentLabel className="text-[12.5px] text-r-muted" />
            <span aria-hidden>·</span>
            <span className="truncate">{today}</span>
          </div>
        </div>
        <Link
          to="/r/my-code"
          viewTransition
          className="h-9 px-3.5 flex items-center gap-2 rounded-[10px] border border-r-border-control text-[13px] font-medium text-r-text! no-underline hover:bg-r-bg"
        >
          {createElement(IdcardOutlined, { style: { fontSize: 16 } })}
          Mã của tôi{code ? ` · ${code}` : ''}
        </Link>
        <NotificationBell area="r" variant="resident" />
        <AvatarMenu withCaret />
      </header>
    </div>
  );
}

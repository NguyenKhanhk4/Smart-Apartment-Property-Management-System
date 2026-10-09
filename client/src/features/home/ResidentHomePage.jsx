import { Link } from 'react-router';
import { Skeleton } from 'antd';
import {
  CalendarOutlined,
  PushpinOutlined,
  RightOutlined,
  ToolOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { announcementApi, guestApi, ticketApi } from '../../api/moduleE.api';
import { bookingApi } from '../../api/moduleD.api';
import StatusBadge from '../../components/resident/StatusBadge';
import SurfaceCard from '../../components/resident/SurfaceCard';
import { TICKET_STATUS } from '../../constants/enums';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useResident } from '../../hooks/useResident';
import { dayLabel, formatDate, givenName } from '../../utils/format';
import ResidentAside from './ResidentAside';

// Phản ánh còn dang dở (cư dân đang chờ BQL hoặc cần xác nhận kết quả)
const OPEN_TICKET_STATUS = 'NEW,ASSIGNED,IN_PROGRESS,WAITING_CONFIRM';

const TONE_ICON = {
  info: 'bg-r-info-bg text-r-info-fg',
  warn: 'bg-r-warn-bg text-r-warn-fg',
  ok: 'bg-r-ok-bg text-r-ok-fg',
};

/**
 * Một thẻ trong "Việc của bạn". Mobile: ngang (icon | tiêu đề + phụ đề | chevron hoặc badge).
 * Web: dọc (icon trên, nhãn nhỏ, tiêu đề, phụ đề).
 */
function TodoCard({ to, tone, icon, label, title, subtitle, badge, wide }) {
  const iconBox = `flex items-center justify-center shrink-0 ${TONE_ICON[tone]}`;
  if (wide) {
    return (
      <SurfaceCard as={Link} to={to} viewTransition className="flex flex-col gap-3.5 p-5 text-r-text! no-underline">
        <span className="flex justify-between items-center">
          <span className={`${iconBox} w-11 h-11 rounded-xl text-[22px]`}>{icon}</span>
          {badge}
        </span>
        <span>
          <span className="block text-[13px] text-r-muted">{label}</span>
          <span className="block text-[17px] font-semibold mt-0.5">{title}</span>
          <span className="block text-sm text-r-muted">{subtitle}</span>
        </span>
      </SurfaceCard>
    );
  }
  return (
    <SurfaceCard as={Link} to={to} viewTransition className="flex items-center gap-3.5 px-4 py-3.5 text-r-text! no-underline">
      <span className={`${iconBox} w-10 h-10 rounded-[10px] text-xl`}>{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-medium truncate">{title}</span>
        <span className="block text-[13px] text-r-muted truncate">{subtitle}</span>
      </span>
      {badge ?? <RightOutlined style={{ fontSize: 14, color: '#8A8F99' }} />}
    </SurfaceCard>
  );
}

function NewsRow({ item, last, wide }) {
  return (
    <Link
      to="/r/announcements"
      viewTransition
      className={`flex gap-5 text-r-text! no-underline ${wide ? 'px-6 py-[18px]' : 'px-4 py-3.5 flex-col gap-0'} ${last ? '' : 'border-b border-r-divider'}`}
    >
      <span className="flex-1 min-w-0">
        <span className={`flex items-center gap-1.5 font-medium text-[15px]`}>
          {item.isPinned && <PushpinOutlined style={{ color: '#B8892E', fontSize: 16 }} aria-label="Đã ghim" />}
          <span className="truncate">{item.title}</span>
        </span>
        <span className={`block text-r-muted truncate ${wide ? 'text-sm mt-1' : 'text-[13px] mt-0.5'}`}>{item.content}</span>
      </span>
      <span className={`text-r-subtle whitespace-nowrap ${wide ? 'text-[13px]' : 'text-xs mt-1'}`}>{formatDate(item.createdAt)}</span>
    </Link>
  );
}

// Trang chủ cư dân: "Việc của bạn" (chỉ hiện thẻ nào có dữ liệu) + "Bảng tin mới"; web có thêm cột phải (thẻ cư dân, căn hộ).
// Lối tắt chức năng đã bỏ vì trùng với thanh điều hướng, menu avatar và chuông.
export default function ResidentHomePage() {
  const wide = useMediaQuery('(min-width: 768px)');
  const { user } = useAuth();
  const { apartment, apartmentId } = useResident();
  const enabled = Boolean(apartmentId);

  const booking = useApi(() => bookingApi.mine({ scope: 'upcoming', limit: 1, apartmentId }), [apartmentId], { enabled });
  const tickets = useApi(() => ticketApi.list({ status: OPEN_TICKET_STATUS, limit: 1, sort: '-createdAt' }), []);
  const guests = useApi(() => guestApi.list({ date: new Date().toISOString(), status: 'EXPECTED,CHECKED_IN', limit: 5, sort: 'expectedTime' }), []);
  const news = useApi(() => announcementApi.list({ limit: 3 }), []);

  const nextBooking = booking.data?.[0];
  const ticket = tickets.data?.[0];
  const todayGuests = guests.data ?? [];
  const firstGuest = todayGuests[0];

  const cards = [];
  if (nextBooking) {
    const when = dayLabel(nextBooking.startAt);
    cards.push(
      <TodoCard
        key="booking"
        wide={wide}
        to={`/r/amenities?tab=history${apartmentId ? `&apartmentId=${apartmentId}` : ''}`}
        tone="info"
        icon={<CalendarOutlined />}
        label="Lượt đặt sắp tới"
        title={`${nextBooking.amenity?.name ?? 'Tiện ích'} · ${nextBooking.slotStart}${wide ? '' : ` ${when.toLowerCase()}`}`}
        subtitle={wide ? when : 'Lượt đặt sắp tới'}
      />,
    );
  }
  if (ticket) {
    const status = TICKET_STATUS[ticket.status]?.label ?? ticket.status;
    const more = (tickets.pagination?.total ?? 1) - 1;
    cards.push(
      <TodoCard
        key="ticket"
        wide={wide}
        to={`/r/tickets/${ticket._id}`}
        tone="warn"
        icon={<ToolOutlined />}
        label="Phản ánh"
        title={ticket.title}
        subtitle={`${wide ? `Gửi ${dayjs(ticket.createdAt).format('DD/MM')} · ` : 'Phản ánh · '}${status.toLowerCase()}${more > 0 ? ` · +${more} phản ánh khác` : ''}`}
        badge={<StatusBadge tone="warn">{status}</StatusBadge>}
      />,
    );
  }
  if (firstGuest) {
    const time = dayjs(firstGuest.expectedTime).format('HH:mm');
    const others = todayGuests.length - 1;
    cards.push(
      <TodoCard
        key="guest"
        wide={wide}
        to="/r/guests"
        tone="ok"
        icon={<UserAddOutlined />}
        label="Khách hôm nay"
        title={wide ? `${firstGuest.guestName}${others > 0 ? ` +${others}` : ''}` : `${todayGuests.length} khách đến hôm nay`}
        subtitle={wide ? `Dự kiến ${time}` : `${firstGuest.guestName}${others > 0 ? ` +${others}` : ''} · ${time}`}
      />,
    );
  }

  const newsItems = news.data ?? [];
  const todoLoading = (booking.loading && enabled) || tickets.loading || guests.loading;

  const todo = todoLoading && !cards.length ? (
    <Skeleton active paragraph={{ rows: 2 }} title={false} />
  ) : cards.length > 0 ? (
    <section className="flex flex-col gap-2.5 md:gap-3" aria-labelledby="todo-title">
      <h2 id="todo-title" className="m-0 text-[15px] md:text-[17px] font-semibold">Việc của bạn</h2>
      <div className={wide ? 'grid gap-4 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]' : 'flex flex-col gap-2.5'}>{cards}</div>
    </section>
  ) : null;

  const newsCard = (
    <SurfaceCard as="section" className="overflow-hidden">
      <div className={`flex items-center justify-between border-b border-r-divider ${wide ? 'px-6 py-[18px]' : 'px-4 py-3.5'}`}>
        <h2 className="m-0 text-[15px] md:text-[17px] font-semibold">Bảng tin mới</h2>
        <Link to="/r/announcements" viewTransition className="text-sm font-medium text-r-link no-underline">Xem tất cả</Link>
      </div>
      {news.loading && !newsItems.length ? (
        <div className="p-4"><Skeleton active paragraph={{ rows: 2 }} title={false} /></div>
      ) : newsItems.length ? (
        newsItems.map((n, i) => <NewsRow key={n._id} item={n} wide={wide} last={i === newsItems.length - 1} />)
      ) : (
        <div className="px-4 py-6 text-sm text-r-muted text-center">Chưa có bài đăng</div>
      )}
    </SurfaceCard>
  );

  return (
    <div className="flex flex-col gap-6 md:gap-7">
      {wide && (
        <div>
          <h1 className="m-0 text-[28px] font-semibold">Chào {givenName(user.fullName)}</h1>
          <p className="mt-1 mb-0 text-[15px] text-r-muted">
            {apartment ? `Căn ${apartment.code}${apartment.building?.name ? ` · ${apartment.building.name}` : ''} · ` : ''}
            {dayjs().format('dddd, DD/MM/YYYY').replace(/^./, (c) => c.toUpperCase())}
          </p>
        </div>
      )}

      {wide ? (
        <div className="flex flex-wrap gap-6 items-start">
          <div className="flex-[999_1_560px] min-w-0 flex flex-col gap-6">
            {todo}
            {newsCard}
          </div>
          <ResidentAside />
        </div>
      ) : (
        <>
          {todo}
          {newsCard}
        </>
      )}
    </div>
  );
}

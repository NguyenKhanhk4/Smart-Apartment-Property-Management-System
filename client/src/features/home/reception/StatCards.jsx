import { useNavigate } from 'react-router';
import { CARD, MUTED, TEXT } from './styles';

// 4 thẻ số liệu, bấm vào mở trang tương ứng. Khối chưa tải được hiện "—" kèm chú thích
export default function StatCards({ counts, parts }) {
  const navigate = useNavigate();
  const loading = (...names) => names.some((n) => parts[n].status === 'loading');
  const failed = (...names) => names.some((n) => parts[n].status === 'error');

  const cards = [
    {
      key: 'guests',
      label: 'Khách hôm nay',
      value: counts.guestsToday,
      names: ['guestsAll', 'guestsExpected'],
      sub: counts.guestsPending != null && `${counts.guestsPending} người chưa đến`,
      path: '/app/guests',
    },
    {
      key: 'bookings',
      label: 'Lịch đặt tiện ích hôm nay',
      value: counts.bookingsTotal,
      names: ['bookings'],
      sub: counts.bookingsWaiting != null && `${counts.bookingsWaiting} lượt chờ check-in`,
      subClass: 'text-r-warn-fg',
      path: '/app/booking-schedule',
    },
    {
      key: 'tickets',
      label: 'Phản ánh mới',
      value: counts.ticketsNew,
      names: ['tickets'],
      sub: counts.ticketsOver24 > 0 && `${counts.ticketsOver24} phản ánh quá 24 giờ`,
      subClass: 'text-r-danger-text',
      path: '/app/tickets',
    },
    {
      key: 'vehicles',
      label: 'Yêu cầu gửi xe',
      value: counts.vehiclesPending,
      names: ['vehicles'],
      sub: counts.vehiclesPending != null && 'Chờ duyệt',
      path: '/app/vehicle-requests',
    },
  ];

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
      {cards.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => navigate(c.path, { viewTransition: true })}
          className={`${CARD} p-5 text-left cursor-pointer min-h-[110px] hover:border-r-border-control transition-colors`}
        >
          <div className={`text-sm ${MUTED}`}>{c.label}</div>
          {loading(...c.names) && c.value == null ? (
            <div className="mt-2 h-8 w-16 rounded bg-r-segment/60 dark:bg-[#18263D] animate-pulse" aria-label="Đang tải" />
          ) : (
            <div className={`mt-1 text-[30px] leading-[1.2] font-semibold ${TEXT}`}>{c.value ?? '—'}</div>
          )}
          {failed(...c.names) && c.value == null ? (
            <div className="text-[13px] text-r-danger-text">Không tải được</div>
          ) : (
            c.sub && <div className={`text-[13px] ${c.subClass ?? MUTED}`}>{c.sub}</div>
          )}
        </button>
      ))}
    </div>
  );
}

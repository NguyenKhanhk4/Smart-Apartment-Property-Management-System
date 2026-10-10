import { useNavigate } from 'react-router';
import { Button } from 'antd';
import { PushpinOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { announcementApi } from '../../../api/moduleE.api';
import { useApi } from '../../../hooks/useApi';
import { Block } from './Block';
import { refreshReceptionDashboard, useReceptionDashboard } from './receptionDashboard';
import { DIVIDER, LINK, MUTED, TEXT } from './styles';

const GUEST_ROWS = 4;
const NEWS_ROWS = 3;

// Khách hôm nay chưa check-in, sắp theo giờ. Check-in khách là việc của Bảo vệ (API chỉ cho STAFF:SECURITY)
// nên nút ở đây mở Sổ khách để xem chi tiết, không ghi check-in.
export function UpcomingGuests() {
  const navigate = useNavigate();
  const part = useReceptionDashboard().parts.guestsExpected;
  const guests = (part.data ?? []).slice(0, GUEST_ROWS);
  return (
    <Block
      title="Khách sắp đến"
      loading={part.status === 'loading'}
      error={part.status === 'error' && !part.data ? 'Không tải được danh sách khách.' : null}
      onRetry={() => refreshReceptionDashboard()}
      extra={
        <button type="button" className={LINK} onClick={() => navigate('/app/guests', { viewTransition: true })}>
          Sổ khách
        </button>
      }
    >
      {guests.length === 0 ? (
        <div className={`px-6 pb-6 pt-2 text-sm ${MUTED}`}>Không còn khách nào chưa đến hôm nay</div>
      ) : (
        <ul className="list-none m-0 p-0">
          {guests.map((g) => (
            <li key={g._id} className={`flex items-center gap-3 px-6 py-3 border-t ${DIVIDER}`}>
              <span className={`w-12 shrink-0 font-semibold text-base ${TEXT}`}>{dayjs(g.expectedTime).format('HH:mm')}</span>
              <div className="flex-1 min-w-0">
                <div className={`font-semibold text-[15px] truncate ${TEXT}`}>{g.guestName}</div>
                <div className={`text-[13px] ${MUTED}`}>
                  Đến {g.apartmentId?.code ?? '—'} · {g.numberOfGuests ?? 1} người
                </div>
              </div>
              <Button size="large" onClick={() => navigate('/app/guests', { viewTransition: true })}>
                Xem
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}

// 2–3 tin mới nhất; tin ghim nằm trên cùng
export function LatestNews() {
  const navigate = useNavigate();
  const { data = [], loading, error, reload } = useApi(() => announcementApi.list({ limit: 10 }), []);
  const items = [...data].sort((a, b) => Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned))).slice(0, NEWS_ROWS);
  return (
    <Block
      title="Bảng tin mới"
      loading={loading && !data.length}
      error={error && !data.length ? 'Không tải được bảng tin.' : null}
      onRetry={reload}
      extra={
        <button type="button" className={LINK} onClick={() => navigate('/app/announcements', { viewTransition: true })}>
          Xem tất cả
        </button>
      }
    >
      {items.length === 0 ? (
        <div className={`px-6 pb-6 pt-2 text-sm ${MUTED}`}>Chưa có bài đăng</div>
      ) : (
        <ul className="list-none m-0 p-0">
          {items.map((a) => (
            <li key={a._id} className={`px-6 py-3 border-t ${DIVIDER}`}>
              <div className={`font-semibold text-[15px] ${TEXT}`}>
                {a.isPinned && <PushpinOutlined className="text-r-gold-icon mr-1.5" aria-label="Tin ghim" />}
                {a.title}
              </div>
              <div className={`text-[13px] ${MUTED}`}>{dayjs(a.createdAt).format('DD/MM/YYYY')}</div>
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}

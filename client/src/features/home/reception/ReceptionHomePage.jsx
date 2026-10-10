import { useNavigate } from 'react-router';
import { PlusOutlined, SoundOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useAuth } from '../../../hooks/useAuth';
import LookupCard from './LookupCard';
import { buildTodos } from './todos';
import { selectCounts, useReceptionDashboard } from './receptionDashboard';
import { LatestNews, UpcomingGuests } from './SideBlocks';
import StatCards from './StatCards';
import { MUTED, TEXT } from './styles';
import TodoList from './TodoList';

const WEEKDAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

const greeting = (hour) => (hour < 11 ? 'Chào buổi sáng' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối');

// Trang chủ Lễ tân: tra mã cư dân → số liệu trong ngày → việc cần xử lý + khách sắp đến + bảng tin.
// Dữ liệu từ kho dùng chung với badge sidebar (receptionDashboard.js).
export default function ReceptionHomePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const snap = useReceptionDashboard();
  const counts = selectCounts(snap);
  const waiting = snap.fetchedAt ? buildTodos(snap).length : null;
  const now = dayjs();

  return (
    <div className="max-w-[1240px] mx-auto flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className={`m-0 text-[26px] font-semibold leading-tight ${TEXT}`}>
            {greeting(now.hour())}, {user.fullName}
          </h1>
          <p className={`mt-1 mb-0 text-[15px] ${MUTED}`}>
            {WEEKDAYS[now.day()]}, {now.format('DD/MM/YYYY')}
            {waiting != null && ` · Có ${waiting} việc đang chờ bạn xử lý`}
          </p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => navigate('/app/announcements?new=1', { viewTransition: true })}
            className="h-11 px-5 rounded-[10px] border border-r-border-control bg-white text-r-text font-medium text-sm cursor-pointer inline-flex items-center gap-2 dark:bg-[#18263D] dark:text-[#EEF1F6] dark:border-[#24344D]"
          >
            <SoundOutlined /> Đăng bảng tin
          </button>
          <button
            type="button"
            onClick={() => navigate('/app/guests', { viewTransition: true })}
            className="h-11 px-5 rounded-[10px] border-0 bg-[#1A2440] text-white font-semibold text-sm cursor-pointer inline-flex items-center gap-2"
          >
            <PlusOutlined /> Đăng ký khách
          </button>
        </div>
      </div>

      <LookupCard />
      <StatCards counts={counts} parts={snap.parts} />

      <div className="flex flex-wrap gap-6 items-start">
        <div className="min-w-0" style={{ flex: '999 1 520px' }}>
          <TodoList />
        </div>
        <div className="min-w-0 flex flex-col gap-6" style={{ flex: '1 1 320px' }}>
          <UpcomingGuests />
          <LatestNews />
        </div>
      </div>
    </div>
  );
}

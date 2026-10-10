import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Avatar, Spin } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { memberCodeApi } from '../../../api/moduleD.api';
import { CARD, MUTED, TEXT } from './styles';

const ACTIVE_BOOKING = ['APPROVED', 'CHECKED_IN'];

/** Số ngày còn lại của gói tháng (hết hạn cuối tháng dương lịch) */
const daysLeftInMonth = () => dayjs().endOf('month').diff(dayjs().startOf('day'), 'day');

function Result({ state, onConfirm }) {
  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-3 text-sm text-r-muted" role="status">
        <Spin size="small" /> Đang tra cứu…
      </div>
    );
  }
  if (state.status === 'notfound') return <p className={`m-0 text-sm ${MUTED}`}>Không tìm thấy cư dân với mã này</p>;
  if (state.status === 'error') {
    return (
      <p className="m-0 text-sm text-r-danger-text" role="alert">
        {state.message}
      </p>
    );
  }
  if (state.status !== 'found') {
    return <p className={`m-0 text-sm ${MUTED}`}>Nhập mã cư dân để xem thông tin và đối chiếu ảnh.</p>;
  }

  const d = state.data;
  const passes = (d.passes ?? []).slice(0, 2).map((p) => `Gói ${p.amenityName} còn ${daysLeftInMonth()} ngày`);
  const today = (d.bookingsToday ?? []).filter((b) => b.isMine && ACTIVE_BOOKING.includes(b.status));
  const place = [`Căn ${d.apartment.code}`, d.apartment.building?.name, ...passes].filter(Boolean).join(' · ');

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <Avatar size={64} src={d.person.avatarUrl} icon={<UserOutlined />} alt={d.person.fullName} />
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-lg font-semibold ${TEXT}`}>{d.person.fullName}</span>
          {d.isHead && <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-r-warn-bg text-r-warn-fg">Chủ hộ</span>}
        </div>
        <div className={`text-[13px] ${MUTED}`}>{place}</div>
        {today.length > 0 && (
          <div className="text-[13px] font-medium text-r-ok-fg">
            Có lượt đặt {today[0].amenity?.name} {today[0].slotStart} hôm nay
            {today.length > 1 && ` (+${today.length - 1})`}
          </div>
        )}
      </div>
      {today.length > 0 && (
        <button
          type="button"
          onClick={() => onConfirm(d.code)}
          className="h-11 px-5 rounded-[10px] border border-r-ok-fg bg-white text-r-ok-fg font-medium text-sm cursor-pointer hover:bg-r-ok-bg dark:bg-transparent"
        >
          Xác nhận vào
        </button>
      )}
    </div>
  );
}

// Tra mã cư dân: luôn hiện ảnh để lễ tân đối chiếu. "Xác nhận vào" mở lịch đặt đã lọc theo mã để check-in
// (ghi lượt vào tiện ích là UC-D10, chưa có API).
export default function LookupCard() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [state, setState] = useState({ status: 'idle' });

  const search = async () => {
    const q = text.trim();
    if (!q) return;
    setState({ status: 'loading' });
    try {
      const res = await memberCodeApi.lookup(q);
      setState({ status: 'found', data: res.data });
    } catch (e) {
      setState(e.errorCode === 'MEMBER_CODE_NOT_FOUND' ? { status: 'notfound' } : { status: 'error', message: e.message });
    }
  };

  return (
    <section className={`${CARD} p-6 flex flex-wrap gap-6`} aria-label="Tra cứu mã cư dân">
      <div className="flex-1 basis-[360px] min-w-0">
        <h2 className={`m-0 mb-3 text-lg font-semibold ${TEXT}`}>Tra cứu mã cư dân</h2>
        <form
          className="flex gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value.toUpperCase())}
            placeholder="A-0101"
            aria-label="Mã cư dân"
            autoComplete="off"
            maxLength={40}
            className="flex-1 min-w-0 h-[52px] px-4 rounded-[10px] border border-r-border-control bg-white text-[22px] tracking-wider text-r-text dark:bg-[#18263D] dark:text-[#EEF1F6] dark:border-[#24344D]"
            style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}
          />
          <button
            type="submit"
            disabled={!text.trim() || state.status === 'loading'}
            className="h-[52px] px-6 rounded-[10px] border-0 bg-[#1A2440] text-white font-semibold text-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Tra cứu
          </button>
        </form>
        <p className={`mt-2 mb-0 text-[13px] ${MUTED}`}>
          Cư dân đọc mã trên thẻ &quot;Mã của tôi&quot;. Đối chiếu ảnh trước khi cho vào tiện ích.
        </p>
      </div>
      <div className="flex-1 basis-[360px] min-w-0 rounded-xl p-4 bg-r-bg dark:bg-[#18263D] flex items-center" aria-live="polite">
        <div className="w-full">
          <Result state={state} onConfirm={(code) => navigate(`/app/booking-schedule?q=${encodeURIComponent(code)}`)} />
        </div>
      </div>
    </section>
  );
}

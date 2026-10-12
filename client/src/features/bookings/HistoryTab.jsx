import { useState } from 'react';
import { Link } from 'react-router';
import { App, Empty, Pagination, Popconfirm, Skeleton } from 'antd';
import dayjs from 'dayjs';
import { bookingApi } from '../../api/moduleD.api';
import StatusBadge from '../../components/resident/StatusBadge';
import SurfaceCard from '../../components/resident/SurfaceCard';
import { useApi } from '../../hooks/useApi';
import { useResident } from '../../hooks/useResident';
import { formatMoney } from '../../utils/format';

// Nhãn + màu theo thiết kế: Đã xác nhận = ok, Chờ duyệt = warn, Đã dùng = neutral.
// PENDING / REJECTED chỉ còn ở dữ liệu cũ (BR-O12 đã bỏ luồng duyệt).
const STATUS = {
  APPROVED: { label: 'Đã xác nhận', tone: 'ok' },
  CHECKED_IN: { label: 'Đã check-in', tone: 'info' },
  COMPLETED: { label: 'Đã dùng', tone: 'neutral' },
  CANCELLED: { label: 'Đã hủy', tone: 'neutral' },
  NO_SHOW: { label: 'Không đến', tone: 'warn' },
  PENDING: { label: 'Chờ duyệt', tone: 'warn' },
  REJECTED: { label: 'Từ chối', tone: 'neutral' },
};

const Badge = ({ status }) => <StatusBadge tone={STATUS[status]?.tone}>{STATUS[status]?.label ?? status}</StatusBadge>;
const timeOf = (b) => `${b.slotStart}–${b.slotEnd}`;
const feeOf = (b) => (b.fee > 0 ? formatMoney(b.fee) : b.passId ? 'Gói tháng' : 'Miễn phí');
const startOf = (b) => dayjs(b.startAt ?? b.date);

// Tab "Lịch sử đặt": chủ hộ thấy cả hộ, thành viên thấy lượt mình đặt. Hủy được khi còn trước giờ bắt đầu.
export default function HistoryTab({ wide }) {
  const { message } = App.useApp();
  const { apartmentId } = useResident();
  const [page, setPage] = useState(1);
  const enabled = Boolean(apartmentId);

  const upcoming = useApi(() => bookingApi.mine({ scope: 'upcoming', limit: 50, apartmentId }), [apartmentId], { enabled });
  const past = useApi(() => bookingApi.mine({ scope: 'past', page, limit: 10, apartmentId }), [apartmentId, page], { enabled });

  const upRows = upcoming.data ?? [];
  const pastRows = past.data ?? [];
  const reload = () => Promise.all([upcoming.reload(), past.reload()]);

  const cancel = async (b) => {
    try {
      await bookingApi.cancel(b._id);
      message.success('Đã hủy booking, không mất phí');
    } catch (e) {
      message.error(e.message);
    }
    reload();
  };

  const rebookTo = (b) => `/r/amenities/${b.amenityId}${apartmentId ? `?apartmentId=${apartmentId}` : ''}`;

  const cancelButton = (b) =>
    b.canCancel && (
      <Popconfirm
        title="Hủy booking này?"
        description="Hủy trước giờ bắt đầu thì không mất phí."
        okText="Hủy booking"
        cancelText="Giữ lại"
        okButtonProps={{ danger: true }}
        onConfirm={() => cancel(b)}
      >
        <button type="button" className="p-0 border-0 bg-transparent text-sm font-medium text-r-link cursor-pointer">Hủy</button>
      </Popconfirm>
    );

  if ((upcoming.loading || past.loading) && !upRows.length && !pastRows.length) return <Skeleton active paragraph={{ rows: 4 }} />;
  if (!upRows.length && !pastRows.length) return <Empty description="Chưa có lượt đặt nào" />;

  const pager = past.pagination?.total > past.pagination?.limit && (
    <Pagination align="center" current={page} pageSize={past.pagination.limit} total={past.pagination.total} onChange={setPage} showSizeChanger={false} />
  );

  if (wide) {
    const th = 'py-3.5 px-4 font-medium border-b border-r-divider first:pl-6 last:pr-6';
    const row = (b, muted) => {
      const td = `py-4 px-4 first:pl-6 last:pr-6 ${muted ? 'text-r-muted' : ''}`;
      return (
        <tr key={b._id} className="border-b border-r-divider last:border-b-0">
          <td className={`${td} font-medium`}>
            {b.amenity?.name ?? 'Tiện ích'}
            {!b.isMine && b.bookedBy?.fullName && <span className="block text-xs font-normal text-r-subtle">Đặt bởi {b.bookedBy.fullName}</span>}
          </td>
          <td className={td}>{startOf(b).format('DD/MM/YYYY')}</td>
          <td className={td}>{timeOf(b)}</td>
          <td className={td}>{feeOf(b)}</td>
          <td className={td}><Badge status={b.status} /></td>
          <td className={`${td} text-right`}>
            {cancelButton(b) || (muted && (
              <Link to={rebookTo(b)} viewTransition className="text-sm font-medium text-r-link no-underline">Đặt lại</Link>
            ))}
          </td>
        </tr>
      );
    };
    return (
      <div className="flex flex-col gap-4">
        <SurfaceCard className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-r-muted text-[13px]">
                <th className={th}>Tiện ích</th>
                <th className={th}>Ngày</th>
                <th className={th}>Giờ</th>
                <th className={th}>Phí</th>
                <th className={th}>Trạng thái</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {upRows.map((b) => row(b, false))}
              {pastRows.map((b) => row(b, true))}
            </tbody>
          </table>
        </SurfaceCard>
        {pager}
      </div>
    );
  }

  const mobileRow = (b, muted) => {
    const d = startOf(b);
    return (
      <SurfaceCard key={b._id} className="flex items-center gap-3.5 px-4 py-3.5">
        <div className={`w-12 text-center shrink-0 ${muted ? 'text-r-muted' : ''}`}>
          <div className="text-lg font-semibold">{d.format('DD')}</div>
          <div className="text-xs text-r-muted">Th{d.format('MM')}</div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-medium truncate">{b.amenity?.name ?? 'Tiện ích'}</div>
          <div className="text-[13px] text-r-muted">
            {timeOf(b)} · {feeOf(b)}
          </div>
          {!b.isMine && b.bookedBy?.fullName && <div className="text-xs text-r-subtle truncate">Đặt bởi {b.bookedBy.fullName}</div>}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {muted && b.status === 'COMPLETED' ? null : <Badge status={b.status} />}
          {cancelButton(b)}
          {muted && (
            <Link to={rebookTo(b)} viewTransition className="text-sm font-medium text-r-link no-underline py-1">Đặt lại</Link>
          )}
        </div>
      </SurfaceCard>
    );
  };

  return (
    <div className="flex flex-col gap-2.5">
      {upRows.length > 0 && <div className="text-[13px] font-medium text-r-muted">Sắp tới</div>}
      {upRows.map((b) => mobileRow(b, false))}
      {pastRows.length > 0 && <div className={`text-[13px] font-medium text-r-muted ${upRows.length ? 'mt-2' : ''}`}>Đã qua</div>}
      {pastRows.map((b) => mobileRow(b, true))}
      {pager}
    </div>
  );
}

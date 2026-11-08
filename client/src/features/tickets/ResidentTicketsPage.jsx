import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, Pagination, Skeleton } from 'antd';
import { CheckCircleOutlined, PlusOutlined, RightOutlined, SendOutlined, ToolOutlined, UserOutlined } from '@ant-design/icons';
import { ticketApi } from '../../api/moduleE.api';
import { useApi } from '../../hooks/useApi';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import EnumTag from '../../components/EnumTag';
import SegmentedTabs from '../../components/resident/SegmentedTabs';
import SurfaceCard from '../../components/resident/SurfaceCard';
import ResidentPageTitle from '../../components/resident/ResidentPageTitle';
import { PRIORITIES, TICKET_FINAL_STATUSES, TICKET_OPEN_STATUSES, TICKET_STATUS, TICKET_TYPES } from '../../constants/enums';
import { formatDateTime, fromNow } from '../../utils/format';
import TicketCreateModal from './TicketCreateModal';

const TABS = [
  { value: 'open', label: 'Đang xử lý', status: TICKET_OPEN_STATUSES.join(',') },
  { value: 'confirm', label: 'Chờ nghiệm thu', status: 'WAITING_CONFIRM' },
  { value: 'done', label: 'Đã đóng', status: TICKET_FINAL_STATUSES.join(',') },
];

// Các bước xử lý một phản ánh (cột phải trên máy tính)
const STEPS = [
  { icon: <SendOutlined />, title: 'Bạn gửi phản ánh', desc: 'Kèm ảnh, mô tả vị trí' },
  { icon: <UserOutlined />, title: 'Ban quản lý tiếp nhận', desc: 'Phân loại, giao kỹ thuật viên' },
  { icon: <ToolOutlined />, title: 'Kỹ thuật viên xử lý', desc: 'Theo hạn xử lý (SLA)' },
  { icon: <CheckCircleOutlined />, title: 'Bạn nghiệm thu', desc: 'Tự đóng sau 3 ngày nếu không phản hồi' },
];

/** Số phản ánh của một tab (gọi limit 1 chỉ để lấy tổng) */
function useCount(status, reloadKey) {
  const { pagination } = useApi(() => ticketApi.list({ status, page: 1, limit: 1 }), [status, reloadKey]);
  return pagination?.total;
}

// UC-E02, E05 — Cư dân xem phản ánh của căn hộ mình, tạo mới, vào chi tiết để xác nhận / đánh giá.
// Máy tính: danh sách dạng bảng + cột phải quy trình xử lý. Điện thoại: thẻ xếp dọc.
export default function ResidentTicketsPage() {
  const navigate = useNavigate();
  const wide = useMediaQuery('(min-width: 900px)');
  const [tab, setTab] = useState('open');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const status = TABS.find((t) => t.value === tab).status;
  const { data = [], pagination, loading, reload } = useApi(() => ticketApi.list({ status, page, limit: 10 }), [status, page, reloadKey]);
  const counts = {
    open: useCount(TABS[0].status, reloadKey),
    confirm: useCount(TABS[1].status, reloadKey),
    done: useCount(TABS[2].status, reloadKey),
  };
  const tabs = TABS.map((t) => ({ ...t, label: counts[t.value] ? `${t.label} (${counts[t.value]})` : t.label }));

  const list = loading && !data.length ? (
    <SurfaceCard className="p-5">
      <Skeleton active paragraph={{ rows: 3 }} title={false} />
    </SurfaceCard>
  ) : !data.length ? (
    <SurfaceCard className="py-14 px-6 flex flex-col items-center text-center gap-3">
      <span className="w-14 h-14 rounded-2xl bg-r-ok-bg text-r-navy flex items-center justify-center text-2xl">
        <ToolOutlined />
      </span>
      <div>
        <div className="text-[14px] font-semibold">
          {tab === 'open' ? 'Không có phản ánh nào đang xử lý' : tab === 'confirm' ? 'Không có phản ánh chờ nghiệm thu' : 'Chưa có phản ánh đã đóng'}
        </div>
        <div className="mt-1 text-[13px] text-r-muted">Gặp sự cố trong căn hộ hoặc khu chung? Gửi phản ánh để Ban quản lý xử lý.</div>
      </div>
      {tab === 'open' && (
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
          Gửi phản ánh
        </Button>
      )}
    </SurfaceCard>
  ) : wide ? (
    <SurfaceCard className="overflow-hidden">
      <div className="grid grid-cols-[minmax(0,1fr)_150px_110px_150px_130px_24px] gap-4 px-5 py-3 bg-r-bg text-[12.5px] font-medium text-r-muted border-b border-r-divider">
        <span>Phản ánh</span>
        <span>Loại</span>
        <span>Mức độ</span>
        <span>Trạng thái</span>
        <span>Gửi lúc</span>
        <span />
      </div>
      {data.map((t) => (
        <Link
          key={t._id}
          to={`/r/tickets/${t._id}`}
          viewTransition
          className="grid grid-cols-[minmax(0,1fr)_150px_110px_150px_130px_24px] gap-4 items-center px-5 py-3.5 border-b border-r-divider last:border-b-0 no-underline text-r-text! hover:bg-r-bg transition-colors"
        >
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold truncate">{t.title}</span>
            <span className="block text-[12.5px] text-r-muted truncate">
              {t.code}
              {t.category?.name ? ` · ${t.category.name}` : ''}
            </span>
          </span>
          <span><EnumTag map={TICKET_TYPES} value={t.type} /></span>
          <span><EnumTag map={PRIORITIES} value={t.priority} /></span>
          <span><EnumTag map={TICKET_STATUS} value={t.status} /></span>
          <span className="text-[12.5px] text-r-muted" title={formatDateTime(t.createdAt)}>{fromNow(t.createdAt)}</span>
          <RightOutlined className="text-r-subtle" />
        </Link>
      ))}
    </SurfaceCard>
  ) : (
    <div className="flex flex-col gap-2.5">
      {data.map((t) => (
        <SurfaceCard key={t._id} as={Link} to={`/r/tickets/${t._id}`} viewTransition className="flex items-center gap-3 px-4 py-3.5 no-underline text-r-text!">
          <span className="flex-1 min-w-0 flex flex-col gap-1.5">
            <span className="text-[14.5px] font-semibold truncate">{t.title}</span>
            <span className="text-[12.5px] text-r-muted">
              {t.code} · {fromNow(t.createdAt)}
            </span>
            <span className="flex flex-wrap gap-1.5">
              <EnumTag map={TICKET_STATUS} value={t.status} />
              <EnumTag map={PRIORITIES} value={t.priority} />
            </span>
          </span>
          <RightOutlined className="text-r-subtle" />
        </SurfaceCard>
      ))}
    </div>
  );

  return (
    <div>
      <ResidentPageTitle
        title="Phản ánh"
        subtitle="Báo sự cố trong căn hộ hoặc khu vực chung, theo dõi tiến độ và nghiệm thu kết quả."
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            Gửi phản ánh
          </Button>
        }
      />

      <div className="grid gap-6 items-start xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 flex flex-col gap-4">
          <SegmentedTabs
            label="Lọc phản ánh"
            options={tabs}
            value={tab}
            onChange={(v) => {
              setTab(v);
              setPage(1);
            }}
            className={wide ? 'w-fit min-w-[480px]' : ''}
          />
          {list}
          {pagination?.total > pagination?.limit && (
            <Pagination align="center" current={page} pageSize={pagination.limit} total={pagination.total} onChange={setPage} />
          )}
        </div>

        <SurfaceCard as="aside" className="hidden xl:flex flex-col gap-4 p-5 sticky top-[84px]">
          <div className="text-[14.5px] font-semibold">Quy trình xử lý</div>
          <ol className="list-none m-0 p-0 flex flex-col">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative flex gap-3 pb-4 last:pb-0">
                {i < STEPS.length - 1 && <span className="absolute left-[15px] top-8 bottom-0 w-px bg-r-border" aria-hidden />}
                <span className="w-8 h-8 shrink-0 rounded-full bg-r-ok-bg text-r-navy flex items-center justify-center text-sm">{s.icon}</span>
                <span className="pt-1">
                  <span className="block text-[13.5px] font-medium">{s.title}</span>
                  <span className="block text-[12.5px] text-r-muted">{s.desc}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="rounded-xl bg-r-warn-bg text-r-warn-fg text-[12.5px] px-3 py-2.5 leading-relaxed">
            Sự cố khẩn cấp (cháy, rò điện, ngập nước)? Gọi ngay hotline lễ tân để được hỗ trợ tức thì.
          </div>
        </SurfaceCard>
      </div>

      <TicketCreateModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(t) => {
          setCreating(false);
          setReloadKey((k) => k + 1);
          if (tab === 'open') reload();
          else setTab('open');
          navigate(`/r/tickets/${t._id}`);
        }}
      />
    </div>
  );
}

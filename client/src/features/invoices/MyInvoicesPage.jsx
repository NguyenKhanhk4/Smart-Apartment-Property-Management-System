import { useState } from 'react';
import { Link } from 'react-router';
import { Empty, Pagination, Select, Skeleton } from 'antd';
import { RightOutlined } from '@ant-design/icons';
import { invoiceApi } from '../../api/moduleB.api';
import PageHeader from '../../components/PageHeader';
import SegmentedTabs from '../../components/resident/SegmentedTabs';
import StatusBadge from '../../components/resident/StatusBadge';
import SurfaceCard from '../../components/resident/SurfaceCard';
import { INVOICE_STATUS } from '../../constants/enums';
import { useApi } from '../../hooks/useApi';
import { useResident } from '../../hooks/useResident';
import { formatDate, formatMoney } from '../../utils/format';
import PayosButton from '../payments/PayosButton';
import { INVOICE_TONE, OUTSTANDING_STATUSES, outstandingOf, periodLabel } from './invoiceShared';

// Mô đun 4 — UC28: cư dân xem thông báo phí của căn đang chọn (chỉ thông báo đã phát hành).
// X1: Người nộp phí thấy tổng nợ + Số dư trả trước; thành viên khác chỉ xem các kỳ từ khi chuyển vào.
const FILTERS = [
  { value: 'unpaid', label: 'Cần thanh toán', status: OUTSTANDING_STATUSES.join(',') },
  { value: 'all', label: 'Tất cả', status: undefined },
];
const PAGE_SIZE = 10;

function SummaryTile({ label, value, tone }) {
  return (
    <SurfaceCard className="px-4 py-3.5 flex-1 min-w-[140px]">
      <span className="block text-[13px] text-r-muted">{label}</span>
      <span className={`block text-lg font-semibold ${tone === 'warn' ? 'text-r-warn-fg' : 'text-r-text'}`}>{value}</span>
    </SurfaceCard>
  );
}

export default function MyInvoicesPage() {
  const { apartmentId: selectedApartmentId } = useResident();
  const { data: formerApartments = [], loading: loadingFormer } = useApi(invoiceApi.departedTenancies, []);
  const [selectedFormerId, setSelectedFormerId] = useState(null);
  const currentApartmentId = formerApartments.some((apartment) => apartment._id === selectedApartmentId)
    ? null : selectedApartmentId;
  const formerId = formerApartments.find((apartment) => apartment._id === selectedFormerId)?._id
    ?? (currentApartmentId ? null : formerApartments[0]?._id);
  const apartmentId = formerId ?? currentApartmentId;
  const [filter, setFilter] = useState('unpaid');
  const [page, setPage] = useState(1);
  const status = FILTERS.find((f) => f.value === filter).status;

  const res = useApi(() => invoiceApi.my({ apartmentId, status, page, limit: PAGE_SIZE }), [apartmentId, status, page], {
    enabled: Boolean(apartmentId),
  });
  const items = res.data ?? [];
  const summary = res.raw?.summary;
  // Các kỳ còn nợ mà mình là Người nộp phí (trên trang đang xem) → thanh toán gộp 1 lần qua payOS
  const payable = filter === 'unpaid' ? items.filter((i) => i.isPayer && OUTSTANDING_STATUSES.includes(i.status) && outstandingOf(i) > 0) : [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader className="mb-0" title="Phí dịch vụ" subtitle="Thông báo phí hằng tháng của căn hộ đang chọn" />

      {formerApartments.length > 0 && (
        <Select aria-label="Căn hộ xem phí dịch vụ" className="w-full max-w-md" value={formerId ?? 'current'}
          options={[
            ...(currentApartmentId ? [{ value: 'current', label: 'Căn hộ đang ở' }] : []),
            ...formerApartments.map((apartment) => ({
              value: apartment._id,
              label: `${apartment.code}${apartment.buildingId?.name ? ` · ${apartment.buildingId.name}` : ''} — Đã rời, còn nợ`,
            })),
          ]}
          onChange={(value) => { setSelectedFormerId(value === 'current' ? null : value); setPage(1); }} />
      )}

      {summary?.isPayer && (
        <div className="flex gap-3 flex-wrap">
          <SummaryTile label="Đang nợ" value={formatMoney(summary.outstanding)} tone={summary.outstanding ? 'warn' : undefined} />
          {summary.overdue > 0 && <SummaryTile label="Trong đó quá hạn" value={formatMoney(summary.overdue)} tone="warn" />}
          <SummaryTile label="Số dư trả trước" value={formatMoney(summary.prepaidBalance)} />
        </div>
      )}
      {payable.length > 0 && (
        <PayosButton invoiceIds={payable.map((i) => i._id)} amount={payable.reduce((s, i) => s + outstandingOf(i), 0)}>
          Thanh toán online {payable.length} kỳ · {formatMoney(payable.reduce((s, i) => s + outstandingOf(i), 0))}
        </PayosButton>
      )}

      <SegmentedTabs
        label="Lọc thông báo phí"
        options={FILTERS}
        value={filter}
        onChange={(v) => (setFilter(v), setPage(1))}
        className="max-w-sm"
      />

      {(res.loading || (loadingFormer && !apartmentId)) && !items.length ? (
        <Skeleton active />
      ) : items.length === 0 ? (
        <SurfaceCard className="py-10">
          <Empty description={filter === 'unpaid' ? 'Không có khoản phí cần thanh toán' : 'Chưa có thông báo phí'} />
        </SurfaceCard>
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((inv) => {
            const due = OUTSTANDING_STATUSES.includes(inv.status);
            return (
              <SurfaceCard
                key={inv._id}
                as={Link}
                to={`/r/invoices/${inv._id}`}
                viewTransition
                className="flex items-center gap-3.5 px-4 py-3.5 text-r-text! no-underline"
              >
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-[14px] font-semibold">Tháng {periodLabel(inv.period)}</span>
                    <StatusBadge tone={INVOICE_TONE[inv.status]}>{INVOICE_STATUS[inv.status]?.label}</StatusBadge>
                  </span>
                  <span className="block text-[13px] text-r-muted truncate">
                    {inv.code} · Hạn {formatDate(inv.dueDate)}
                  </span>
                </span>
                <span className="text-right shrink-0">
                  <span className="block text-[14px] font-semibold">{formatMoney(due ? outstandingOf(inv) : inv.totalAmount)}</span>
                  <span className="block text-[12px] text-r-muted">{due ? 'còn phải trả' : 'tổng tiền'}</span>
                </span>
                <RightOutlined className="text-r-muted" />
              </SurfaceCard>
            );
          })}
          {(res.pagination?.total ?? 0) > PAGE_SIZE && (
            <Pagination
              className="self-center"
              current={page}
              pageSize={PAGE_SIZE}
              total={res.pagination.total}
              onChange={setPage}
              showSizeChanger={false}
            />
          )}
        </div>
      )}
    </div>
  );
}

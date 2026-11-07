import { useMemo, useState } from 'react';
import { Alert, Button, Card, DatePicker, Descriptions, Drawer, Flex, Input, Select, Table, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { auditLogApi } from '../../api/moduleC.api';
import PageHeader from '../../components/PageHeader';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { formatDateTime, formatMoney } from '../../utils/format';

const DETAIL_LABELS = {
  amount: 'Số tiền', balanceBefore: 'Số dư trước giao dịch', balanceAfter: 'Số dư sau giao dịch',
  fundId: 'Mã quỹ', transactionId: 'Mã giao dịch', proposalId: 'Mã đề xuất', source: 'Nguồn thu',
  description: 'Nội dung', occurredAt: 'Thời điểm thu/chi', period: 'Kỳ', receiptNo: 'Số phiếu thu',
  invoiceId: 'Mã thông báo phí', invoiceIds: 'Các thông báo phí', totalAmount: 'Tổng tiền',
  paidAmount: 'Đã thanh toán', method: 'Phương thức', before: 'Trước thay đổi', after: 'Sau thay đổi',
  key: 'Tham số', value: 'Giá trị', reason: 'Lý do', oldValue: 'Giá trị cũ', newValue: 'Giá trị mới',
  count: 'Số lượng', decision: 'Quyết định', status: 'Trạng thái', fromStatus: 'Trạng thái trước', toStatus: 'Trạng thái sau',
};

function AuditMetadata({ metadata }) {
  const items = Object.entries(metadata ?? {}).map(([key, value]) => {
    let content = value == null ? '—' : String(value);
    if (['amount', 'balanceBefore', 'balanceAfter', 'totalAmount', 'paidAmount'].includes(key) && typeof value === 'number') {
      content = formatMoney(value);
    } else if (key === 'occurredAt' && value) {
      content = formatDateTime(value);
    } else if (value && typeof value === 'object') {
      content = <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13, margin: 0 }}>{JSON.stringify(value, null, 2)}</pre>;
    }
    return { key, label: DETAIL_LABELS[key] ?? key, children: content };
  });
  return items.length ? <Descriptions bordered size="small" column={1} items={items} /> : <Typography.Text type="secondary">Không có nội dung bổ sung.</Typography.Text>;
}

export default function AuditLogsPage() {
  const { hasRole } = useAuth();
  const [filters, setFilters] = useState({});
  const [name, setName] = useState('');
  const q = useDebouncedValue(name, 350);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [selected, setSelected] = useState(null);
  const options = useApi(() => auditLogApi.options(), []);
  const params = useMemo(() => ({ ...filters, q: q || undefined, page, limit }), [filters, q, page, limit]);
  const list = useApi(() => auditLogApi.list(params), [params]);
  const change = (key, value) => {
    setFilters((old) => ({ ...old, [key]: value || undefined }));
    setPage(1);
  };

  const columns = [
    { title: 'Thời điểm', dataIndex: 'createdAt', width: 165, render: formatDateTime },
    { title: 'Người thực hiện', width: 180, render: (_, r) => r.performedBy?.fullName ?? 'Hệ thống' },
    { title: 'Hành động', dataIndex: 'actionLabel', width: 240 },
    { title: 'Đối tượng', dataIndex: 'targetType', render: (v, r) => <Tag>{r.targetLabel ?? v ?? '—'}</Tag> },
    { title: 'Mã bản ghi', dataIndex: 'targetId', width: 220, render: (v) => v ? <Typography.Text copyable={{ text: v }} title={v}>{v.slice(0, 8)}…</Typography.Text> : '—' },
    { title: '', width: 80, render: (_, r) => <Button type="link" onClick={() => setSelected(r)} aria-label={`Xem nhật ký ${r.actionLabel}`}>Xem</Button> },
  ];

  return (
    <Flex vertical gap={16}>
      <PageHeader title="Nhật ký hoạt động" subtitle="Lịch sử thao tác được lưu theo thời gian, chỉ dùng để tra cứu."
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Nhật ký hoạt động' }]}
        extra={<Button icon={<ReloadOutlined />} onClick={list.reload} loading={list.loading}>Làm mới</Button>} />
      {hasRole('BOARD') ? <Alert type="info" showIcon title="Ban quản trị chỉ xem nhật ký tài chính. Thông tin nhạy cảm được ẩn." /> : null}
      <Card size="small">
        <Flex wrap gap={12}>
          <DatePicker.RangePicker aria-label="Khoảng ngày nhật ký" format="DD/MM/YYYY" style={{ maxWidth: '100%' }}
            onChange={(v) => {
              setFilters((old) => ({ ...old, from: v?.[0].format('YYYY-MM-DD'), to: v?.[1].format('YYYY-MM-DD') }));
              setPage(1);
            }} />
          <Select allowClear showSearch optionFilterProp="label" aria-label="Lọc hành động" placeholder="Tất cả hành động"
            style={{ width: 260, maxWidth: '100%' }} value={filters.action} options={options.data?.actions}
            loading={options.loading} onChange={(v) => change('action', v)} />
          <Select allowClear showSearch optionFilterProp="label" aria-label="Lọc đối tượng" placeholder="Tất cả đối tượng"
            style={{ width: 220, maxWidth: '100%' }} value={filters.targetType} options={options.data?.targets}
            onChange={(v) => change('targetType', v)} />
          <Input allowClear aria-label="Tên người thực hiện" placeholder="Tìm tên người thực hiện"
            style={{ width: 240, maxWidth: '100%' }} value={name} onChange={(e) => { setName(e.target.value); setPage(1); }} />
        </Flex>
      </Card>
      {list.error || options.error ? (
        <Alert type="error" showIcon title={list.error?.message ?? options.error?.message}
          action={<Button onClick={() => { list.reload(); options.reload(); }}>Thử lại</Button>} />
      ) : null}
      <Card size="small" title="Lịch sử hoạt động">
        <Table rowKey="_id" dataSource={list.data ?? []} columns={columns} loading={list.loading} scroll={{ x: 1100 }}
          locale={{ emptyText: 'Chưa có nhật ký phù hợp với bộ lọc' }}
          pagination={{ current: page, pageSize: limit, total: list.pagination?.total ?? 0, showSizeChanger: true,
            showTotal: (total) => `${total} nhật ký`,
            onChange: (next, size) => { setPage(size === limit ? next : 1); setLimit(size); } }} />
      </Card>
      <Drawer title="Chi tiết nhật ký" open={Boolean(selected)} onClose={() => setSelected(null)} size="large">
        {selected ? (
          <Flex vertical gap={20}>
            <Descriptions bordered size="small" column={1} items={[
              { key: 'time', label: 'Thời điểm', children: formatDateTime(selected.createdAt) },
              { key: 'user', label: 'Người thực hiện', children: selected.performedBy?.fullName ?? 'Hệ thống' },
              { key: 'action', label: 'Hành động', children: selected.actionLabel },
              { key: 'target', label: 'Đối tượng', children: selected.targetLabel ?? selected.targetType ?? '—' },
              { key: 'id', label: 'Mã bản ghi', children: selected.targetId ?? '—' },
              ...(hasRole('MANAGER') ? [{ key: 'ip', label: 'Địa chỉ IP', children: selected.ip ?? '—' }] : []),
            ]} />
            <div>
              <Typography.Title level={5}>Nội dung thay đổi</Typography.Title>
              <AuditMetadata metadata={selected.metadata} />
            </div>
          </Flex>
        ) : null}
      </Drawer>
    </Flex>
  );
}

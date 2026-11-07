import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Card, DatePicker, Flex, Input, Select, Statistic, Table, Typography } from 'antd';
import { paymentApi } from '../../api/moduleB.api';
import EnumTag from '../../components/EnumTag';
import PageHeader from '../../components/PageHeader';
import { PAYMENT_METHODS } from '../../constants/enums';
import { useApi } from '../../hooks/useApi';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { formatDateTime, formatMoney } from '../../utils/format';

// Mô đun 4 — danh sách giao dịch thu (tiền mặt, chuyển khoản, payOS). Bấm dòng → biên lai.
const PAYMENT_STATUS = {
  SUCCESS: { label: 'Thành công', color: 'green' },
  PENDING: { label: 'Chờ kết quả', color: 'gold' },
  FAILED: { label: 'Thất bại', color: 'red' },
};

export default function PaymentListPage() {
  const navigate = useNavigate();
  const [method, setMethod] = useState([]);
  const [status, setStatus] = useState('SUCCESS');
  const [range, setRange] = useState(null);
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 400);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const params = useMemo(
    () => ({
      page,
      limit: pageSize,
      // 'RECONCILE' = payOS quá 15 phút chưa rõ kết quả hoặc lệch số tiền → Kế toán đối soát với sao kê
      status: status === 'RECONCILE' ? undefined : status,
      needsReconcile: status === 'RECONCILE' ? true : undefined,
      method: method.length ? method.join(',') : undefined,
      from: range?.[0]?.startOf('day').toISOString(),
      to: range?.[1]?.endOf('day').toISOString(),
      q: debouncedQ || undefined,
    }),
    [page, pageSize, status, method, range, debouncedQ],
  );
  const list = useApi(() => paymentApi.list(params), [params]);
  const totals = list.raw?.totals;
  const reset = (fn) => (v) => (fn(v), setPage(1));

  const columns = [
    { title: 'Thời điểm', dataIndex: 'paidAt', width: 150, render: formatDateTime },
    { title: 'Số phiếu / mã GD', width: 200, render: (_, p) => <Typography.Text code>{p.receiptNo || p.reference || p.bankRef || '—'}</Typography.Text> },
    {
      title: 'Căn hộ',
      width: 100,
      render: (_, p) => <b>{[p.apartmentId?.buildingId?.code, p.apartmentId?.code].filter(Boolean).join('-') || '—'}</b>,
    },
    { title: 'Người nộp', render: (_, p) => p.payerId?.fullName ?? '—' },
    { title: 'Hình thức', dataIndex: 'method', width: 150, render: (m) => <EnumTag map={PAYMENT_METHODS} value={m} /> },
    { title: 'Số tiền', dataIndex: 'amount', width: 140, align: 'right', render: (v) => <b>{formatMoney(v)}</b> },
    {
      title: 'Vào số dư',
      dataIndex: 'creditAmount',
      width: 120,
      align: 'right',
      render: (v) => (v ? formatMoney(v) : '—'),
    },
    { title: 'Người thu', width: 160, render: (_, p) => p.confirmedBy?.fullName ?? (p.method === 'PAYOS' ? 'payOS' : '—') },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 150,
      render: (s, p) => (
        <Flex vertical gap={2}>
          <span>
            <EnumTag map={PAYMENT_STATUS} value={s} />
          </span>
          {p.needsReconcile && <Typography.Text type="warning">Cần đối soát</Typography.Text>}
        </Flex>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Giao dịch thu"
        subtitle="Tiền mặt, chuyển khoản và payOS. Ghi nhận thu tiền từ trang chi tiết thông báo phí."
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Giao dịch thu' }]}
      />
      <Card>
        <Flex vertical gap={12}>
          <Flex gap={8} wrap>
            <DatePicker.RangePicker format="DD/MM/YYYY" value={range} onChange={reset(setRange)} />
            <Select
              mode="multiple"
              allowClear
              placeholder="Mọi hình thức"
              style={{ minWidth: 220 }}
              value={method}
              onChange={reset(setMethod)}
              options={Object.entries(PAYMENT_METHODS).map(([value, m]) => ({ value, label: m.label }))}
            />
            <Select
              style={{ width: 150 }}
              value={status}
              onChange={reset(setStatus)}
              options={[
                ...Object.entries(PAYMENT_STATUS).map(([value, m]) => ({ value, label: m.label })),
                { value: 'RECONCILE', label: 'Cần đối soát' },
              ]}
            />
            <Input.Search
              allowClear
              placeholder="Số phiếu thu / mã giao dịch"
              style={{ width: 260 }}
              value={q}
              onChange={(e) => (setQ(e.target.value), setPage(1))}
            />
          </Flex>
          {totals && (
            <Flex gap={32} wrap>
              <Statistic title="Số giao dịch" value={totals.count} />
              <Statistic title="Tổng tiền" value={formatMoney(totals.amount)} />
              <Statistic title="Vào Số dư trả trước" value={formatMoney(totals.credit)} />
            </Flex>
          )}
          <Table
            rowKey="_id"
            size="middle"
            loading={list.loading}
            dataSource={list.data ?? []}
            columns={columns}
            scroll={{ x: 1200 }}
            onRow={(p) => ({ onClick: () => navigate(`/app/payments/${p._id}/receipt`), style: { cursor: 'pointer' } })}
            pagination={{
              current: page,
              pageSize,
              total: list.pagination?.total ?? 0,
              showSizeChanger: true,
              showTotal: (t) => `${t} giao dịch`,
              onChange: (p, s) => (setPage(p), setPageSize(s)),
            }}
          />
        </Flex>
      </Card>
    </>
  );
}

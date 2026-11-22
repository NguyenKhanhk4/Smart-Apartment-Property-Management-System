import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import dayjs from 'dayjs';
import { Alert, Button, Card, DatePicker, Flex, Input, Popconfirm, Segmented, Select, Table, Typography } from 'antd';
import { BankOutlined, CheckOutlined } from '@ant-design/icons';
import { invoiceApi } from '../../api/moduleB.api';
import { lookupApi } from '../../api/moduleE.api';
import EnumTag from '../../components/EnumTag';
import PageHeader from '../../components/PageHeader';
import { INVOICE_STATUS, PAYER_SOURCES } from '../../constants/enums';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { formatDate, formatMoney } from '../../utils/format';
import AdjustmentsPanel from './AdjustmentsPanel';
import { aptLabel, OUTSTANDING_STATUSES, outstandingOf, periodLabel } from './invoiceShared';

// Mô đun 4 — UC27/UC28: danh sách thông báo phí theo kỳ. Kế toán rà soát Nháp và phát hành trực tiếp.
const TABS = ['ALL', 'DRAFT', 'UNPAID', 'PARTIALLY_PAID', 'OVERDUE', 'PAID', 'CANCELLED'];

export default function InvoiceListPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const { hasRole } = useAuth();
  const isAccountant = hasRole('ACCOUNTANT');
  const isManager = hasRole('MANAGER');

  const status = TABS.includes(search.get('status')) ? search.get('status') : 'ALL';
  const [month, setMonth] = useState(() => (search.get('period') ? dayjs(search.get('period')) : null));
  const [buildingId, setBuildingId] = useState();
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 400);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState([]);
  const period = month?.format('YYYY-MM');

  const { data: buildings = [] } = useApi(() => lookupApi.buildings(), []);
  const params = useMemo(
    () => ({
      page,
      limit: pageSize,
      period,
      buildingId,
      q: debouncedQ || undefined,
      status: status === 'ALL' ? undefined : status,
    }),
    [page, pageSize, period, buildingId, debouncedQ, status],
  );
  const list = useApi(() => invoiceApi.list(params), [params]);
  const byStatus = list.raw?.byStatus;
  const items = list.data ?? [];

  const setStatus = (s) => {
    const next = new URLSearchParams(search);
    if (s === 'ALL') next.delete('status');
    else next.set('status', s);
    setSearch(next, { replace: true });
    setPage(1);
    setSelected([]);
  };

  const afterAction = () => {
    setSelected([]);
    return list.reload();
  };
  // Có chọn dòng → xử lý các dòng đã chọn; không chọn → cả kỳ đang lọc (và chỉ tòa đang lọc, nếu có)
  const buildingName = buildings.find((b) => b._id === buildingId)?.name;
  const selector = selected.length ? { invoiceIds: selected } : { period, ...(buildingId && { buildingId }) };
  const scopeText = selected.length
    ? `${selected.length} thông báo đã chọn`
    : `toàn bộ kỳ ${periodLabel(period)}${buildingName ? ` của ${buildingName}` : ' (mọi tòa)'}`;
  const tabCount = byStatus?.[status]?.count ?? 0;
  const canBatch = selected.length > 0 || (Boolean(period) && tabCount > 0);

  const [publish, publishing] = useAction(() => invoiceApi.publish(selector), { onDone: afterAction });

  const countOf = (s) =>
    s === 'ALL' ? Object.values(byStatus ?? {}).reduce((sum, x) => sum + x.count, 0) : (byStatus?.[s]?.count ?? 0);

  const columns = [
    {
      title: 'Mã',
      dataIndex: 'code',
      width: 210,
      render: (code) => <Typography.Text code>{code}</Typography.Text>,
    },
    { title: 'Kỳ', dataIndex: 'period', width: 90, render: periodLabel },
    { title: 'Căn hộ', width: 110, render: (_, r) => <b>{aptLabel(r)}</b> },
    {
      title: 'Người nộp phí',
      render: (_, r) => (
        <Flex gap={6} align="center" wrap>
          {r.payerId?.fullName ?? '—'}
          <EnumTag map={PAYER_SOURCES} value={r.payerSource} />
        </Flex>
      ),
    },
    { title: 'Tổng tiền', dataIndex: 'totalAmount', width: 140, align: 'right', render: (v) => <b>{formatMoney(v)}</b> },
    {
      title: 'Còn nợ',
      width: 140,
      align: 'right',
      render: (_, r) =>
        OUTSTANDING_STATUSES.includes(r.status) ? (
          <Typography.Text type="danger">{formatMoney(outstandingOf(r))}</Typography.Text>
        ) : (
          '—'
        ),
    },
    { title: 'Hạn đóng', dataIndex: 'dueDate', width: 110, render: formatDate },
    { title: 'Trạng thái', dataIndex: 'status', width: 170, render: (s) => <EnumTag map={INVOICE_STATUS} value={s} /> },
  ];

  // Chỉ chọn dòng khi đang ở tab Nháp (Kế toán phát hành hàng loạt)
  const selectable = isAccountant && status === 'DRAFT';
  // Đang ở tab "Tất cả" / tab khác mà có thông báo Nháp chờ phát hành
  const pendingTab = isAccountant ? 'DRAFT' : null;
  const pendingCount = pendingTab ? (byStatus?.[pendingTab]?.count ?? 0) : 0;

  return (
    <>
      <PageHeader
        title="Thông báo phí"
        subtitle="Kế toán tính phí → Rà soát, thêm phí phát sinh → Phát hành trực tiếp cho cư dân."
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Thông báo phí' }]}
        extra={
          isManager && (
            // Tài khoản nhận tiền nhập ở hồ sơ tòa nhà (UC05) — một nguồn cho PDF thông báo phí
            <Button icon={<BankOutlined />} onClick={() => navigate('/app/building-settings')}>
              Tài khoản nhận tiền
            </Button>
          )
        }
      />

      <Card>
        <Flex vertical gap={12}>
          <Flex gap={8} wrap>
            <DatePicker
              picker="month"
              format="MM/YYYY"
              placeholder="Mọi kỳ"
              value={month}
              onChange={(d) => (setMonth(d), setPage(1), setSelected([]))}
            />
            <Select
              allowClear
              placeholder="Mọi tòa"
              style={{ width: 200 }}
              value={buildingId}
              onChange={(v) => (setBuildingId(v), setPage(1))}
              options={buildings.map((b) => ({ value: b._id, label: b.name }))}
            />
            <Input.Search
              allowClear
              placeholder="Tìm mã thông báo"
              style={{ width: 240 }}
              value={q}
              onChange={(e) => (setQ(e.target.value), setPage(1))}
            />
          </Flex>

          <div style={{ overflowX: 'auto' }}>
            <Segmented
              value={status}
              onChange={setStatus}
              options={TABS.map((s) => ({
                value: s,
                label: `${s === 'ALL' ? 'Tất cả' : INVOICE_STATUS[s].label} (${countOf(s)})`,
              }))}
            />
          </div>

          {pendingTab && status !== pendingTab && pendingCount > 0 && (
            <Alert
              type="info"
              showIcon
              message={`Có ${pendingCount} thông báo ${INVOICE_STATUS[pendingTab].label.toLowerCase()} cần bạn ${isAccountant ? 'rà soát & phát hành' : 'duyệt'}.`}
              action={
                <Button size="small" type="primary" onClick={() => setStatus(pendingTab)}>
                  Mở tab {INVOICE_STATUS[pendingTab].label}
                </Button>
              }
            />
          )}

          {period && status === 'DRAFT' && <AdjustmentsPanel period={period} />}

          {selectable && (
            <Flex gap={8} wrap align="center">
              <Typography.Text type="secondary">
                {selected.length
                  ? `Đã chọn ${selected.length}`
                  : !tabCount
                    ? 'Không có thông báo nào ở trạng thái này'
                    : period
                      ? `Không chọn dòng = xử lý ${scopeText}`
                      : 'Chọn dòng hoặc chọn kỳ'}
              </Typography.Text>
              {isAccountant && status === 'DRAFT' && (
                <Popconfirm
                  title={`Phát hành ${scopeText}?`}
                  description="Người nộp phí sẽ nhận thông báo và email ngay. Đã phát hành thì không sửa trực tiếp được."
                  onConfirm={() => publish().catch(() => {})}
                  disabled={!canBatch}
                >
                  <Button type="primary" icon={<CheckOutlined />} loading={publishing} disabled={!canBatch}>
                    Phát hành
                  </Button>
                </Popconfirm>
              )}
            </Flex>
          )}

          <Table
            rowKey="_id"
            size="middle"
            loading={list.loading}
            dataSource={items}
            columns={columns}
            scroll={{ x: 1100 }}
            rowSelection={selectable ? { selectedRowKeys: selected, onChange: setSelected, preserveSelectedRowKeys: true } : undefined}
            onRow={(r) => ({ onClick: () => navigate(`/app/invoices/${r._id}`), style: { cursor: 'pointer' } })}
            pagination={{
              current: page,
              pageSize,
              total: list.pagination?.total ?? 0,
              showSizeChanger: true,
              showTotal: (t) => `${t} thông báo`,
              onChange: (p, s) => (setPage(p), setPageSize(s)),
            }}
          />
        </Flex>
      </Card>
    </>
  );
}

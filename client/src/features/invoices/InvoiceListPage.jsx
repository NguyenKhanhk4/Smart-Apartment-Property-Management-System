import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import dayjs from 'dayjs';
import { Button, Card, DatePicker, Flex, Input, Popconfirm, Segmented, Select, Space, Table, Typography } from 'antd';
import { BankOutlined, CheckOutlined, RollbackOutlined, SendOutlined } from '@ant-design/icons';
import { invoiceApi } from '../../api/moduleB.api';
import { lookupApi } from '../../api/moduleE.api';
import EnumTag from '../../components/EnumTag';
import PageHeader from '../../components/PageHeader';
import ReasonModal from '../../components/ReasonModal';
import { INVOICE_STATUS, PAYER_SOURCES } from '../../constants/enums';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { formatDate, formatMoney } from '../../utils/format';
import AdjustmentsPanel from './AdjustmentsPanel';
import BankInfoModal from './BankInfoModal';
import { aptLabel, OUTSTANDING_STATUSES, outstandingOf, periodLabel } from './invoiceShared';

// Mô đun 4 — UC27/UC28: danh sách thông báo phí theo kỳ. Kế toán trình duyệt Nháp; Trưởng BQL Duyệt & Phát hành / Trả lại.
// Trạng thái lấy từ ?status= để link trong thông báo (vd /app/invoices?status=PENDING_APPROVAL) mở đúng tab.
const TABS = ['ALL', 'DRAFT', 'PENDING_APPROVAL', 'UNPAID', 'PARTIALLY_PAID', 'OVERDUE', 'PAID', 'CANCELLED'];

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
  const [returning, setReturning] = useState(null); // selector đang trả lại
  const [bankOpen, setBankOpen] = useState(false);
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
  // Có chọn dòng → xử lý các dòng đã chọn; không chọn → cả kỳ đang lọc
  const selector = selected.length ? { invoiceIds: selected } : { period };
  const scopeText = selected.length ? `${selected.length} thông báo đã chọn` : `toàn bộ kỳ ${periodLabel(period)}`;
  const canBatch = selected.length > 0 || Boolean(period);

  const [submit, submitting] = useAction(() => invoiceApi.submit(selector), { onDone: afterAction });
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

  // Chỉ chọn dòng khi đang ở tab có thao tác hàng loạt cho vai trò này
  const selectable = (isAccountant && status === 'DRAFT') || (isManager && status === 'PENDING_APPROVAL');

  return (
    <>
      <PageHeader
        title="Thông báo phí"
        subtitle="Kế toán tính phí → Trình duyệt → Trưởng BQL Duyệt & Phát hành. Cư dân chỉ thấy thông báo đã phát hành."
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Thông báo phí' }]}
        extra={
          <Space wrap>
            {isManager && (
              <Button icon={<BankOutlined />} onClick={() => setBankOpen(true)}>
                Tài khoản nhận tiền
              </Button>
            )}
            {isAccountant && (
              <Button onClick={() => navigate('/app/invoices/generate')} type="primary">
                Tính phí
              </Button>
            )}
          </Space>
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

          {period && (status === 'DRAFT' || status === 'PENDING_APPROVAL') && <AdjustmentsPanel period={period} />}

          {selectable && (
            <Flex gap={8} wrap align="center">
              <Typography.Text type="secondary">
                {selected.length ? `Đã chọn ${selected.length}` : period ? 'Không chọn dòng = xử lý cả kỳ' : 'Chọn dòng hoặc chọn kỳ'}
              </Typography.Text>
              {isAccountant && status === 'DRAFT' && (
                <Popconfirm title={`Trình duyệt ${scopeText}?`} onConfirm={() => submit().catch(() => {})} disabled={!canBatch}>
                  <Button type="primary" icon={<SendOutlined />} loading={submitting} disabled={!canBatch}>
                    Trình duyệt
                  </Button>
                </Popconfirm>
              )}
              {isManager && status === 'PENDING_APPROVAL' && (
                <Space wrap>
                  <Popconfirm
                    title={`Duyệt & Phát hành ${scopeText}?`}
                    description="Cư dân sẽ nhận thông báo và email ngay. Đã phát hành thì không sửa được."
                    onConfirm={() => publish().catch(() => {})}
                    disabled={!canBatch}
                  >
                    <Button type="primary" icon={<CheckOutlined />} loading={publishing} disabled={!canBatch}>
                      Duyệt & Phát hành
                    </Button>
                  </Popconfirm>
                  <Button danger icon={<RollbackOutlined />} disabled={!canBatch} onClick={() => setReturning(selector)}>
                    Trả lại
                  </Button>
                </Space>
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

      <BankInfoModal open={bankOpen} onClose={() => setBankOpen(false)} />

      <ReasonModal
        open={Boolean(returning)}
        title="Trả lại cho Kế toán"
        hint="Thông báo về trạng thái Nháp để Kế toán sửa và trình duyệt lại."
        okText="Trả lại"
        minLength={5}
        action={(reason) => invoiceApi.returnBack({ ...returning, reason })}
        onClose={() => setReturning(null)}
        onDone={() => (setReturning(null), afterAction())}
      />
    </>
  );
}

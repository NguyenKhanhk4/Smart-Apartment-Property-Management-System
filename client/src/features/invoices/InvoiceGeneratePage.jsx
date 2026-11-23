import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { Alert, Button, Card, DatePicker, Flex, Popconfirm, Segmented, Select, Table, Typography } from 'antd';
import { CheckSquareOutlined, ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { invoiceApi } from '../../api/moduleB.api';
import { lookupApi } from '../../api/moduleE.api';
import PageHeader from '../../components/PageHeader';
import EnumTag from '../../components/EnumTag';
import { useAction, useApi } from '../../hooks/useApi';
import { FEE_CATEGORIES, INVOICE_PREVIEW_STATUS, INVOICE_STATUS, PAYER_SOURCES } from '../../constants/enums';
import { formatMoney, formatQuantity } from '../../utils/format';

// Mô đun 4 — UC26: Xem trước và tính phí tháng → thông báo phí Nháp. Kế toán kiểm tra, sửa rồi trình Trưởng BQL duyệt.
const periodLabel = (p) => `${p.slice(5)}/${p.slice(0, 4)}`;
// Chỉ lập tới kỳ hiện tại (phí tiện ích kỳ trước phải chốt xong); xem trước được cả kỳ sau
const isFuture = (d) => d.isAfter(dayjs(), 'month');

const itemColumns = [
  { title: 'Nhóm', dataIndex: 'feeCategory', width: 130, render: (v) => <EnumTag map={FEE_CATEGORIES} value={v} /> },
  { title: 'Diễn giải', dataIndex: 'description' },
  { title: 'SL', dataIndex: 'quantity', width: 80, align: 'right', render: formatQuantity },
  { title: 'Đơn giá', dataIndex: 'unitPrice', width: 130, align: 'right', render: formatMoney },
  { title: 'Thành tiền', dataIndex: 'amount', width: 140, align: 'right', render: formatMoney },
];

export default function InvoiceGeneratePage() {
  const [month, setMonth] = useState(() => dayjs());
  const [buildingId, setBuildingId] = useState();
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [batchResult, setBatchResult] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const period = month.format('YYYY-MM');
  const future = isFuture(month);

  const { data: buildings = [] } = useApi(() => lookupApi.buildings(), []);
  const preview = useApi(() => invoiceApi.preview({ period, buildingId }), [period, buildingId]);
  const data = preview.data;
  const buildingName = buildings.find((b) => b._id === buildingId)?.name;

  const afterBatch = (res) => (setBatchResult(res.data), setSelectedIds([]), preview.reload());
  const [generateOne, generatingOne] = useAction((apartmentId) => invoiceApi.generate({ period, apartmentId }), {
    onDone: preview.reload,
  });
  // Lập tất cả theo phạm vi đang xem: lọc 1 tòa → chỉ tòa đó; không lọc → toàn bộ các tòa
  const [generateAll, generatingAll] = useAction(() => invoiceApi.generate({ period, ...(buildingId && { buildingId }) }), {
    onDone: afterBatch,
  });
  const [generateSelected, generatingSelected] = useAction(
    () => invoiceApi.generate({ period, apartmentIds: selectedIds }),
    { onDone: afterBatch },
  );

  const rows = useMemo(
    () => (data?.rows ?? []).filter((r) => statusFilter === 'ALL' || r.status === statusFilter),
    [data, statusFilter],
  );
  const summary = data?.summary;
  const selectedTotal = useMemo(
    () => (data?.rows ?? []).filter((r) => selectedIds.includes(r.apartmentId)).reduce((s, r) => s + r.totalAmount, 0),
    [data, selectedIds],
  );
  const scopeLabel = buildingName ? `tòa ${buildingName}` : 'toàn bộ các tòa';

  const columns = [
    {
      title: 'Căn hộ',
      width: 140,
      render: (_, r) => (
        <Flex vertical>
          <b>
            {r.buildingCode}-{r.apartmentCode}
          </b>
          <Typography.Text type="secondary">{r.area} m²</Typography.Text>
        </Flex>
      ),
    },
    {
      title: 'Mã hóa đơn',
      dataIndex: 'code',
      width: 200,
      render: (code, r) => (
        <Flex vertical gap={2}>
          <Typography.Text code>{code ?? '—'}</Typography.Text>
          {r.invoice && <EnumTag map={INVOICE_STATUS} value={r.invoice.status} />}
        </Flex>
      ),
    },
    {
      title: 'Người trả',
      render: (_, r) =>
        r.payer ? (
          <Flex gap={6} align="center" wrap>
            {r.payer.fullName ?? '—'}
            <EnumTag map={PAYER_SOURCES} value={r.payer.source} />
          </Flex>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: 'Số dòng phí',
      width: 110,
      align: 'right',
      render: (_, r) => (r.status === 'NEW' ? r.items.length : '—'),
    },
    {
      title: 'Tổng tiền',
      dataIndex: 'totalAmount',
      width: 150,
      align: 'right',
      render: (v, r) => (r.status === 'NEW' || r.status === 'EXISTS' ? <b>{formatMoney(v)}</b> : '—'),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 200,
      render: (s, r) => (
        <Flex vertical gap={2}>
          <span>
            <EnumTag map={INVOICE_PREVIEW_STATUS} value={s} />
          </span>
          {r.error && <Typography.Text type="danger">{r.error}</Typography.Text>}
        </Flex>
      ),
    },
    {
      title: '',
      width: 110,
      render: (_, r) =>
        r.status === 'NEW' &&
        !future && (
          <Popconfirm
            title={`Tính phí ${r.buildingCode}-${r.apartmentCode}?`}
            description={`${formatMoney(r.totalAmount)} · tạo thông báo Nháp, chưa gửi cư dân`}
            onConfirm={() => generateOne(r.apartmentId).catch(() => {})}
          >
            <Button size="small" loading={generatingOne}>
              Lập
            </Button>
          </Popconfirm>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Tính phí tháng"
        subtitle="Xem trước phí quản lý từ ngày bàn giao, phí vệ sinh, gửi xe và phí tiện ích. Tạo thông báo Nháp để rà soát, thêm phí phát sinh và phát hành."
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Tính phí' }]}
        extra={
          <Flex gap={8} wrap>
            {selectedIds.length > 0 && (
              <Popconfirm
                title={`Lập hóa đơn cho ${selectedIds.length} căn đã chọn?`}
                description={`Kỳ ${periodLabel(period)} · ${formatMoney(selectedTotal)} · tạo thông báo Nháp, chưa gửi cư dân.`}
                onConfirm={() => generateSelected().catch(() => {})}
                disabled={future}
              >
                <Button icon={<CheckSquareOutlined />} loading={generatingSelected} disabled={future || generatingAll}>
                  Lập {selectedIds.length} căn đã chọn
                </Button>
              </Popconfirm>
            )}
            <Popconfirm
              title={`Lập hóa đơn tất cả kỳ ${periodLabel(period)}?`}
              description={`${summary?.new ?? 0} căn (${scopeLabel}) sẽ có thông báo Nháp · ${formatMoney(summary?.totalAmount)}. Căn đã có thông báo được bỏ qua.`}
              onConfirm={() => generateAll().catch(() => {})}
              disabled={future || !summary?.new}
            >
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={generatingAll}
                disabled={future || !summary?.new || generatingSelected}
              >
                Lập hóa đơn tất cả ({summary?.new ?? 0} căn)
              </Button>
            </Popconfirm>
          </Flex>
        }
      />

      <Card className="mb-4">
        <Flex gap={12} wrap align="center">
          <DatePicker
            picker="month"
            format="MM/YYYY"
            allowClear={false}
            value={month}
            onChange={(d) => (setMonth(d), setBatchResult(null), setSelectedIds([]))}
            disabledDate={(d) => d.isAfter(dayjs().add(1, 'month'), 'month')}
          />
          <Select
            allowClear
            placeholder="Tất cả tòa"
            style={{ minWidth: 200 }}
            value={buildingId}
            onChange={(v) => (setBuildingId(v), setSelectedIds([]))}
            options={buildings.map((b) => ({ value: b._id, label: b.name }))}
          />
          <Button icon={<ReloadOutlined />} onClick={preview.reload}>
            Tính lại
          </Button>
          {data?.prices && (
            <Typography.Text type="secondary">
              Bảng giá kỳ {periodLabel(period)}: {data.prices.map((p) => `${p.name} ${formatMoney(p.unitPrice)}`).join(' · ') || 'chưa có'}
            </Typography.Text>
          )}
        </Flex>
      </Card>

      {future && (
        <Alert
          className="mb-4"
          type="info"
          showIcon
          message={`Kỳ ${periodLabel(period)} chưa tới: chỉ xem trước, phí tiện ích tháng này còn có thể phát sinh thêm.`}
        />
      )}
      {batchResult && (
        <Alert
          className="mb-4"
          closable
          onClose={() => setBatchResult(null)}
          type={batchResult.run?.status === 'SUCCESS' ? 'success' : 'warning'}
          showIcon
          message={
            batchResult.summary
              ? `Đã tạo ${batchResult.summary.created} thông báo Nháp (${formatMoney(batchResult.summary.totalAmount)}); bỏ qua ${batchResult.summary.existing} căn đã có, ${batchResult.summary.notHandedOver} căn chưa bàn giao trong kỳ và ${batchResult.summary.noPayer} căn chưa có HĐ mua bán.`
              : 'Tính phí thất bại'
          }
          description={
            batchResult.summary?.failed?.length
              ? batchResult.summary.failed.map((f) => `${f.apartment}: ${f.message}`).join(' · ')
              : batchResult.run?.status === 'FAILED' && batchResult.run.errorMessage
          }
        />
      )}

      <Card>
        <Segmented
          className="mb-4"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'ALL', label: `Tất cả (${summary?.totalApartments ?? 0})` },
            ...Object.entries(INVOICE_PREVIEW_STATUS).map(([value, { label }]) => ({
              value,
              label: `${label} (${(data?.rows ?? []).filter((r) => r.status === value).length})`,
            })),
          ]}
        />
        <Table
          rowKey="apartmentId"
          loading={preview.loading}
          dataSource={rows}
          columns={columns}
          scroll={{ x: 1000 }}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          rowSelection={
            future
              ? undefined
              : {
                  selectedRowKeys: selectedIds,
                  onChange: setSelectedIds,
                  preserveSelectedRowKeys: true,
                  // Chỉ chọn được căn "Sẽ lập"; chọn tất cả ở header = mọi căn Sẽ lập đang hiển thị
                  getCheckboxProps: (r) => ({ disabled: r.status !== 'NEW' }),
                  selections: [
                    {
                      key: 'all-new',
                      text: 'Chọn tất cả căn Sẽ lập (mọi trang)',
                      onSelect: () => setSelectedIds((data?.rows ?? []).filter((r) => r.status === 'NEW').map((r) => r.apartmentId)),
                    },
                    { key: 'none', text: 'Bỏ chọn', onSelect: () => setSelectedIds([]) },
                  ],
                }
          }
          expandable={{
            rowExpandable: (r) => r.items.length > 0,
            expandedRowRender: (r) => (
              <Table rowKey={(i) => `${i.feeCode}-${i.refId ?? i.description}`} size="small" dataSource={r.items} columns={itemColumns} pagination={false} />
            ),
          }}
        />
      </Card>
    </>
  );
}

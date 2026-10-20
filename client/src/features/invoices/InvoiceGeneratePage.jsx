import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { Alert, Button, Card, Col, DatePicker, Flex, Popconfirm, Row, Segmented, Select, Statistic, Table, Typography } from 'antd';
import { ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { invoiceApi } from '../../api/moduleB.api';
import { lookupApi } from '../../api/moduleE.api';
import PageHeader from '../../components/PageHeader';
import EnumTag from '../../components/EnumTag';
import { useAction, useApi } from '../../hooks/useApi';
import { FEE_CATEGORIES, INVOICE_PREVIEW_STATUS, INVOICE_STATUS, PAYER_SOURCES } from '../../constants/enums';
import { formatMoney } from '../../utils/format';

// UC-B02 — Xem trước và lập hóa đơn tháng. Cron tự lập lúc 00:30 ngày 1; trang này để kiểm tra số liệu và lập bù.
const periodLabel = (p) => `${p.slice(5)}/${p.slice(0, 4)}`;
// Chỉ lập tới kỳ hiện tại (phí tiện ích kỳ trước phải chốt xong); xem trước được cả kỳ sau
const isFuture = (d) => d.isAfter(dayjs(), 'month');

const itemColumns = [
  { title: 'Nhóm', dataIndex: 'feeCategory', width: 130, render: (v) => <EnumTag map={FEE_CATEGORIES} value={v} /> },
  { title: 'Diễn giải', dataIndex: 'description' },
  { title: 'SL', dataIndex: 'quantity', width: 80, align: 'right' },
  { title: 'Đơn giá', dataIndex: 'unitPrice', width: 130, align: 'right', render: formatMoney },
  { title: 'Thành tiền', dataIndex: 'amount', width: 140, align: 'right', render: formatMoney },
];

export default function InvoiceGeneratePage() {
  const [month, setMonth] = useState(() => dayjs());
  const [buildingId, setBuildingId] = useState();
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [batchResult, setBatchResult] = useState(null);
  const period = month.format('YYYY-MM');
  const future = isFuture(month);

  const { data: buildings = [] } = useApi(() => lookupApi.buildings(), []);
  const preview = useApi(() => invoiceApi.preview({ period, buildingId }), [period, buildingId]);
  const data = preview.data;

  const [generateOne, generatingOne] = useAction((apartmentId) => invoiceApi.generate({ period, apartmentId }), {
    onDone: preview.reload,
  });
  const [generateAll, generatingAll] = useAction(() => invoiceApi.generate({ period }), {
    onDone: (res) => (setBatchResult(res.data), preview.reload()),
  });

  const rows = useMemo(
    () => (data?.rows ?? []).filter((r) => statusFilter === 'ALL' || r.status === statusFilter),
    [data, statusFilter],
  );
  const summary = data?.summary;

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
            title={`Lập hóa đơn ${r.buildingCode}-${r.apartmentCode}?`}
            description={`${formatMoney(r.totalAmount)} · người trả sẽ nhận thông báo`}
            onConfirm={() => generateOne(r.apartmentId).catch(() => {})}
          >
            <Button size="small" loading={generatingOne}>
              Lập
            </Button>
          </Popconfirm>
        ),
    },
  ];

  const stat = (title, value, opts) => (
    <Col xs={12} md={8} lg={4}>
      <Card size="small">
        <Statistic title={title} value={value ?? 0} loading={preview.loading} {...opts} />
      </Card>
    </Col>
  );

  return (
    <>
      <PageHeader
        title="Lập hóa đơn tháng"
        subtitle="Hệ thống tự lập hóa đơn lúc 00:30 ngày 1 hằng tháng: phí vệ sinh, gửi xe của kỳ này và phí tiện ích kỳ trước. Xem trước để kiểm tra, lập bù cho căn mới bàn giao hoặc sau khi hủy hóa đơn."
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Lập hóa đơn' }]}
        extra={
          <Popconfirm
            title={`Lập hóa đơn kỳ ${periodLabel(period)} cho cả đợt?`}
            description={`${summary?.new ?? 0} căn sẽ được lập (toàn bộ các tòa), căn đã có hóa đơn được bỏ qua.`}
            onConfirm={() => generateAll().catch(() => {})}
            disabled={future || !summary?.new}
          >
            <Button type="primary" icon={<ThunderboltOutlined />} loading={generatingAll} disabled={future || !summary?.new}>
              Lập cả đợt
            </Button>
          </Popconfirm>
        }
      />

      <Card className="mb-4">
        <Flex gap={12} wrap align="center">
          <DatePicker
            picker="month"
            format="MM/YYYY"
            allowClear={false}
            value={month}
            onChange={(d) => (setMonth(d), setBatchResult(null))}
            disabledDate={(d) => d.isAfter(dayjs().add(1, 'month'), 'month')}
          />
          <Select
            allowClear
            placeholder="Tất cả tòa"
            style={{ minWidth: 200 }}
            value={buildingId}
            onChange={setBuildingId}
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
              ? `Đã lập ${batchResult.summary.created} hóa đơn (${formatMoney(batchResult.summary.totalAmount)}); bỏ qua ${batchResult.summary.existing} căn đã có, ${batchResult.summary.noPayer} căn chưa có HĐ mua bán.`
              : 'Sinh hóa đơn thất bại'
          }
          description={
            batchResult.summary?.failed?.length
              ? batchResult.summary.failed.map((f) => `${f.apartment}: ${f.message}`).join(' · ')
              : batchResult.run?.status === 'FAILED' && batchResult.run.errorMessage
          }
        />
      )}

      <Row gutter={[12, 12]} className="mb-4">
        {stat('Sẽ lập', summary?.new, { valueStyle: { color: '#1677ff' } })}
        {stat('Đã có hóa đơn', summary?.existing)}
        {stat('Chưa có HĐ mua bán', summary?.noPayer)}
        {stat('Lỗi', summary?.error, summary?.error ? { valueStyle: { color: '#cf1322' } } : undefined)}
        <Col xs={24} md={16} lg={8}>
          <Card size="small">
            <Statistic title="Tổng tiền dự kiến (căn sẽ lập)" value={formatMoney(summary?.totalAmount)} loading={preview.loading} />
          </Card>
        </Col>
      </Row>

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

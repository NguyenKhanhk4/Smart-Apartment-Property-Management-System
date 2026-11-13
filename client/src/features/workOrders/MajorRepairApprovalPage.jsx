import { useState } from 'react';
import { Badge, Button, Card, Flex, Space, Table, Tabs, Tag, Tooltip, Typography } from 'antd';
import { workOrderApi } from '../../api/equipment.api';
import EnumTag from '../../components/EnumTag';
import PageHeader from '../../components/PageHeader';
import { REPAIR_COST_SOURCES, WORK_ORDER_STATUS } from '../../constants/enums';
import { useApi } from '../../hooks/useApi';
import { formatDate, formatDateTime, formatMoney } from '../../utils/format';
import AssetCode from '../assets/AssetCode';
import { RepairDecisionModal, RepairRequestModal } from './RepairModals';
import WorkOrderReportModal from './WorkOrderReportModal';

const PAGE_SIZE = 10;

const assetCell = (_, r) => (
  <Flex vertical>
    <Space size={6} wrap>
      <AssetCode code={r.assetId?.code} />
      <Typography.Text strong>{r.assetId?.name ?? r.title}</Typography.Text>
    </Space>
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
      {r.assetId?.buildingId?.name}{r.assetId?.location ? ` · ${r.assetId.location}` : ''}
    </Typography.Text>
  </Flex>
);

/** Ngày xem lại của phiếu hoãn: đã tới / quá thì tô đỏ, kèm số lần đã nhắc */
const reviewCell = (_, r) => (
  <Flex vertical>
    <Typography.Text type={r.isReviewDue ? 'danger' : undefined} strong={r.isReviewDue}>{formatDate(r.repair?.reviewDate)}</Typography.Text>
    {r.isReviewDue && (
      <Typography.Text type="danger" style={{ fontSize: 12 }}>
        {r.reviewOverdueDays > 0 ? `Quá ${r.reviewOverdueDays} ngày` : 'Đến hạn hôm nay'}
        {r.repair?.remindCount ? ` · đã nhắc ${r.repair.remindCount} lần` : ''}
      </Typography.Text>
    )}
  </Flex>
);

// UC10 – Trưởng BQL: danh sách báo cáo hư hỏng chờ quyết định, phiếu đang tạm hoãn (để không bị quên), phiếu đã quyết định
export default function MajorRepairApprovalPage() {
  const [tab, setTab] = useState('pending');
  const [page, setPage] = useState(1);
  const [acting, setActing] = useState(null); // { mode: 'decide' | 'retire' | 'request' | 'view', wo }
  const list = useApi(() => workOrderApi.repairs({ tab, page, limit: PAGE_SIZE }), [tab, page]);
  const counts = list.raw?.counts ?? {};
  const settings = list.raw?.settings;
  const close = () => setActing(null);

  const common = [
    { title: 'Thiết bị', key: 'asset', width: 240, render: assetCell },
    { title: 'Mô tả hư hỏng', dataIndex: ['repair', 'faultDesc'], ellipsis: true },
    { title: 'Chi phí dự kiến', dataIndex: ['repair', 'estimatedCost'], width: 140, align: 'right', render: formatMoney },
  ];
  const byTab = {
    pending: [
      { title: 'Báo cáo', key: 'reported', width: 170, render: (_, r) => <Flex vertical><span>{r.repair?.reportedBy?.fullName ?? '—'}</span><Typography.Text type="secondary" style={{ fontSize: 12 }}>{formatDateTime(r.repair?.reportedAt)}</Typography.Text></Flex> },
      {
        title: 'Nguồn chi',
        key: 'source',
        width: 160,
        render: (_, r) => (r.repair?.costSource === 'FUND'
          ? <Flex vertical><EnumTag map={REPAIR_COST_SOURCES} value="FUND" /><Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.pendingFund ? `Đề xuất ${r.pendingFund.code} đang chờ biểu quyết` : "Chờ Kế toán lập đề xuất"}</Typography.Text></Flex>
          : <Tag>Chưa quyết định</Tag>),
      },
      {
        title: '',
        key: 'act',
        width: 120,
        fixed: 'right',
        // Đề xuất chi quỹ đang chờ biểu quyết thì không quyết định lại được (server trả WORKORDER_FUND_PENDING)
        render: (_, r) => (
          <Tooltip title={r.pendingFund ? `Đề xuất ${r.pendingFund.code} đang chờ Ban quản trị biểu quyết` : undefined}>
            <Button size="small" type="primary" disabled={Boolean(r.pendingFund)} onClick={() => setActing({ mode: 'decide', wo: r })}>Quyết định</Button>
          </Tooltip>
        ),
      },
    ],
    postponed: [
      { title: 'Xem lại', key: 'review', width: 170, render: reviewCell },
      { title: 'Lý do hoãn', dataIndex: ['repair', 'decisionNote'], ellipsis: true, width: 200 },
      {
        title: '',
        key: 'act',
        width: 230,
        fixed: 'right',
        render: (_, r) => (
          <Space size={6}>
            <Button size="small" type={r.isReviewDue ? 'primary' : 'default'} onClick={() => setActing({ mode: 'request', wo: r })}>Gửi yêu cầu sửa lại</Button>
            <Button size="small" danger onClick={() => setActing({ mode: 'retire', wo: r })}>Ngừng sử dụng</Button>
          </Space>
        ),
      },
    ],
    decided: [
      { title: 'Trạng thái', dataIndex: 'status', width: 140, render: (v) => <EnumTag map={WORK_ORDER_STATUS} value={v} /> },
      { title: 'Nguồn chi', dataIndex: ['repair', 'costSource'], width: 140, render: (v) => (v ? <EnumTag map={REPAIR_COST_SOURCES} value={v} /> : '—') },
      { title: 'Quyết định', key: 'decided', width: 170, render: (_, r) => <Flex vertical><span>{r.repair?.decidedBy?.fullName ?? '—'}</span><Typography.Text type="secondary" style={{ fontSize: 12 }}>{formatDateTime(r.repair?.decidedAt)}</Typography.Text></Flex> },
      { title: '', key: 'act', width: 100, fixed: 'right', render: (_, r) => <Button size="small" onClick={() => setActing({ mode: 'view', wo: r })}>Xem</Button> },
    ],
  };

  const tabLabel = (label, n, danger) => (
    <Space size={6}>
      {label}
      {n > 0 && <Badge count={n} color={danger ? 'red' : 'blue'} />}
    </Space>
  );

  return (
    <>
      <PageHeader
        title="Duyệt sửa chữa"
        subtitle="Báo cáo hư hỏng chờ quyết định, phiếu tạm hoãn và lịch sử quyết định"
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Duyệt sửa chữa' }]}
      />
      <Card>
        <Tabs
          activeKey={tab}
          onChange={(k) => {
            setTab(k);
            setPage(1);
          }}
          items={[
            { key: 'pending', label: tabLabel('Chờ quyết định', counts.pending) },
            { key: 'postponed', label: tabLabel(counts.reviewDue ? `Đang tạm hoãn (${counts.reviewDue} đến hạn xem lại)` : 'Đang tạm hoãn', counts.postponed, counts.reviewDue > 0) },
            { key: 'decided', label: 'Đã quyết định' },
          ]}
        />
        <Table
          rowKey="_id"
          size="middle"
          loading={list.loading}
          dataSource={list.data ?? []}
          columns={[...common, ...byTab[tab]]}
          scroll={{ x: 900 }}
          onRow={(r) => (r.isReviewDue ? { style: { background: 'var(--ant-color-error-bg)' } } : {})}
          pagination={{ current: page, pageSize: PAGE_SIZE, total: list.pagination?.total, onChange: setPage, hideOnSinglePage: true }}
          locale={{ emptyText: tab === 'pending' ? 'Không có báo cáo hư hỏng chờ quyết định' : tab === 'postponed' ? 'Không có phiếu tạm hoãn' : 'Chưa có quyết định nào' }}
        />
      </Card>
      {acting?.mode === 'decide' && <RepairDecisionModal workOrder={acting.wo} settings={settings} open onClose={close} onDone={list.reload} />}
      {acting?.mode === 'retire' && <RepairDecisionModal workOrder={acting.wo} only="RETIRE" open onClose={close} onDone={list.reload} />}
      {acting?.mode === 'request' && <RepairRequestModal workOrder={acting.wo} open onClose={close} onDone={list.reload} />}
      {acting?.mode === 'view' && <WorkOrderReportModal workOrder={acting.wo} open onClose={close} />}
    </>
  );
}

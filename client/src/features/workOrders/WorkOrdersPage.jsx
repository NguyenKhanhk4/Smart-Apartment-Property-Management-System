import { useState } from 'react';
import { Link } from 'react-router';
import { Button, Card, Flex, Input, Select, Switch, Table, Tabs, Tag, Tooltip, Typography } from 'antd';
import { workOrderApi } from '../../api/equipment.api';
import { lookupApi } from '../../api/moduleE.api';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import EnumTag from '../../components/EnumTag';
import PageHeader from '../../components/PageHeader';
import { WORK_ORDER_RESULTS, WORK_ORDER_STATUS, WORK_ORDER_TYPES, enumOptions } from '../../constants/enums';
import { formatDate, formatDateTime } from '../../utils/format';
import { vtName } from '../../motion/viewTransition';
import AssignWorkOrderModal from './AssignWorkOrderModal';
import ShiftChecklist from './ShiftChecklist';
import WorkOrderReportModal from './WorkOrderReportModal';
import { AcceptanceReviewModal, RepairDecisionModal, RepairRequestModal } from './RepairModals';

const UNASSIGNED = 'UNASSIGNED';
// KTV, tab Đã xong: việc mình đã hoàn thành, mới nhất lên trước
const DONE_FILTER = { status: 'DONE', sort: '-completedAt' };

// Trưởng BQL: danh sách phiếu bảo trì, phân công / giao lại (ngoại lệ), xem kết quả kiểm tra.
// KTV (UC08): tab Checklist ca (quét QR → checklist) và tab Đã xong (phiếu của mình).
export default function WorkOrdersPage() {
  const { hasRole } = useAuth();
  const isTech = hasRole('STAFF:TECHNICIAN');
  const [tab, setTab] = useState('shift');
  const [filters, setFilters] = useState({ page: 1, limit: 20, ...(isTech ? DONE_FILTER : {}) });
  const [assigning, setAssigning] = useState(null);
  const [viewing, setViewing] = useState(null); // báo cáo hoàn thành (ghi chú + ảnh)
  const [reviewing, setReviewing] = useState(null); // { mode: 'approve' | 'accept' | 'request', wo }
  const set = (patch) => setFilters((f) => ({ ...f, page: 1, ...patch }));

  const showTable = !isTech || tab === 'done';
  const { data = [], pagination, loading, reload } = useApi(() => workOrderApi.list(filters), [filters], { enabled: showTable });
  const { data: buildings = [] } = useApi(() => lookupApi.buildings(), [], { enabled: !isTech });
  const { data: techs = [] } = useApi(() => workOrderApi.assignees(), [], { enabled: !isTech });

  const assetColumn = {
    title: 'Thiết bị',
    dataIndex: 'assetId',
    width: 260,
    fixed: 'left',
    render: (a, r) => (
      <Flex vertical>
        {a ? (
          <Link to={`/app/assets/${a._id}`} viewTransition state={{ name: a.name }}>
            <Typography.Text strong style={vtName('asset', a._id)}>{a.name}</Typography.Text>
          </Link>
        ) : (
          '—'
        )}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {a?.buildingId?.name}{a?.location ? ` · ${a.location}` : ''}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.title}</Typography.Text>
      </Flex>
    ),
  };
  const commonColumns = [
    { title: 'Loại', dataIndex: 'type', width: 140, render: (v) => <EnumTag map={WORK_ORDER_TYPES} value={v} /> },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 150,
      render: (v, r) => (
        <Flex vertical gap={4} align="flex-start">
          <EnumTag map={WORK_ORDER_STATUS} value={v} />
          {r.result && <EnumTag map={WORK_ORDER_RESULTS} value={r.result} />}
        </Flex>
      ),
    },
    {
      title: 'Ngày lên lịch',
      dataIndex: 'scheduledDate',
      width: 150,
      render: (v, r) => (
        <Typography.Text type={r.isOverdue ? 'danger' : undefined}>
          {formatDate(v)}{r.isOverdue && ' (quá hạn)'}
        </Typography.Text>
      ),
    },
  ];

  const managerColumns = [
    assetColumn,
    ...commonColumns,
    {
      title: 'Kỹ thuật viên',
      dataIndex: 'assignedTo',
      width: 170,
      render: (u) => u?.fullName ?? <Tag color="warning">Chưa phân công</Tag>,
    },
    {
      title: '',
      width: 130,
      fixed: 'right',
      render: (_, r) => {
        // UC10: quyết định sửa / gửi yêu cầu sửa lại phiếu hoãn; Q12: nghiệm thu
        if (r.status === 'AWAITING_REPAIR_APPROVAL') {
          if (r.pendingFund) {
            return <Tooltip title={`Đề xuất ${r.pendingFund.code} đang chờ Ban quản trị biểu quyết`}><Button size="small" disabled>Chờ biểu quyết</Button></Tooltip>;
          }
          return <Button size="small" type="primary" danger onClick={() => setReviewing({ mode: 'approve', wo: r })}>Quyết định</Button>;
        }
        if (r.status === 'REPAIR_POSTPONED') {
          return <Button size="small" onClick={() => setReviewing({ mode: 'request', wo: r })}>Yêu cầu sửa lại</Button>;
        }
        if (r.status === 'AWAITING_ACCEPTANCE') {
          return <Button size="small" type="primary" onClick={() => setReviewing({ mode: 'accept', wo: r })}>Nghiệm thu</Button>;
        }
        if (['DONE', 'CLOSED'].includes(r.status) || r.result) return <Button size="small" onClick={() => setViewing(r)}>Xem kết quả</Button>;
        return (
          <Button size="small" type={r.assignedTo ? 'default' : 'primary'} onClick={() => setAssigning(r)}>
            {r.assignedTo ? 'Giao lại' : 'Phân công'}
          </Button>
        );
      },
    },
  ];

  const techColumns = [
    assetColumn,
    ...commonColumns,
    { title: 'Kiểm tra lúc', dataIndex: 'inspectedAt', width: 160, render: (v, r) => formatDateTime(v ?? r.completedAt) },
    { title: 'Ghi chú', dataIndex: 'note', width: 240, render: (v) => v || '—' },
    {
      title: '',
      width: 130,
      fixed: 'right',
      render: (_, r) => <Button size="small" onClick={() => setViewing(r)}>Xem kết quả</Button>,
    },
  ];

  return (
    <>
      <PageHeader
        title={isTech ? 'Bảo trì thiết bị' : 'Phiếu bảo trì'}
        subtitle={
          isTech
            ? 'Quét mã QR trên thiết bị để nhận phiếu và mở checklist kiểm tra.'
            : 'Phiếu bảo trì định kỳ: kỹ thuật viên đang trực tự nhận khi quét QR; Trưởng BQL có thể giao đích danh.'
        }
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: isTech ? 'Bảo trì thiết bị' : 'Phiếu bảo trì' }]}
      />
      <Card>
        {isTech && (
          <Tabs
            activeKey={tab}
            onChange={setTab}
            items={[
              { key: 'shift', label: 'Checklist ca' },
              { key: 'done', label: 'Đã xong' },
            ]}
          />
        )}
        {isTech && tab === 'shift' && <ShiftChecklist />}
        {showTable && (
        <>
        <Flex gap={8} wrap style={{ marginBottom: 12 }}>
          <Input.Search placeholder="Tên thiết bị" allowClear style={{ width: 200 }} onSearch={(q) => set({ q: q || undefined })} />
          {!isTech && (
            <>
              <Select
                allowClear
                mode="multiple"
                placeholder="Trạng thái"
                style={{ minWidth: 170 }}
                options={enumOptions(WORK_ORDER_STATUS)}
                onChange={(s) => set({ status: s?.length ? s.join(',') : undefined })}
              />
              <Select
                allowClear
                placeholder="Tòa"
                style={{ width: 140 }}
                options={buildings.map((b) => ({ value: b._id, label: b.name }))}
                onChange={(buildingId) => set({ buildingId })}
              />
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="Kỹ thuật viên"
                style={{ width: 200 }}
                options={[
                  { value: UNASSIGNED, label: 'Chưa phân công' },
                  ...techs.map((t) => ({ value: t._id, label: t.fullName })),
                ]}
                onChange={(v) =>
                  set(v === UNASSIGNED ? { unassigned: true, assignedTo: undefined } : { unassigned: undefined, assignedTo: v })
                }
              />
            </>
          )}
          {!isTech && (
            <Flex align="center" gap={6}>
              <Switch size="small" onChange={(on) => set({ overdue: on || undefined })} />
              <span>Quá hạn</span>
            </Flex>
          )}
        </Flex>
        <Table
          rowKey="_id"
          size="middle"
          loading={loading}
          dataSource={data}
          columns={isTech ? techColumns : managerColumns}
          scroll={{ x: 960 }}
          pagination={{
            current: filters.page,
            pageSize: filters.limit,
            total: pagination?.total,
            showSizeChanger: true,
            onChange: (page, limit) => setFilters((f) => ({ ...f, page, limit })),
          }}
        />
        {assigning && (
          <AssignWorkOrderModal workOrder={assigning} open onClose={() => setAssigning(null)} onDone={reload} />
        )}
        </>
        )}
        {viewing && <WorkOrderReportModal workOrder={viewing} open onClose={() => setViewing(null)} />}
        {reviewing?.mode === 'approve' && (
          <RepairDecisionModal workOrder={reviewing.wo} open onClose={() => setReviewing(null)} onDone={reload} />
        )}
        {reviewing?.mode === 'request' && (
          <RepairRequestModal workOrder={reviewing.wo} open onClose={() => setReviewing(null)} onDone={reload} />
        )}
        {reviewing?.mode === 'accept' && (
          <AcceptanceReviewModal workOrder={reviewing.wo} open onClose={() => setReviewing(null)} onDone={reload} />
        )}
      </Card>
    </>
  );
}

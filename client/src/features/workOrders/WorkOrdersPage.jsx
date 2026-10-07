import { useState } from 'react';
import { Link } from 'react-router';
import { Button, Card, Flex, Input, Popconfirm, Select, Switch, Table, Tabs, Tag, Typography } from 'antd';
import { workOrderApi } from '../../api/moduleD.api';
import { lookupApi } from '../../api/moduleE.api';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import EnumTag from '../../components/EnumTag';
import PageHeader from '../../components/PageHeader';
import { WORK_ORDER_STATUS, WORK_ORDER_TYPES, enumOptions } from '../../constants/enums';
import { formatDate, formatDateTime } from '../../utils/format';
import { vtName } from '../../motion/viewTransition';
import AssignWorkOrderModal from './AssignWorkOrderModal';
import CompleteWorkOrderModal from './CompleteWorkOrderModal';
import WorkOrderReportModal from './WorkOrderReportModal';

const UNASSIGNED = 'UNASSIGNED';

// Việc đang mở: gần hạn nhất lên trước; việc đã xong: mới hoàn thành lên trước
const TABS = {
  open: { status: 'PENDING,IN_PROGRESS', sort: 'scheduledDate' },
  done: { status: 'DONE', sort: '-completedAt' },
};

// UC-D03 (Manager): danh sách work order, phân công / giao lại kỹ thuật viên.
// UC-D04 (KTV): "Work order của tôi" — cùng trang, API tự giới hạn việc được giao; bắt đầu / hoàn thành.
export default function WorkOrdersPage() {
  const { hasRole } = useAuth();
  const isTech = hasRole('STAFF:TECHNICIAN');
  const [tab, setTab] = useState('open');
  const [filters, setFilters] = useState({ page: 1, limit: 20, ...(isTech ? TABS.open : {}) });
  const [assigning, setAssigning] = useState(null);
  const [completing, setCompleting] = useState(null);
  const [viewing, setViewing] = useState(null); // báo cáo hoàn thành (ghi chú + ảnh)
  const set = (patch) => setFilters((f) => ({ ...f, page: 1, ...patch }));

  const { data = [], pagination, loading, reload } = useApi(() => workOrderApi.list(filters), [filters]);
  const { data: buildings = [] } = useApi(() => lookupApi.buildings(), [], { enabled: !isTech });
  const { data: techs = [] } = useApi(() => workOrderApi.assignees(), [], { enabled: !isTech });
  const [start] = useAction((id) => workOrderApi.updateStatus(id, { status: 'IN_PROGRESS' }), { onDone: reload });

  const changeTab = (key) => {
    setTab(key);
    set(TABS[key]);
  };

  const assetColumn = {
    title: 'Tài sản',
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
    { title: 'Trạng thái', dataIndex: 'status', width: 120, render: (v) => <EnumTag map={WORK_ORDER_STATUS} value={v} /> },
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
      width: 120,
      fixed: 'right',
      render: (_, r) =>
        r.status === 'DONE' ? (
          <Button size="small" onClick={() => setViewing(r)}>Xem báo cáo</Button>
        ) : (
          <Button size="small" type={r.assignedTo ? 'default' : 'primary'} onClick={() => setAssigning(r)}>
            {r.assignedTo ? 'Giao lại' : 'Phân công'}
          </Button>
        ),
    },
  ];

  const techColumns = [
    assetColumn,
    ...commonColumns,
    ...(tab === 'done'
      ? [
          { title: 'Hoàn thành', dataIndex: 'completedAt', width: 160, render: formatDateTime },
          { title: 'Kết quả', dataIndex: 'note', width: 260, render: (v) => v || '—' },
          {
            title: '',
            width: 130,
            fixed: 'right',
            render: (_, r) => <Button size="small" onClick={() => setViewing(r)}>Xem báo cáo</Button>,
          },
        ]
      : [
          { title: 'Được giao lúc', dataIndex: 'assignedAt', width: 160, render: formatDateTime },
          {
            title: '',
            width: 130,
            fixed: 'right',
            render: (_, r) =>
              r.status === 'PENDING' ? (
                <Popconfirm
                  title="Bắt đầu xử lý work order này?"
                  onConfirm={() => start(r._id).catch(() => {})}
                  okText="Bắt đầu"
                  cancelText="Hủy"
                >
                  <Button size="small" type="primary">Bắt đầu</Button>
                </Popconfirm>
              ) : (
                <Button size="small" type="primary" onClick={() => setCompleting(r)}>Hoàn thành</Button>
              ),
          },
        ]),
  ];

  return (
    <>
      <PageHeader
        title={isTech ? 'Work order của tôi' : 'Work order'}
        subtitle={
          isTech
            ? 'Công việc bảo trì được giao cho bạn.'
            : 'Công việc bảo trì tài sản chung — phân công và theo dõi kỹ thuật viên.'
        }
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: isTech ? 'Work order của tôi' : 'Work order' }]}
      />
      <Card>
        {isTech && (
          <Tabs
            activeKey={tab}
            onChange={changeTab}
            items={[
              { key: 'open', label: 'Đang mở' },
              { key: 'done', label: 'Đã xong' },
            ]}
          />
        )}
        <Flex gap={8} wrap style={{ marginBottom: 12 }}>
          <Input.Search placeholder="Tên tài sản" allowClear style={{ width: 200 }} onSearch={(q) => set({ q: q || undefined })} />
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
          {(!isTech || tab === 'open') && (
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
        {completing && (
          <CompleteWorkOrderModal workOrder={completing} open onClose={() => setCompleting(null)} onDone={reload} />
        )}
        {viewing && <WorkOrderReportModal workOrder={viewing} open onClose={() => setViewing(null)} />}
      </Card>
    </>
  );
}

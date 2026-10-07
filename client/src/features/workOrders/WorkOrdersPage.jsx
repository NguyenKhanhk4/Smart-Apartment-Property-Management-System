import { useState } from 'react';
import { Link } from 'react-router';
import { Button, Card, Flex, Input, Select, Switch, Table, Tag, Typography } from 'antd';
import { workOrderApi } from '../../api/moduleD.api';
import { lookupApi } from '../../api/moduleE.api';
import { useApi } from '../../hooks/useApi';
import EnumTag from '../../components/EnumTag';
import PageHeader from '../../components/PageHeader';
import { WORK_ORDER_STATUS, WORK_ORDER_TYPES, enumOptions } from '../../constants/enums';
import { formatDate } from '../../utils/format';
import { vtName } from '../../motion/viewTransition';
import AssignWorkOrderModal from './AssignWorkOrderModal';

const UNASSIGNED = 'UNASSIGNED';

// UC-D03 — Danh sách work order, Manager phân công / giao lại kỹ thuật viên
export default function WorkOrdersPage() {
  const [filters, setFilters] = useState({ page: 1, limit: 20 });
  const [assigning, setAssigning] = useState(null);
  const set = (patch) => setFilters((f) => ({ ...f, page: 1, ...patch }));

  const { data = [], pagination, loading, reload } = useApi(() => workOrderApi.list(filters), [filters]);
  const { data: buildings = [] } = useApi(() => lookupApi.buildings(), []);
  const { data: techs = [] } = useApi(() => workOrderApi.assignees(), []);

  const columns = [
    {
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
    },
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
        r.status !== 'DONE' && (
          <Button size="small" type={r.assignedTo ? 'default' : 'primary'} onClick={() => setAssigning(r)}>
            {r.assignedTo ? 'Giao lại' : 'Phân công'}
          </Button>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Work order"
        subtitle="Công việc bảo trì tài sản chung — phân công và theo dõi kỹ thuật viên."
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Work order' }]}
      />
      <Card>
        <Flex gap={8} wrap style={{ marginBottom: 12 }}>
          <Input.Search placeholder="Tên tài sản" allowClear style={{ width: 200 }} onSearch={(q) => set({ q: q || undefined })} />
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
          <Flex align="center" gap={6}>
            <Switch size="small" onChange={(on) => set({ overdue: on || undefined })} />
            <span>Quá hạn</span>
          </Flex>
        </Flex>
        <Table
          rowKey="_id"
          size="middle"
          loading={loading}
          dataSource={data}
          columns={columns}
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
      </Card>
    </>
  );
}

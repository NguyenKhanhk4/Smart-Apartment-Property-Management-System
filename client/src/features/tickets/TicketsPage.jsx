import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
<<<<<<< HEAD
import { App, Button, Card, Flex, Input, Select, Switch, Table, Tabs, Tooltip, Typography } from 'antd';
import { AppstoreOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
=======
import { App, Button, Card, Flex, Input, Select, Switch, Table, Tooltip, Typography } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
>>>>>>> origin/minh
import { complaintCategoryApi, ticketApi } from '../../api/moduleE.api';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import EnumTag from '../../components/EnumTag';
<<<<<<< HEAD
import {
  PRIORITIES,
  TICKET_OPEN_STATUSES,
  TICKET_SCOPES,
  TICKET_STATUS,
  TICKET_TYPES,
  enumOptions,
} from '../../constants/enums';
import { formatDateTime } from '../../utils/format';
import { AssignModal } from './TicketActionModals';
import TicketCreateModal from './TicketCreateModal';
import TicketQueue from './TicketQueue';
import { ticketActions } from './ticketActions';

// UC-E03 (Trưởng BQL / Lễ tân: tất cả + quá hạn + phân công; Lễ tân tạo hộ), UC-E04 (KTV: hàng chờ ca + phiếu được giao)
export default function TicketsPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { user, hasRole } = useAuth();
  const isDispatcher = hasRole('MANAGER', 'STAFF:RECEPTIONIST');
  const isTech = hasRole('STAFF:TECHNICIAN');
  const [tab, setTab] = useState('queue');
  const [filters, setFilters] = useState({ page: 1, limit: 20, status: isDispatcher ? undefined : TICKET_OPEN_STATUSES });
  const [assigning, setAssigning] = useState(null);
  const [creating, setCreating] = useState(false);
=======
import { PRIORITIES, TICKET_STATUS, enumOptions } from '../../constants/enums';
import { formatDateTime } from '../../utils/format';
import { AssignModal } from './TicketActionModals';

const OPEN = ['NEW', 'ASSIGNED', 'IN_PROGRESS'];

// UC-E03 (Manager/Lễ tân: tất cả + quá hạn + phân công), UC-E04 (KTV: ticket được giao)
export default function TicketsPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { hasRole } = useAuth();
  const isDispatcher = hasRole('MANAGER', 'STAFF:RECEPTIONIST');
  const [filters, setFilters] = useState({ page: 1, limit: 20, status: isDispatcher ? undefined : OPEN });
  const [assigning, setAssigning] = useState(null);
>>>>>>> origin/minh
  const [running, setRunning] = useState(false);

  const params = useMemo(
    () => ({ ...filters, status: filters.status?.length ? filters.status.join(',') : undefined }),
    [filters],
  );
  const { data = [], pagination, loading, reload } = useApi(() => ticketApi.list(params), [params]);
  const { data: categories = [] } = useApi(() => complaintCategoryApi.list(), []);
  const set = (patch) => setFilters((f) => ({ ...f, page: 1, ...patch }));

  const runEscalation = async () => {
    setRunning(true);
    try {
      const { data: run } = await ticketApi.runJob('escalate');
<<<<<<< HEAD
      message.success(`Đã chạy leo thang: ${run.affectedCount} phiếu`);
=======
      message.success(`Đã chạy leo thang: ${run.affectedCount} phản ánh`);
>>>>>>> origin/minh
      reload();
    } catch (e) {
      message.error(e.message);
    } finally {
      setRunning(false);
    }
  };

  const columns = [
    { title: 'Mã', dataIndex: 'code', width: 150 },
    {
      title: 'Tiêu đề',
      dataIndex: 'title',
      render: (v, r) => (
        <Flex vertical>
          <Typography.Text strong>{v}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {r.category?.name} · Căn {r.apartmentId?.code}
          </Typography.Text>
        </Flex>
      ),
    },
<<<<<<< HEAD
    {
      title: 'Loại',
      dataIndex: 'type',
      width: 150,
      render: (v, r) => (
        <Flex vertical gap={2} align="start">
          <EnumTag map={TICKET_TYPES} value={v} />
          {v !== 'COMPLAINT' && r.scope === 'IN_APARTMENT' && <EnumTag map={TICKET_SCOPES} value={r.scope} />}
        </Flex>
      ),
    },
    { title: 'Ưu tiên', dataIndex: 'priority', width: 110, render: (v) => <EnumTag map={PRIORITIES} value={v} /> },
    { title: 'Trạng thái', dataIndex: 'status', width: 140, render: (v) => <EnumTag map={TICKET_STATUS} value={v} /> },
=======
    { title: 'Ưu tiên', dataIndex: 'priority', width: 110, render: (v) => <EnumTag map={PRIORITIES} value={v} /> },
    { title: 'Trạng thái', dataIndex: 'status', width: 130, render: (v) => <EnumTag map={TICKET_STATUS} value={v} /> },
>>>>>>> origin/minh
    { title: 'Kỹ thuật viên', dataIndex: ['assignedTo', 'fullName'], width: 160, render: (v) => v ?? '—' },
    {
      title: 'Hạn xử lý',
      dataIndex: 'dueDate',
      width: 160,
<<<<<<< HEAD
      render: (v, r) => <Typography.Text type={r.isOverdue ? 'danger' : undefined}>{formatDateTime(v)}</Typography.Text>,
=======
      render: (v, r) => {
        const overdue = OPEN.includes(r.status) && dayjs(v).isBefore(dayjs());
        return <Typography.Text type={overdue ? 'danger' : undefined}>{formatDateTime(v)}</Typography.Text>;
      },
>>>>>>> origin/minh
    },
    ...(isDispatcher
      ? [
          {
            title: '',
            width: 110,
            render: (_, r) =>
<<<<<<< HEAD
              ticketActions(r, user, hasRole).canAssign && (
=======
              OPEN.includes(r.status) && (
>>>>>>> origin/minh
                <Button
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAssigning(r);
                  }}
                >
                  {r.assignedTo ? 'Giao lại' : 'Phân công'}
                </Button>
              ),
          },
        ]
      : []),
  ];

<<<<<<< HEAD
  const list = (
    <>
      <Flex gap={8} wrap style={{ marginBottom: 12 }}>
        <Input.Search placeholder="Mã / tiêu đề" allowClear style={{ width: 220 }} onSearch={(q) => set({ q: q || undefined })} />
        {isDispatcher && (
          <Select
            allowClear
            placeholder="Loại phiếu"
            style={{ width: 150 }}
            options={enumOptions(TICKET_TYPES)}
            onChange={(type) => set({ type })}
          />
        )}
=======
  return (
    <Card
      title={isDispatcher ? 'Quản lý phản ánh' : 'Phản ánh được giao'}
      extra={
        hasRole('MANAGER') && (
          <Tooltip title="Chạy ngay job leo thang ticket quá hạn (bình thường chạy lúc 09:00)">
            <Button icon={<ThunderboltOutlined />} loading={running} onClick={runEscalation}>
              Leo thang ngay
            </Button>
          </Tooltip>
        )
      }
    >
      <Flex gap={8} wrap style={{ marginBottom: 12 }}>
        <Input.Search
          placeholder="Mã / tiêu đề"
          allowClear
          style={{ width: 220 }}
          onSearch={(q) => set({ q: q || undefined })}
        />
>>>>>>> origin/minh
        <Select
          mode="multiple"
          allowClear
          placeholder="Trạng thái"
          style={{ minWidth: 200 }}
          value={filters.status}
          options={enumOptions(TICKET_STATUS)}
          onChange={(status) => set({ status })}
        />
<<<<<<< HEAD
        <Select allowClear placeholder="Ưu tiên" style={{ width: 130 }} options={enumOptions(PRIORITIES)} onChange={(priority) => set({ priority })} />
        <Select
          allowClear
          placeholder="Danh mục"
=======
        <Select
          allowClear
          placeholder="Ưu tiên"
          style={{ width: 130 }}
          options={enumOptions(PRIORITIES)}
          onChange={(priority) => set({ priority })}
        />
        <Select
          allowClear
          placeholder="Loại phản ánh"
>>>>>>> origin/minh
          style={{ width: 160 }}
          options={categories.map((c) => ({ value: c._id, label: c.name }))}
          onChange={(categoryId) => set({ categoryId })}
        />
        <Flex align="center" gap={6}>
          <Switch size="small" onChange={(overdue) => set({ overdue: overdue || undefined })} />
          <span>Chỉ quá hạn</span>
        </Flex>
      </Flex>
      <Table
        rowKey="_id"
        size="middle"
        loading={loading}
        dataSource={data}
        columns={columns}
<<<<<<< HEAD
        scroll={{ x: 1000 }}
=======
        scroll={{ x: 900 }}
>>>>>>> origin/minh
        onRow={(r) => ({ onClick: () => navigate(`/app/tickets/${r._id}`), style: { cursor: 'pointer' } })}
        pagination={{
          current: filters.page,
          pageSize: filters.limit,
          total: pagination?.total,
          showSizeChanger: true,
          onChange: (page, limit) => setFilters((f) => ({ ...f, page, limit })),
        }}
      />
<<<<<<< HEAD
    </>
  );

  return (
    <Card
      title={isDispatcher ? 'Sự cố & phản ánh' : 'Sự cố của tôi'}
      extra={
        <Flex gap={8} wrap>
          {hasRole('STAFF:RECEPTIONIST') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              Tạo giúp cư dân
            </Button>
          )}
          {hasRole('MANAGER') && (
            <>
              <Button icon={<AppstoreOutlined />} onClick={() => navigate('/app/ticket-board')}>
                Bảng điều phối
              </Button>
              <Tooltip title="Chạy ngay job leo thang phiếu quá hạn (bình thường chạy lúc 09:00)">
                <Button icon={<ThunderboltOutlined />} loading={running} onClick={runEscalation}>
                  Leo thang ngay
                </Button>
              </Tooltip>
            </>
          )}
        </Flex>
      }
    >
      {isTech ? (
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            { key: 'queue', label: 'Hàng chờ ca', children: <TicketQueue onClaimed={reload} /> },
            { key: 'mine', label: 'Được giao cho tôi', children: list },
          ]}
        />
      ) : (
        list
      )}
      {assigning && <AssignModal ticket={assigning} open onClose={() => setAssigning(null)} onDone={reload} />}
      <TicketCreateModal
        staff
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          reload();
        }}
      />
=======
      {assigning && (
        <AssignModal ticket={assigning} open onClose={() => setAssigning(null)} onDone={reload} />
      )}
>>>>>>> origin/minh
    </Card>
  );
}

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { App, Button, Card, Flex, Input, Select, Switch, Table, Tooltip, Typography } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { complaintCategoryApi, ticketApi } from '../../api/moduleE.api';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import EnumTag from '../../components/EnumTag';
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
      message.success(`Đã chạy leo thang: ${run.affectedCount} phản ánh`);
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
    { title: 'Ưu tiên', dataIndex: 'priority', width: 110, render: (v) => <EnumTag map={PRIORITIES} value={v} /> },
    { title: 'Trạng thái', dataIndex: 'status', width: 130, render: (v) => <EnumTag map={TICKET_STATUS} value={v} /> },
    { title: 'Kỹ thuật viên', dataIndex: ['assignedTo', 'fullName'], width: 160, render: (v) => v ?? '—' },
    {
      title: 'Hạn xử lý',
      dataIndex: 'dueDate',
      width: 160,
      render: (v, r) => {
        const overdue = OPEN.includes(r.status) && dayjs(v).isBefore(dayjs());
        return <Typography.Text type={overdue ? 'danger' : undefined}>{formatDateTime(v)}</Typography.Text>;
      },
    },
    ...(isDispatcher
      ? [
          {
            title: '',
            width: 110,
            render: (_, r) =>
              OPEN.includes(r.status) && (
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
        <Select
          mode="multiple"
          allowClear
          placeholder="Trạng thái"
          style={{ minWidth: 200 }}
          value={filters.status}
          options={enumOptions(TICKET_STATUS)}
          onChange={(status) => set({ status })}
        />
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
        scroll={{ x: 900 }}
        onRow={(r) => ({ onClick: () => navigate(`/app/tickets/${r._id}`), style: { cursor: 'pointer' } })}
        pagination={{
          current: filters.page,
          pageSize: filters.limit,
          total: pagination?.total,
          showSizeChanger: true,
          onChange: (page, limit) => setFilters((f) => ({ ...f, page, limit })),
        }}
      />
      {assigning && (
        <AssignModal ticket={assigning} open onClose={() => setAssigning(null)} onDone={reload} />
      )}
    </Card>
  );
}

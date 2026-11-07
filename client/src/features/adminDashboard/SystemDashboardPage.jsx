import { useMemo } from 'react';
import {
  Button,
  Card,
  Col,
  Flex,
  Progress,
  Row,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { adminApi } from '../../api/moduleA.api';
import PageHeader from '../../components/PageHeader';
import { useApi } from '../../hooks/useApi';
import { formatDateTime, formatPercent } from '../../utils/format';
import { CHART_COLORS } from '../reports/chartColors';
import { ChartCard, StatCard, StatRow } from '../reports/components';

const JOB_LABELS = {
  CONTRACT_EXPIRE: 'Quét hợp đồng thuê hết hạn',
  INVOICE_GENERATE: 'Tạo hóa đơn định kỳ',
  INVOICE_OVERDUE: 'Quét hóa đơn quá hạn',
  PAYMENT_REMIND: 'Nhắc thanh toán hóa đơn',
  DEBT_CLASSIFY: 'Phân loại nợ xấu',
};

function formatRoleLabel(item) {
  if (item.role === 'ADMIN') return 'Quản trị viên';
  if (item.role === 'RESIDENT') return 'Cư dân';
  if (item.role === 'STAFF') {
    const titles = {
      MANAGER: 'Ban quản lý',
      RECEPTIONIST: 'Lễ tân',
      ACCOUNTANT: 'Kế toán',
      TECHNICIAN: 'Kỹ thuật',
    };
    return titles[item.roleTitle] || (item.roleTitle ? `NV ${item.roleTitle}` : 'Nhân viên');
  }
  if (item.role === 'BOARD') {
    const titles = {
      CHAIRMAN: 'Trưởng BQT',
      VICE_CHAIRMAN: 'Phó BQT',
      MEMBER: 'Thành viên BQT',
    };
    return titles[item.boardTitle] || (item.boardTitle ? `BQT ${item.boardTitle}` : 'Ban quản trị');
  }
  return item.role;
}

/**
 * UC-A11: Dashboard thống kê hệ thống dành cho Admin
 * Không chứa bất kỳ dữ liệu tài chính hoặc số tiền nào (BR-R6).
 */
export default function SystemDashboardPage() {
  const { data, loading, reload } = useApi(() => adminApi.getDashboard(), []);

  const { totalActive, totalLocked, totalAccounts, roleChartData } = useMemo(() => {
    const byRole = data?.accounts?.byRole || [];
    const active = byRole.reduce((sum, item) => sum + (item.active || 0), 0);
    const locked = byRole.reduce((sum, item) => sum + (item.locked || 0), 0);
    const chartData = byRole.map((item) => ({
      name: formatRoleLabel(item),
      active: item.active || 0,
      locked: item.locked || 0,
      total: (item.active || 0) + (item.locked || 0),
    }));
    return {
      totalActive: active,
      totalLocked: locked,
      totalAccounts: active + locked,
      roleChartData: chartData,
    };
  }, [data]);

  const auditPerDayData = useMemo(() => {
    return (data?.audit?.perDay || []).map((item) => ({
      date: item.date,
      count: item.count,
    }));
  }, [data]);

  const newPerMonthData = useMemo(() => {
    return (data?.accounts?.newPerMonth || []).map((item) => ({
      month: item.month,
      count: item.count,
    }));
  }, [data]);

  const cronJobsData = useMemo(() => {
    return data?.system?.jobs || [];
  }, [data]);

  const topActionsData = useMemo(() => {
    return (data?.audit?.topActions || []).map((item, idx) => ({
      key: item.action || idx,
      index: idx + 1,
      action: item.action,
      count: item.count,
    }));
  }, [data]);

  const topUsersData = useMemo(() => {
    return (data?.audit?.topUsers || []).map((item, idx) => ({
      key: item.userId || idx,
      index: idx + 1,
      fullName: item.fullName || 'Người dùng hệ thống',
      count: item.count,
    }));
  }, [data]);

  const cronColumns = [
    {
      title: 'Tác vụ (Job)',
      dataIndex: 'jobName',
      key: 'jobName',
      render: (name) => (
        <Flex vertical>
          <Typography.Text strong>{JOB_LABELS[name] || name}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>
            {name}
          </Typography.Text>
        </Flex>
      ),
    },
    {
      title: 'Lần chạy cuối',
      dataIndex: 'lastStatus',
      key: 'lastStatus',
      width: 140,
      render: (status) => {
        if (status === 'SUCCESS') {
          return (
            <Tag icon={<CheckCircleOutlined />} color="success">
              Thành công
            </Tag>
          );
        }
        if (status === 'FAILED') {
          return (
            <Tag icon={<CloseCircleOutlined />} color="error">
              Thất bại
            </Tag>
          );
        }
        return (
          <Tag icon={<ClockCircleOutlined />} color="default">
            Chưa chạy
          </Tag>
        );
      },
    },
    {
      title: 'Thời điểm hoàn thành',
      dataIndex: 'lastRunAt',
      key: 'lastRunAt',
      width: 180,
      render: (d) => formatDateTime(d),
    },
    {
      title: 'Bản ghi xử lý',
      dataIndex: 'lastAffected',
      key: 'lastAffected',
      align: 'right',
      width: 130,
      render: (val) => (val !== null && val !== undefined ? val : '—'),
    },
    {
      title: 'Lỗi gần nhất',
      dataIndex: 'lastError',
      key: 'lastError',
      ellipsis: true,
      render: (err) =>
        err ? (
          <Typography.Text type="danger" ellipsis={{ tooltip: err }}>
            {err}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: 'Lỗi 7 ngày qua',
      dataIndex: 'failedLast7Days',
      key: 'failedLast7Days',
      align: 'center',
      width: 140,
      render: (cnt) =>
        cnt > 0 ? (
          <Tag color="warning">{cnt} lần</Tag>
        ) : (
          <Tag color="default">0</Tag>
        ),
    },
  ];

  const topActionColumns = [
    { title: '#', dataIndex: 'index', width: 40, align: 'center' },
    {
      title: 'Hành động',
      dataIndex: 'action',
      render: (action) => <Tag color="blue">{action}</Tag>,
    },
    {
      title: 'Số lượt',
      dataIndex: 'count',
      align: 'right',
      width: 90,
      render: (cnt) => <Typography.Text strong>{cnt}</Typography.Text>,
    },
  ];

  const topUserColumns = [
    { title: '#', dataIndex: 'index', width: 40, align: 'center' },
    {
      title: 'Người thực hiện',
      dataIndex: 'fullName',
      render: (name) => <Typography.Text strong>{name}</Typography.Text>,
    },
    {
      title: 'Số thao tác',
      dataIndex: 'count',
      align: 'right',
      width: 100,
      render: (cnt) => <Typography.Text strong>{cnt}</Typography.Text>,
    },
  ];

  const baseData = data?.baseData;
  const vacantCount = baseData?.byStatus?.VACANT || 0;
  const ownedCount = baseData?.byStatus?.OWNED || 0;
  const rentedCount = baseData?.byStatus?.RENTED || 0;
  const totalApt = baseData?.apartments || 0;

  return (
    <Flex vertical gap={16}>
      <PageHeader
        title="Dashboard hệ thống"
        subtitle="Thống kê tổng quan tài khoản, căn hộ, tác vụ nền và nhật ký hoạt động (BR-R6: không chứa số liệu tài chính)"
        breadcrumb={[
          { label: 'Trang chủ', path: '/app/home' },
          { label: 'Dashboard hệ thống' },
        ]}
        extra={
          <Button icon={<ReloadOutlined />} loading={loading} onClick={reload}>
            Làm mới
          </Button>
        }
      />

      <Spin spinning={loading && !data}>
        <Flex vertical gap={16}>
          {/* 1. Hàng thẻ số tổng quan */}
          <StatRow>
            <StatCard
              title="Tài khoản hoạt động"
              value={totalActive}
              color="#389e0d"
              hint={`${totalAccounts} tổng số tài khoản`}
            />
            <StatCard
              title="Tài khoản bị khóa"
              value={totalLocked}
              color={totalLocked > 0 ? '#cf1322' : undefined}
              hint={totalLocked > 0 ? 'Cần xem xét mở khóa' : 'Không có tài khoản bị khóa'}
            />
            <StatCard
              title="Tổng số căn hộ"
              value={totalApt}
              hint={`${baseData?.buildings || 0} tòa nhà hiện có`}
            />
            <StatCard
              title="Tỷ lệ lấp đầy"
              value={formatPercent(baseData?.occupancyRate)}
              color="#1677ff"
              hint={`${ownedCount} đã bán · ${rentedCount} thuê · ${vacantCount} trống`}
            />
            <StatCard
              title="Tệp đính kèm lưu trữ"
              value={data?.system?.uploadedFiles ?? 0}
              color="#722ed1"
              hint="Ảnh đại diện & file hợp đồng"
            />
          </StatRow>

          {/* 2. Biểu đồ tài khoản theo vai trò & Biểu đồ audit log */}
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <ChartCard
                title="Tài khoản theo vai trò"
                empty={!roleChartData.length}
                height={280}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={roleChartData} margin={{ top: 10, right: 10, left: -10, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" interval={0} angle={-15} textAnchor="end" height={40} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Legend verticalAlign="top" height={36} />
                    <Bar dataKey="active" name="Đang hoạt động" fill={CHART_COLORS[0]} stackId="a" />
                    <Bar dataKey="locked" name="Bị khóa" fill={CHART_COLORS[3]} stackId="a" />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </Col>

            <Col xs={24} lg={12}>
              <ChartCard
                title="Lượt thao tác hệ thống (30 ngày qua)"
                empty={!auditPerDayData.length}
                height={280}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={auditPerDayData} margin={{ top: 10, right: 10, left: -10, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(val) => (val ? val.slice(5) : '')}
                      interval={4}
                    />
                    <YAxis allowDecimals={false} />
                    <Tooltip labelFormatter={(val) => `Ngày ${val}`} />
                    <Line
                      type="monotone"
                      dataKey="count"
                      name="Lượt thao tác"
                      stroke={CHART_COLORS[1]}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            </Col>
          </Row>

          {/* 3. Tăng trưởng tài khoản mới & Tỷ lệ trạng thái căn hộ */}
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <ChartCard
                title="Tài khoản mới tạo (6 tháng gần nhất)"
                empty={!newPerMonthData.length}
                height={240}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={newPerMonthData} margin={{ top: 10, right: 10, left: -10, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="month" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" name="Số tài khoản mới" fill={CHART_COLORS[4]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </Col>

            <Col xs={24} lg={12}>
              <Card size="small" title="Phân bố trạng thái căn hộ" style={{ height: '100%' }}>
                <Flex vertical gap={16} style={{ padding: '8px 0' }}>
                  <div>
                    <Flex justify="space-between">
                      <Typography.Text strong>Đã bàn giao / Đang sở hữu</Typography.Text>
                      <Typography.Text type="secondary">
                        {ownedCount} / {totalApt} căn
                      </Typography.Text>
                    </Flex>
                    <Progress
                      percent={totalApt > 0 ? Math.round((ownedCount / totalApt) * 100) : 0}
                      strokeColor={CHART_COLORS[0]}
                    />
                  </div>

                  <div>
                    <Flex justify="space-between">
                      <Typography.Text strong>Đang cho thuê</Typography.Text>
                      <Typography.Text type="secondary">
                        {rentedCount} / {totalApt} căn
                      </Typography.Text>
                    </Flex>
                    <Progress
                      percent={totalApt > 0 ? Math.round((rentedCount / totalApt) * 100) : 0}
                      strokeColor={CHART_COLORS[1]}
                    />
                  </div>

                  <div>
                    <Flex justify="space-between">
                      <Typography.Text strong>Căn hộ trống</Typography.Text>
                      <Typography.Text type="secondary">
                        {vacantCount} / {totalApt} căn
                      </Typography.Text>
                    </Flex>
                    <Progress
                      percent={totalApt > 0 ? Math.round((vacantCount / totalApt) * 100) : 0}
                      strokeColor="#d9d9d9"
                    />
                  </div>
                </Flex>
              </Card>
            </Col>
          </Row>

          {/* 4. Bảng trạng thái Cron Jobs */}
          <Card size="small" title="Tác vụ nền định kỳ (Cron Jobs)">
            <Table
              size="small"
              rowKey="jobName"
              columns={cronColumns}
              dataSource={cronJobsData}
              pagination={false}
            />
          </Card>

          {/* 5. Top 5 Actions & Top 5 Users */}
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <Card size="small" title="Top 5 hành động hệ thống (30 ngày)">
                <Table
                  size="small"
                  rowKey="key"
                  columns={topActionColumns}
                  dataSource={topActionsData}
                  pagination={false}
                />
              </Card>
            </Col>

            <Col xs={24} lg={12}>
              <Card size="small" title="Top 5 người dùng thao tác nhiều nhất (30 ngày)">
                <Table
                  size="small"
                  rowKey="key"
                  columns={topUserColumns}
                  dataSource={topUsersData}
                  pagination={false}
                />
              </Card>
            </Col>
          </Row>
        </Flex>
      </Spin>
    </Flex>
  );
}

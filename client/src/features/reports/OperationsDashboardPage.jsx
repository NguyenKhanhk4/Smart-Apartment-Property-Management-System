import { useMemo, useState } from 'react';
import { Card, DatePicker, Flex, Progress, Rate, Select, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { lookupApi, reportApi } from '../../api/moduleE.api';
import { useApi } from '../../hooks/useApi';
import { PRIORITIES, TICKET_STATUS } from '../../constants/enums';
import { formatDate, formatPercent } from '../../utils/format';
import { CHART_COLORS } from './chartColors';
import { ChartCard, ExportButton, StatCard, StatRow } from './components';

const STATUS_COLOR = { NEW: '#1677ff', ASSIGNED: '#13c2c2', IN_PROGRESS: '#722ed1', WAITING_CONFIRM: '#faad14', CLOSED: '#52c41a', REJECTED: '#bfbfbf' };
const PRIORITY_COLOR = { LOW: '#bfbfbf', MEDIUM: '#1677ff', HIGH: '#fa8c16', URGENT: '#f5222d' };

// UC-E12 — Dashboard vận hành: lấp đầy, phản ánh, bảo trì (không có số liệu tài chính — BR-R6)
export default function OperationsDashboardPage() {
  const [range, setRange] = useState([dayjs().startOf('year'), dayjs()]);
  const [buildingId, setBuildingId] = useState();
  const params = useMemo(
    () => ({ from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD'), buildingId }),
    [range, buildingId],
  );
  const { data: buildings = [] } = useApi(() => lookupApi.buildings(), []);
  const occ = useApi(() => reportApi.occupancy({ buildingId }), [buildingId]).data;
  const tk = useApi(() => reportApi.tickets(params), [params]).data;
  const mt = useApi(() => reportApi.maintenance(params), [params]).data;

  const statusData = Object.entries(tk?.byStatus ?? {}).map(([k, v]) => ({ key: k, name: TICKET_STATUS[k]?.label ?? k, value: v }));
  const priorityData = Object.keys(PRIORITIES).map((k) => ({ key: k, name: PRIORITIES[k].label, value: tk?.byPriority?.[k] ?? 0 }));

  return (
    <Flex vertical gap={12}>
      <Card size="small">
        <Flex gap={8} wrap justify="space-between">
          <Flex gap={8} wrap>
            <DatePicker.RangePicker value={range} format="DD/MM/YYYY" allowClear={false} onChange={(v) => v && setRange(v)} />
            <Select allowClear placeholder="Tất cả tòa" style={{ width: 150 }} value={buildingId} onChange={setBuildingId}
              options={buildings.map((b) => ({ value: b._id, label: b.name }))} />
          </Flex>
          <ExportButton type="operations" params={params} />
        </Flex>
      </Card>

      <StatRow>
        <StatCard title="Tỷ lệ lấp đầy" value={formatPercent(occ?.occupancyRate)} hint={`${(occ?.owned ?? 0) + (occ?.rented ?? 0)}/${occ?.total ?? 0} căn có người ở`} />
        <StatCard title="Phản ánh trong kỳ" value={tk?.total} hint={`${tk?.open ?? 0} đang mở · ${tk?.waitingConfirm ?? 0} chờ xác nhận`} />
        <StatCard title="Phản ánh quá hạn" value={tk?.overdue} color={tk?.overdue ? '#cf1322' : undefined} hint="Đang mở và đã qua hạn xử lý" />
        <StatCard title="Thời gian xử lý TB" value={tk?.avgResolutionHours} suffix="giờ" hint={`Đúng hạn ${formatPercent(tk?.onTimeRate)}`} />
        <StatCard title="Đánh giá TB" value={tk?.avgRating} suffix="/ 5" hint={`${tk?.ratedCount ?? 0} lượt đánh giá`} />
      </StatRow>

      <Flex gap={12} wrap>
        <Card size="small" title="Lấp đầy theo tòa" style={{ flex: '1 1 320px' }}>
          <Flex vertical gap={12}>
            {occ?.byBuilding?.map((b) => (
              <div key={b.buildingId}>
                <Flex justify="space-between">
                  <Typography.Text strong>{b.buildingName}</Typography.Text>
                  <Typography.Text type="secondary">
                    Sở hữu {b.owned} · Thuê {b.rented} · Trống {b.vacant}
                  </Typography.Text>
                </Flex>
                <Progress percent={Math.round(b.occupancyRate * 100)} />
              </div>
            ))}
          </Flex>
        </Card>
        <ChartCard title="Phản ánh theo trạng thái" empty={!statusData.length} height={260}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} label={({ name, value }) => `${name}: ${value}`}>
                {statusData.map((d) => <Cell key={d.key} fill={STATUS_COLOR[d.key]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Phản ánh theo mức ưu tiên" empty={!tk?.total} height={260}>
          <ResponsiveContainer>
            <BarChart data={priorityData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value" name="Số phản ánh">
                {priorityData.map((d) => <Cell key={d.key} fill={PRIORITY_COLOR[d.key]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </Flex>

      <Flex gap={12} wrap>
        <Card size="small" title="Kỹ thuật viên" style={{ flex: '1 1 420px' }}>
          <Table
            rowKey="userId"
            size="small"
            pagination={false}
            dataSource={tk?.technicians}
            columns={[
              { title: 'Họ tên', dataIndex: 'fullName' },
              { title: 'Được giao', dataIndex: 'assigned', align: 'right' },
              { title: 'Đã đóng', dataIndex: 'closed', align: 'right' },
              { title: 'Đánh giá TB', dataIndex: 'avgRating', render: (v) => (v ? <><Rate disabled allowHalf value={v} style={{ fontSize: 12 }} /> {v}</> : '—') },
            ]}
          />
        </Card>
        <ChartCard title="Phản ánh theo loại" empty={!tk?.byCategory?.length} height={240} style={{ flex: '1 1 360px' }}>
          <ResponsiveContainer>
            <BarChart data={tk?.byCategory ?? []} layout="vertical" margin={{ left: 24 }}>
              <XAxis type="number" allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={80} />
              <Tooltip />
              <Bar dataKey="count" name="Số phản ánh">
                {(tk?.byCategory ?? []).map((d, i) => <Cell key={d.categoryId} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </Flex>

      <Card size="small" title="Bảo trì thiết bị">
        <StatRow>
          <StatCard title="Work order trong kỳ" value={mt?.total} />
          <StatCard title="Hoàn thành" value={mt?.done} />
          <StatCard title="Đúng hạn / Trễ hạn" value={`${mt?.onTime ?? 0} / ${mt?.late ?? 0}`} hint={`Tỷ lệ đúng hạn ${formatPercent(mt?.onTimeRate)}`} />
          <StatCard title="Đang chờ / đang làm" value={(mt?.byStatus?.PENDING ?? 0) + (mt?.byStatus?.IN_PROGRESS ?? 0)} />
        </StatRow>
        <Typography.Title level={5} style={{ marginTop: 16 }}>
          Tài sản đến hạn bảo trì trong 7 ngày
        </Typography.Title>
        <Table
          rowKey="_id"
          size="small"
          pagination={false}
          dataSource={mt?.upcomingAssets}
          locale={{ emptyText: 'Không có tài sản sắp đến hạn' }}
          columns={[
            { title: 'Tài sản', dataIndex: 'name' },
            { title: 'Tòa', dataIndex: ['buildingId', 'name'] },
            { title: 'Hạn bảo trì', dataIndex: 'nextMaintenanceDate', render: (v, r) => <>{formatDate(v)} {r.overdue && <Tag color="red">Quá hạn</Tag>}</> },
          ]}
        />
      </Card>
    </Flex>
  );
}

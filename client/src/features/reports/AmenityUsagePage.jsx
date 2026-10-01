import { useMemo, useState } from 'react';
import { Card, DatePicker, Flex, Select, Table } from 'antd';
import dayjs from 'dayjs';
import { Bar, BarChart, CartesianGrid, Legend, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { lookupApi, reportApi } from '../../api/moduleE.api';
import { useApi } from '../../hooks/useApi';
import { formatMoney, formatPercent } from '../../utils/format';
import { ChartCard, ExportButton, StatCard, StatRow } from './components';

// UC-E14 — Thống kê sử dụng tiện ích (Manager, Accountant)
export default function AmenityUsagePage() {
  const [range, setRange] = useState([dayjs().startOf('year'), dayjs()]);
  const [amenityId, setAmenityId] = useState();
  const params = useMemo(
    () => ({ from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD'), amenityId }),
    [range, amenityId],
  );
  const { data, loading } = useApi(() => reportApi.amenityUsage(params), [params]);
  const { data: amenities = [] } = useApi(() => lookupApi.amenities(), []);

  return (
    <Flex vertical gap={12}>
      <Card size="small">
        <Flex gap={8} wrap justify="space-between">
          <Flex gap={8} wrap>
            <DatePicker.RangePicker value={range} format="DD/MM/YYYY" allowClear={false} onChange={(v) => v && setRange(v)} />
            <Select allowClear placeholder="Tất cả tiện ích" style={{ width: 180 }} value={amenityId} onChange={setAmenityId}
              options={amenities.map((a) => ({ value: a._id, label: a.name }))} />
          </Flex>
          <ExportButton type="amenity" params={params} />
        </Flex>
      </Card>

      <StatRow>
        <StatCard title="Tổng lượt đặt" value={data?.total} />
        <StatCard title="Đã sử dụng" value={data?.completed} hint="Booking COMPLETED (BR-O5)" />
        <StatCard title="Tỷ lệ hủy / từ chối" value={`${formatPercent(data?.cancelRate)} / ${formatPercent(data?.rejectRate)}`} />
        <StatCard title="Dùng nhiều nhất" value={data?.mostUsed?.name ?? '—'} hint={data?.peakSlot && `Cao điểm khung ${data.peakSlot}`} />
        <StatCard title="Phí tiện ích phát sinh" value={data?.revenue} formatter={formatMoney} />
      </StatRow>

      <Flex gap={12} wrap>
        <ChartCard title="Lượt đặt theo tiện ích" empty={!data?.byAmenity?.length}>
          <ResponsiveContainer>
            <BarChart data={data?.byAmenity ?? []}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="completed" name="Hoàn thành" stackId="s" fill="#52c41a" />
              <Bar dataKey="approved" name="Đã duyệt" stackId="s" fill="#1677ff" />
              <Bar dataKey="pending" name="Chờ duyệt" stackId="s" fill="#faad14" />
              <Bar dataKey="cancelled" name="Hủy" stackId="s" fill="#bfbfbf" />
              <Bar dataKey="rejected" name="Từ chối" stackId="s" fill="#ff7875" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Khung giờ & tỷ lệ lấp slot" empty={!data?.bySlot?.length}>
          <ResponsiveContainer>
            <ComposedChart data={data?.bySlot ?? []}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="slotStart" />
              <YAxis yAxisId="l" allowDecimals={false} />
              <YAxis yAxisId="r" orientation="right" tickFormatter={(v) => formatPercent(v, 0)} domain={[0, 1]} />
              <Tooltip formatter={(v, name) => (name === 'Tỷ lệ lấp TB' ? formatPercent(v) : v)} />
              <Legend />
              <Bar yAxisId="l" dataKey="bookings" name="Lượt" fill="#1677ff" />
              <Line yAxisId="r" dataKey="avgFillRate" name="Tỷ lệ lấp TB" stroke="#fa8c16" />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      </Flex>

      <Flex gap={12} wrap>
        <Card size="small" title="Chi tiết theo tiện ích" style={{ flex: '2 1 520px' }}>
          <Table
            rowKey="amenityId"
            size="small"
            loading={loading}
            pagination={false}
            scroll={{ x: 640 }}
            dataSource={data?.byAmenity}
            columns={[
              { title: 'Tiện ích', dataIndex: 'name' },
              { title: 'Tổng', dataIndex: 'total', align: 'right' },
              { title: 'Hoàn thành', dataIndex: 'completed', align: 'right' },
              { title: 'Hủy', dataIndex: 'cancelRate', align: 'right', render: (v) => formatPercent(v) },
              { title: 'Từ chối', dataIndex: 'rejectRate', align: 'right', render: (v) => formatPercent(v) },
              { title: 'Phí phát sinh', dataIndex: 'revenue', align: 'right', render: formatMoney },
            ]}
          />
        </Card>
        <Card size="small" title="Căn hộ đặt nhiều nhất" style={{ flex: '1 1 260px' }}>
          <Table
            rowKey="apartmentId"
            size="small"
            pagination={false}
            dataSource={data?.topApartments}
            columns={[
              { title: 'Căn hộ', dataIndex: 'apartmentCode' },
              { title: 'Lượt', dataIndex: 'bookings', align: 'right' },
            ]}
          />
        </Card>
      </Flex>
    </Flex>
  );
}

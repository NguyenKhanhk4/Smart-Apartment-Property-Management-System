import { useMemo, useState } from 'react';
import { Alert, Card, DatePicker, Flex, Progress, Rate, Select, Table, Typography } from 'antd';
import dayjs from 'dayjs';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { lookupApi, reportApi } from '../../api/moduleE.api';
import { useApi } from '../../hooks/useApi';
import { useThemeMode } from '../../hooks/useThemeMode';
import { formatPercent } from '../../utils/format';
import { periodLabel } from '../invoices/invoiceShared';
import { ChartCard, ExportButton, StatCard, StatRow } from './components';
import { chartTheme } from './financeChartTheme';

// Mô đun 9 — UC60 Dashboard vận hành (Trưởng BQL), mục 5.3–5.4: sự cố, phản ánh, bảo trì thiết bị, cư dân, tiện ích.
// Không có số liệu tài chính (BR-R6). Màu: chuỗi số liệu dùng bảng màu đã kiểm định (financeChartTheme), đúng / trễ hạn dùng
// màu trạng thái và luôn có chú thích chữ; bảng bên dưới mỗi biểu đồ thay cho đọc màu.
const pct = (v) => (v == null ? '—' : formatPercent(v));
const num = (v, suffix = '') => (v == null ? '—' : `${v}${suffix}`);

export default function OperationsDashboardPage() {
  const { isDark } = useThemeMode();
  const theme = chartTheme(isDark);
  const [range, setRange] = useState([dayjs().startOf('year'), dayjs()]);
  const [buildingId, setBuildingId] = useState();
  const params = useMemo(
    () => ({ from: range[0].format('YYYY-MM'), to: range[1].format('YYYY-MM'), buildingId }),
    [range, buildingId],
  );
  const { data: buildings = [] } = useApi(() => lookupApi.buildings(), []);
  const { data, loading } = useApi(() => reportApi.operationsKpi(params), [params]);

  const inc = data?.incidents;
  const cp = data?.complaints;
  const mt = data?.maintenance;
  const rs = data?.residents;
  const occ = rs?.occupancy;
  const label = (rows) => (rows ?? []).map((m) => ({ ...m, label: periodLabel(m.period) }));
  const incMonths = label(inc?.byMonth);
  const mtMonths = label(mt?.byMonth).map((m) => ({ ...m, late: m.done - m.onTime, notDone: m.scheduled - m.done }));
  const rsMonths = label(rs?.byMonth);
  const axis = { stroke: theme.grid, tick: { fill: theme.axis, fontSize: 12 } };
  const bar = { isAnimationActive: false };
  const cursor = { fill: theme.grid, opacity: 0.4 };

  return (
    <Flex vertical gap={12}>
      <Card size="small">
        <Flex gap={8} wrap align="center" justify="space-between">
          <Flex gap={8} wrap align="center">
            <Typography.Title level={4} style={{ margin: 0 }}>
              Dashboard vận hành
            </Typography.Title>
            <DatePicker.RangePicker picker="month" value={range} format="MM/YYYY" allowClear={false} onChange={(v) => v && setRange(v)} />
            <Select
              allowClear
              placeholder="Mọi tòa"
              style={{ width: 160 }}
              value={buildingId}
              onChange={setBuildingId}
              options={buildings.map((b) => ({ value: b._id, label: b.name }))}
            />
          </Flex>
          <ExportButton type="operations" params={params} roles={['MANAGER']} />
        </Flex>
      </Card>

      {/* ===== Sự cố kỹ thuật ===== */}
      <Typography.Text strong>Sự cố kỹ thuật</Typography.Text>
      <StatRow>
        <StatCard title="Sự cố trong kỳ" value={inc?.total} hint={`${inc?.open ?? 0} đang mở · ${inc?.inApartment ?? 0} trong căn hộ`} />
        <StatCard
          title="Đang quá hạn"
          value={inc?.overdueNow}
          color={inc?.overdueNow ? theme.status.critical : undefined}
          hint="Tính tới lúc này, đã trừ thời gian tạm dừng"
        />
        <StatCard title="Nhận phiếu đúng hạn" value={pct(inc?.ackOnTimeRate)} />
        <StatCard title="Xử lý đúng hạn" value={pct(inc?.onTimeRate)} hint={`${inc?.onTime ?? 0}/${inc?.resolved ?? 0} phiếu đã xử lý xong`} />
        <StatCard title="Thời gian xử lý TB" value={num(inc?.avgResolutionHours, ' giờ')} />
        <StatCard title="Đánh giá TB" value={num(inc?.avgRating, ' ★')} hint={`${inc?.rated ?? 0} lượt đánh giá`} />
      </StatRow>

      <Flex gap={12} wrap>
        <ChartCard title="Sự cố theo tháng" empty={!incMonths.some((m) => m.created || m.resolved)} style={{ flex: '2 1 520px' }}>
          <ResponsiveContainer>
            <BarChart data={incMonths} barGap={4} barCategoryGap="24%">
              <CartesianGrid vertical={false} stroke={theme.grid} />
              <XAxis dataKey="label" {...axis} tickLine={false} />
              <YAxis allowDecimals={false} width={36} {...axis} axisLine={false} tickLine={false} />
              <Tooltip cursor={cursor} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="created" name="Sự cố mới" fill={theme.series[0]} radius={[4, 4, 0, 0]} {...bar} />
              <Bar dataKey="onTime" name="Xử lý xong đúng hạn" stackId="done" fill={theme.status.good} stroke={theme.surface} strokeWidth={2} {...bar} />
              <Bar dataKey="late" name="Xử lý xong trễ hạn" stackId="done" fill={theme.status.critical} stroke={theme.surface} strokeWidth={2} radius={[4, 4, 0, 0]} {...bar} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <Card size="small" title="Xếp hạng kỹ thuật viên theo số sao" style={{ flex: '1 1 380px', minWidth: 0 }}>
          <Table
            rowKey="userId"
            size="small"
            loading={loading}
            pagination={false}
            dataSource={inc?.technicians ?? []}
            scroll={{ x: 420 }}
            locale={{ emptyText: 'Chưa có phiếu được giao' }}
            columns={[
              { title: '#', width: 36, render: (_, __, i) => i + 1 },
              { title: 'Kỹ thuật viên', dataIndex: 'fullName' },
              {
                title: 'Số sao',
                dataIndex: 'avgRating',
                width: 150,
                render: (v, t) =>
                  v == null ? (
                    <Typography.Text type="secondary">Chưa có</Typography.Text>
                  ) : (
                    <Flex gap={6} align="center">
                      <Rate disabled allowHalf value={v} style={{ fontSize: 12 }} />
                      <span>
                        {v} ({t.rated})
                      </span>
                    </Flex>
                  ),
              },
              { title: 'Đúng hạn', dataIndex: 'onTimeRate', width: 80, align: 'right', render: pct },
              { title: 'Đã xử lý', width: 80, align: 'right', render: (_, t) => `${t.resolved}/${t.assigned}` },
            ]}
          />
        </Card>
      </Flex>

      {/* ===== Phản ánh ===== */}
      <Typography.Text strong>Phản ánh, khiếu nại</Typography.Text>
      <StatRow>
        <StatCard title="Phản ánh trong kỳ" value={cp?.count} hint={`${cp?.pending ?? 0} chưa phản hồi`} />
        <StatCard
          title="Quá hạn chưa phản hồi"
          value={cp?.overdue}
          color={cp?.overdue ? theme.status.critical : undefined}
        />
        <StatCard title="Phản hồi đúng hạn" value={pct(cp?.onTimeRate)} hint={`${cp?.responded ?? 0} đã phản hồi`} />
        <StatCard title="Thời gian phản hồi TB" value={num(cp?.avgResponseHours, ' giờ')} />
      </StatRow>
      <Flex gap={12} wrap>
        <ChartCard
          title="Phản ánh theo loại"
          empty={!cp?.byCategory?.length}
          height={Math.max(160, (cp?.byCategory?.length ?? 0) * 40)}
          style={{ flex: '1 1 420px' }}
        >
          <ResponsiveContainer>
            <BarChart data={cp?.byCategory ?? []} layout="vertical" margin={{ left: 8, right: 40 }}>
              <CartesianGrid horizontal={false} stroke={theme.grid} />
              <XAxis type="number" allowDecimals={false} {...axis} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={130} {...axis} tickLine={false} />
              <Tooltip cursor={cursor} />
              <Bar
                dataKey="count"
                name="Số phản ánh"
                fill={theme.series[0]}
                radius={[0, 4, 4, 0]}
                barSize={18}
                label={{ position: 'right', fill: theme.axis, fontSize: 12 }}
                {...bar}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <Card size="small" title="Thời gian phản hồi theo loại" style={{ flex: '1 1 420px', minWidth: 0 }}>
          <Table
            rowKey={(c) => c.categoryId ?? c.name}
            size="small"
            loading={loading}
            pagination={false}
            dataSource={cp?.byCategory ?? []}
            scroll={{ x: 460 }}
            locale={{ emptyText: 'Không có phản ánh trong kỳ' }}
            columns={[
              { title: 'Loại', dataIndex: 'name' },
              { title: 'Số phản ánh', dataIndex: 'count', width: 90, align: 'right' },
              {
                title: 'Quá hạn',
                dataIndex: 'overdue',
                width: 80,
                align: 'right',
                render: (v) => (v ? <Typography.Text type="danger">{v}</Typography.Text> : 0),
              },
              { title: 'Đúng hạn', dataIndex: 'onTimeRate', width: 80, align: 'right', render: pct },
              { title: 'TB (giờ)', dataIndex: 'avgResponseHours', width: 80, align: 'right', render: (v) => num(v) },
            ]}
          />
        </Card>
      </Flex>

      {/* ===== Bảo trì thiết bị ===== */}
      <Typography.Text strong>Bảo trì thiết bị định kỳ</Typography.Text>
      <StatRow>
        <StatCard title="Phiếu bảo trì lên lịch" value={mt?.scheduled} hint={`${mt?.done ?? 0} đã hoàn thành`} />
        <StatCard title="Hoàn thành đúng hạn" value={pct(mt?.onTimeRate)} hint={`${mt?.onTime ?? 0} đúng hạn · ${mt?.late ?? 0} trễ`} />
        <StatCard
          title="Quá hạn chưa làm"
          value={mt?.overdueOpen}
          color={mt?.overdueOpen ? theme.status.critical : undefined}
          hint="Quá ngày lên lịch hơn 1 ngày"
        />
      </StatRow>
      <ChartCard title="Bảo trì theo tháng lên lịch" empty={!mtMonths.some((m) => m.scheduled)} height={260}>
        <ResponsiveContainer>
          <BarChart data={mtMonths} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke={theme.grid} />
            <XAxis dataKey="label" {...axis} tickLine={false} />
            <YAxis allowDecimals={false} width={36} {...axis} axisLine={false} tickLine={false} />
            <Tooltip cursor={cursor} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="onTime" name="Xong đúng hạn" stackId="m" fill={theme.status.good} stroke={theme.surface} strokeWidth={2} {...bar} />
            <Bar dataKey="late" name="Xong trễ hạn" stackId="m" fill={theme.status.critical} stroke={theme.surface} strokeWidth={2} {...bar} />
            <Bar dataKey="notDone" name="Chưa xong" stackId="m" fill={theme.status.warning} stroke={theme.surface} strokeWidth={2} radius={[4, 4, 0, 0]} {...bar} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* ===== Cư dân & tiện ích ===== */}
      <Typography.Text strong>Cư dân và tiện ích</Typography.Text>
      <Flex gap={12} wrap>
        <Card size="small" title="Tỷ lệ lấp đầy theo tòa" style={{ flex: '1 1 320px', minWidth: 0 }}>
          <Flex vertical gap={12}>
            <Typography.Text>
              Toàn bộ: <b>{pct(occ?.occupancyRate)}</b> ({(occ?.owned ?? 0) + (occ?.rented ?? 0)}/{occ?.total ?? 0} căn có người ở)
            </Typography.Text>
            {occ?.byBuilding?.map((b) => (
              <div key={b.buildingId}>
                <Flex justify="space-between" gap={8} wrap>
                  <Typography.Text strong>{b.buildingName}</Typography.Text>
                  <Typography.Text type="secondary">
                    Chủ ở {b.owned} · Cho thuê {b.rented} · Trống {b.vacant}
                  </Typography.Text>
                </Flex>
                <Progress percent={Math.round(b.occupancyRate * 100)} strokeColor={theme.series[0]} />
              </div>
            ))}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Tạm tính trên mọi căn: căn hộ chưa có trạng thái "Chưa bàn giao" (Mô đun 2).
            </Typography.Text>
          </Flex>
        </Card>
        <ChartCard title="Cư dân vào ở / chuyển đi" empty={!rsMonths.some((m) => m.moveIn || m.moveOut)} height={260} style={{ flex: '1 1 420px' }}>
          <ResponsiveContainer>
            <BarChart data={rsMonths} barGap={4} barCategoryGap="28%">
              <CartesianGrid vertical={false} stroke={theme.grid} />
              <XAxis dataKey="label" {...axis} tickLine={false} />
              <YAxis allowDecimals={false} width={36} {...axis} axisLine={false} tickLine={false} />
              <Tooltip cursor={cursor} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="moveIn" name="Vào ở" fill={theme.series[0]} radius={[4, 4, 0, 0]} {...bar} />
              <Bar dataKey="moveOut" name="Chuyển đi" fill={theme.series[1]} radius={[4, 4, 0, 0]} {...bar} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </Flex>

      <ChartCard
        title="Lượt sử dụng tiện ích"
        empty={!data?.amenities?.length}
        height={Math.max(160, (data?.amenities?.length ?? 0) * 52)}
      >
        <ResponsiveContainer>
          <BarChart data={data?.amenities ?? []} layout="vertical" margin={{ left: 8, right: 40 }}>
            <CartesianGrid horizontal={false} stroke={theme.grid} />
            <XAxis type="number" allowDecimals={false} {...axis} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" width={130} {...axis} tickLine={false} />
            <Tooltip cursor={cursor} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="bookings" name="Lượt đặt giữ chỗ" fill={theme.series[0]} radius={[0, 4, 4, 0]} barSize={14} {...bar} />
            <Bar dataKey="checkedIn" name="Đã check-in" fill={theme.series[2]} radius={[0, 4, 4, 0]} barSize={14} {...bar} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <Card size="small" title="Bảng số liệu theo tháng">
        <Table
          rowKey="period"
          size="small"
          loading={loading}
          pagination={false}
          scroll={{ x: 820 }}
          dataSource={incMonths.map((m, i) => ({ ...m, mt: mtMonths[i], rs: rsMonths[i] }))}
          columns={[
            { title: 'Tháng', dataIndex: 'label', width: 90, fixed: 'left' },
            { title: 'Sự cố mới', dataIndex: 'created', align: 'right' },
            { title: 'Xử lý xong', dataIndex: 'resolved', align: 'right' },
            { title: 'Đúng hạn', dataIndex: 'onTime', align: 'right' },
            { title: 'Trễ hạn', dataIndex: 'late', align: 'right' },
            { title: 'Bảo trì lên lịch', align: 'right', render: (_, r) => r.mt?.scheduled ?? 0 },
            { title: 'Bảo trì xong', align: 'right', render: (_, r) => r.mt?.done ?? 0 },
            { title: 'Vào ở', align: 'right', render: (_, r) => r.rs?.moveIn ?? 0 },
            { title: 'Chuyển đi', align: 'right', render: (_, r) => r.rs?.moveOut ?? 0 },
          ]}
        />
      </Card>

      <Alert
        type="info"
        showIcon
        message="Chưa có dữ liệu an ninh (tuần tra, checkpoint) và khảo sát"
        description="Các mục này hiển thị khi Mô đun 7 (tuần tra) và Mô đun 8 (khảo sát) của Người 5 có dữ liệu."
      />
    </Flex>
  );
}

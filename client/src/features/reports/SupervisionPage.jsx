import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert, Card, DatePicker, Flex, Table, Typography } from 'antd';
import dayjs from 'dayjs';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { reportApi } from '../../api/moduleE.api';
import EnumTag from '../../components/EnumTag';
import { FUND_PROPOSAL_STATUS, FUND_TX_TYPES } from '../../constants/enums';
import { useApi } from '../../hooks/useApi';
import { useThemeMode } from '../../hooks/useThemeMode';
import { formatDate, formatMoney, formatPercent } from '../../utils/format';
import { periodLabel } from '../invoices/invoiceShared';
import { ChartCard, ExportButton, StatCard, StatRow } from './components';
import { chartTheme, compactVnd } from './financeChartTheme';

// Mô đun 9 — 5.6 Báo cáo giám sát cho Ban quản trị: Quỹ bảo trì, tình hình thu phí, chất lượng xử lý sự cố.
// Ban quản trị chỉ xem phần giám sát (không có công nợ từng căn). Khảo sát (Mô đun 8) chưa có dữ liệu.
export default function SupervisionPage() {
  const navigate = useNavigate();
  const { isDark } = useThemeMode();
  const theme = chartTheme(isDark);
  const [range, setRange] = useState([dayjs().startOf('year'), dayjs()]);
  const params = useMemo(() => ({ from: range[0].format('YYYY-MM'), to: range[1].format('YYYY-MM') }), [range]);
  const { data, loading } = useApi(() => reportApi.supervision(params), [params]);
  const f = data?.fund;
  const b = data?.billing;
  const tk = data?.tickets;
  const months = (b?.byMonth ?? []).map((m) => ({ ...m, label: periodLabel(m.period) }));
  const axis = { stroke: theme.grid, tick: { fill: theme.axis, fontSize: 12 } };

  return (
    <Flex vertical gap={12}>
      <Card size="small">
        <Flex gap={8} wrap align="center" justify="space-between">
          <Flex gap={8} wrap align="center">
            <Typography.Title level={4} style={{ margin: 0 }}>
              Báo cáo giám sát
            </Typography.Title>
            <DatePicker.RangePicker picker="month" value={range} format="MM/YYYY" allowClear={false} onChange={(v) => v && setRange(v)} />
          </Flex>
          <ExportButton type="supervision" params={params} roles={['BOARD', 'MANAGER']} />
        </Flex>
      </Card>

      <Typography.Text strong>Quỹ bảo trì 2%</Typography.Text>
      <StatRow>
        <StatCard title="Số dư quỹ" value={f?.balance} formatter={formatMoney} />
        <StatCard title="Thu trong khoảng" value={f?.income} formatter={formatMoney} />
        <StatCard title="Chi trong khoảng" value={f?.expense} formatter={formatMoney} />
        <StatCard title="Đề xuất chờ biểu quyết" value={f?.pendingProposals} hint="Bấm vào đề xuất bên dưới để biểu quyết" />
      </StatRow>

      <Typography.Text strong>Thu phí dịch vụ</Typography.Text>
      <StatRow>
        <StatCard title="Phát hành" value={b?.billed} formatter={formatMoney} />
        <StatCard title="Tỷ lệ thu" value={formatPercent(b?.collectionRate)} hint={`Đã thu ${formatMoney(b?.paidOfRange)}`} />
        <StatCard title="Căn có khoản quá hạn" value={`${b?.overdueApartments ?? 0}/${b?.apartments ?? 0}`} hint={`${formatPercent(b?.owingRate)} căn còn nợ`} />
      </StatRow>

      <ChartCard title="Phát hành và đã thu theo kỳ" empty={!months.some((m) => m.billed)}>
        <ResponsiveContainer>
          <BarChart data={months} barGap={2} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke={theme.grid} />
            <XAxis dataKey="label" {...axis} tickLine={false} />
            <YAxis tickFormatter={compactVnd} width={56} {...axis} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v) => formatMoney(v)} cursor={{ fill: theme.grid, opacity: 0.4 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="billed" name="Phát hành" fill={theme.series[0]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="paidOfPeriod" name="Đã thu của kỳ" fill={theme.series[1]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <Flex gap={12} wrap>
        <Card size="small" title="Đề xuất chi quỹ" style={{ flex: '1 1 480px', minWidth: 0 }}>
          <Table
            rowKey="_id"
            size="small"
            loading={loading}
            dataSource={f?.proposals ?? []}
            pagination={{ pageSize: 6, hideOnSinglePage: true }}
            scroll={{ x: 560 }}
            onRow={(p) => ({ onClick: () => navigate(`/app/fund/proposals/${p._id}`), style: { cursor: 'pointer' } })}
            locale={{ emptyText: 'Không có đề xuất trong khoảng này' }}
            columns={[
              { title: 'Hạng mục', dataIndex: 'title' },
              { title: 'Số tiền', dataIndex: 'amount', width: 140, align: 'right', render: formatMoney },
              { title: 'Phiếu', dataIndex: 'voteCount', width: 70, align: 'center' },
              { title: 'Trạng thái', dataIndex: 'status', width: 170, render: (v) => <EnumTag map={FUND_PROPOSAL_STATUS} value={v} /> },
            ]}
          />
        </Card>
        <Card size="small" title="Thu chi quỹ" style={{ flex: '1 1 480px', minWidth: 0 }}>
          <Table
            rowKey="_id"
            size="small"
            loading={loading}
            dataSource={f?.transactions ?? []}
            pagination={{ pageSize: 6, hideOnSinglePage: true }}
            scroll={{ x: 560 }}
            locale={{ emptyText: 'Không có giao dịch trong khoảng này' }}
            columns={[
              { title: 'Ngày', dataIndex: 'occurredAt', width: 100, render: formatDate },
              { title: 'Loại', dataIndex: 'type', width: 70, render: (v) => <EnumTag map={FUND_TX_TYPES} value={v} /> },
              { title: 'Nội dung', render: (_, t) => t.description || t.proposalId?.title || t.source || '—' },
              { title: 'Số tiền', dataIndex: 'amount', width: 140, align: 'right', render: formatMoney },
            ]}
          />
        </Card>
      </Flex>

      <Typography.Text strong>Chất lượng xử lý sự cố, phản ánh</Typography.Text>
      <StatRow>
        <StatCard title="Sự cố / phản ánh" value={tk?.total} hint={`${tk?.open ?? 0} đang mở · ${tk?.overdue ?? 0} quá hạn`} />
        <StatCard title="Xử lý đúng hạn" value={formatPercent(tk?.onTimeRate)} hint={`${tk?.closed ?? 0} đã đóng`} />
        <StatCard title="Thời gian xử lý TB" value={tk?.avgResolutionHours} suffix="giờ" />
        <StatCard title="Đánh giá trung bình" value={tk?.avgRating} suffix="★" />
      </StatRow>
      {data && data.survey === null && (
        <Alert type="info" showIcon message="Kết quả khảo sát cư dân sẽ hiển thị khi Mô đun 8 (Khảo sát) có dữ liệu." />
      )}
    </Flex>
  );
}

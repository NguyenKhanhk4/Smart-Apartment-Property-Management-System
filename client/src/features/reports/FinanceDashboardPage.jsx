import { useMemo, useState } from 'react';
import { Card, DatePicker, Flex, Table, Typography } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined, WarningOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { reportApi } from '../../api/moduleE.api';
import { FEE_CATEGORIES, PAYMENT_METHODS } from '../../constants/enums';
import { useApi } from '../../hooks/useApi';
import { useThemeMode } from '../../hooks/useThemeMode';
import { formatMoney, formatPercent } from '../../utils/format';
import { periodLabel } from '../invoices/invoiceShared';
import { ChartCard, ExportButton, StatCard, StatRow } from './components';
import { chartTheme, compactVnd, METHOD_SLOT } from './financeChartTheme';

// Mô đun 9 — UC60 Dashboard tài chính (Trưởng BQL, Kế toán).
// Biểu đồ: tiền thu theo tháng (chồng theo hình thức), tỷ lệ căn còn nợ, cơ cấu phí; bảng số liệu bên dưới thay cho đọc màu.
const STACK = [
  { key: 'CASH', label: PAYMENT_METHODS.CASH?.label ?? 'Tiền mặt', slot: METHOD_SLOT.CASH },
  { key: 'BANK_TRANSFER', label: PAYMENT_METHODS.BANK_TRANSFER?.label ?? 'Chuyển khoản', slot: METHOD_SLOT.BANK_TRANSFER },
  { key: 'PAYOS', label: PAYMENT_METHODS.PAYOS?.label ?? 'payOS', slot: METHOD_SLOT.PAYOS },
  { key: 'amenityDirect', label: 'Tiện ích trả ngay', slot: METHOD_SLOT.AMENITY },
];

function MoneyTooltip({ active, payload, label, theme }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div style={{ background: theme.surface, border: `1px solid ${theme.grid}`, borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {payload
        .filter((p) => p.value)
        .map((p) => (
          <Flex key={p.dataKey} gap={8} align="center" justify="space-between" style={{ minWidth: 180 }}>
            <span>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: p.color, marginRight: 6 }} />
              {p.name}
            </span>
            <b>{formatMoney(p.value)}</b>
          </Flex>
        ))}
      {payload.length > 1 && (
        <Flex justify="space-between" style={{ borderTop: `1px solid ${theme.grid}`, marginTop: 4, paddingTop: 4 }}>
          <span>Tổng</span>
          <b>{formatMoney(total)}</b>
        </Flex>
      )}
    </div>
  );
}

export default function FinanceDashboardPage() {
  const { isDark } = useThemeMode();
  const theme = chartTheme(isDark);
  const [range, setRange] = useState([dayjs().startOf('year'), dayjs()]);
  const params = useMemo(() => ({ from: range[0].format('YYYY-MM'), to: range[1].format('YYYY-MM') }), [range]);
  const { data, loading } = useApi(() => reportApi.finance(params), [params]);
  const t = data?.totals;
  const d = data?.debt;
  const months = (data?.byMonth ?? []).map((m) => ({ ...m, label: periodLabel(m.period) }));

  const debtSlices = d
    ? [
        { key: 'clear', name: 'Đã trả hết', value: d.clear, color: theme.status.good, icon: <CheckCircleOutlined /> },
        { key: 'owing', name: 'Còn nợ, chưa quá hạn', value: d.owing, color: theme.status.warning, icon: <ClockCircleOutlined /> },
        { key: 'overdue', name: 'Có khoản quá hạn', value: d.overdueApartments, color: theme.status.critical, icon: <WarningOutlined /> },
      ]
    : [];
  const categories = (data?.byFeeCategory ?? []).map((c) => ({ ...c, label: FEE_CATEGORIES[c.feeCategory]?.label ?? c.feeCategory }));
  const axis = { stroke: theme.grid, tick: { fill: theme.axis, fontSize: 12 } };

  return (
    <Flex vertical gap={12}>
      <Card size="small">
        <Flex gap={8} wrap align="center" justify="space-between">
          <Flex gap={8} wrap align="center">
            <Typography.Title level={3} style={{ margin: 0 }}>
              Dashboard tài chính
            </Typography.Title>
            <DatePicker.RangePicker picker="month" value={range} format="MM/YYYY" allowClear={false} onChange={(v) => v && setRange(v)} />
          </Flex>
          <ExportButton type="finance" params={params} />
        </Flex>
      </Card>

      <StatRow>
        <StatCard title="Phát hành trong khoảng kỳ" value={t?.billed} formatter={formatMoney} hint={`${t?.invoices ?? 0} thông báo phí`} />
        <StatCard
          title="Tỷ lệ thu"
          value={formatPercent(t?.collectionRate)}
          hint={`Đã thu ${formatMoney(t?.paidOfRange)} của các kỳ này`}
        />
        <StatCard title="Tiền thu được" value={t?.collected} formatter={formatMoney} hint="Theo ngày thu, mọi kỳ" />
        <StatCard title="Tổng còn nợ" value={d?.outstanding} formatter={formatMoney} hint={`Quá hạn ${formatMoney(d?.overdueAmount)}`} />
        <StatCard title="Số dư Quỹ bảo trì" value={data?.fund?.balance} formatter={formatMoney} hint={`${data?.fund?.pendingProposals ?? 0} đề xuất chờ duyệt`} />
      </StatRow>

      <Flex gap={12} wrap>
        <ChartCard title="Tiền thu theo tháng, theo hình thức" empty={!months.some((m) => m.collected || m.amenityDirect)} style={{ flex: '2 1 560px' }}>
          <ResponsiveContainer>
            <BarChart data={months} barCategoryGap="30%">
              <CartesianGrid vertical={false} stroke={theme.grid} />
              <XAxis dataKey="label" {...axis} tickLine={false} />
              <YAxis tickFormatter={compactVnd} width={56} {...axis} axisLine={false} tickLine={false} />
              <Tooltip content={<MoneyTooltip theme={theme} />} cursor={{ fill: theme.grid, opacity: 0.4 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {STACK.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  stackId="m"
                  fill={theme.series[s.slot]}
                  stroke={theme.surface}
                  strokeWidth={2}
                  radius={i === STACK.length - 1 ? [4, 4, 0, 0] : 0}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Tình trạng nợ các căn (hiện tại)" empty={!d?.apartments} style={{ flex: '1 1 320px' }}>
          <Flex vertical style={{ height: '100%' }}>
            <div style={{ flex: 1, minHeight: 0 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={debtSlices} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="85%" stroke={theme.surface} strokeWidth={2} isAnimationActive={false}>
                    {debtSlices.map((s) => (
                      <Cell key={s.key} fill={s.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v, n) => [`${v} căn`, n]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <Flex vertical gap={4} style={{ fontSize: 13 }}>
              {debtSlices.map((s) => (
                <Flex key={s.key} justify="space-between" gap={8}>
                  <span>
                    <span style={{ color: s.color, marginRight: 6 }}>{s.icon}</span>
                    {s.name}
                  </span>
                  <b>
                    {s.value} căn ({formatPercent(d.apartments ? s.value / d.apartments : 0, 0)})
                  </b>
                </Flex>
              ))}
            </Flex>
          </Flex>
        </ChartCard>
      </Flex>

      <ChartCard title="Cơ cấu phí đã phát hành" empty={!categories.length} height={Math.max(160, categories.length * 44)}>
        <ResponsiveContainer>
          <BarChart data={categories} layout="vertical" margin={{ left: 8, right: 96 }}>
            <CartesianGrid horizontal={false} stroke={theme.grid} />
            <XAxis type="number" tickFormatter={compactVnd} {...axis} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="label" width={130} {...axis} tickLine={false} />
            <Tooltip formatter={(v) => formatMoney(v)} cursor={{ fill: theme.grid, opacity: 0.4 }} />
            <Bar
              dataKey="amount"
              name="Số tiền"
              fill={theme.series[0]}
              radius={[0, 4, 4, 0]}
              barSize={20}
              isAnimationActive={false}
              label={{ position: 'right', fill: theme.axis, fontSize: 12, formatter: (v) => compactVnd(v) }}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <Card size="small" title="Bảng số liệu theo tháng">
        <Table
          rowKey="period"
          size="small"
          loading={loading}
          dataSource={months}
          pagination={false}
          scroll={{ x: 1000 }}
          columns={[
            { title: 'Tháng', dataIndex: 'label', width: 90, fixed: 'left' },
            { title: 'Phát hành', dataIndex: 'billed', align: 'right', render: formatMoney },
            { title: 'Đã thu của kỳ', dataIndex: 'paidOfPeriod', align: 'right', render: formatMoney },
            ...STACK.map((s) => ({ title: s.label, dataIndex: s.key, align: 'right', render: formatMoney })),
            { title: 'Thu trong tháng', dataIndex: 'collected', align: 'right', render: (v) => <b>{formatMoney(v)}</b> },
          ]}
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
          "Đã thu của kỳ" tính theo kỳ của thông báo phí (kể cả thu sau); "Thu trong tháng" tính theo ngày nhận tiền. Tiện ích trả ngay
          khi đặt không đi qua thông báo phí nên tách riêng. Số dư trả trước hiện có {formatMoney(t?.prepaidBalance)}.
        </Typography.Paragraph>
      </Card>
    </Flex>
  );
}

import { useMemo, useState } from 'react';
import { Card, DatePicker, Flex, Select, Table, Tabs, Typography } from 'antd';
import dayjs from 'dayjs';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { lookupApi, reportApi } from '../../api/moduleE.api';
import { useApi } from '../../hooks/useApi';
import { FEE_CATEGORIES, PAYMENT_METHODS, enumOptions } from '../../constants/enums';
import { formatCompactMoney, formatMoney, formatPercent } from '../../utils/format';
import { CHART_COLORS } from './chartColors';
import { ChartCard, ExportButton, StatCard, StatRow } from './components';
import DebtTable from './DebtTable';

const moneyColumns = [
  { title: 'Phải thu', dataIndex: 'billed', align: 'right', render: formatMoney },
  { title: 'Đã thu', dataIndex: 'collected', align: 'right', render: formatMoney },
  { title: 'Còn nợ', dataIndex: 'outstanding', align: 'right', render: formatMoney },
  { title: 'Tỷ lệ thu', dataIndex: 'collectionRate', align: 'right', width: 100, render: (v) => formatPercent(v) },
];

// UC-E10 — Báo cáo tổng hợp thu phí lũy kế (Manager, Accountant, Board chỉ đọc)
export default function BillingReportPage() {
  const [range, setRange] = useState([dayjs().startOf('year'), dayjs()]);
  const [buildingId, setBuildingId] = useState();
  const [feeCategory, setFeeCategory] = useState();
  const params = useMemo(
    () => ({ from: range[0].format('YYYY-MM'), to: range[1].format('YYYY-MM'), buildingId, feeCategory }),
    [range, buildingId, feeCategory],
  );
  const { data, loading } = useApi(() => reportApi.billingSummary(params), [params]);
  const { data: buildings = [] } = useApi(() => lookupApi.buildings(), []);
  const o = data?.overview;

  return (
    <Flex vertical gap={12}>
      <Card size="small">
        <Flex gap={8} wrap align="center" justify="space-between">
          <Flex gap={8} wrap>
            <DatePicker.RangePicker
              picker="month"
              value={range}
              format="MM/YYYY"
              allowClear={false}
              onChange={(v) => v && setRange(v)}
            />
            <Select allowClear placeholder="Tất cả tòa" style={{ width: 150 }} value={buildingId} onChange={setBuildingId}
              options={buildings.map((b) => ({ value: b._id, label: b.name }))} />
            <Select allowClear placeholder="Tất cả loại phí" style={{ width: 160 }} value={feeCategory} onChange={setFeeCategory}
              options={enumOptions(FEE_CATEGORIES)} />
          </Flex>
          <ExportButton type="billing" params={params} />
        </Flex>
      </Card>

      <StatRow>
        <StatCard title="Tổng phải thu" value={o?.billed} formatter={formatMoney} hint={`${o?.issued ?? 0} hóa đơn`} />
        <StatCard title="Đã thu" value={o?.collected} formatter={formatMoney} color="#389e0d" hint={`${o?.paid ?? 0} hóa đơn đã thanh toán`} />
        <StatCard title="Còn nợ" value={o?.outstanding} formatter={formatMoney} color="#cf1322" hint={`${o?.unpaid ?? 0} chưa TT · ${o?.overdue ?? 0} quá hạn`} />
        <StatCard title="Tỷ lệ thu" value={formatPercent(o?.collectionRate)} hint={`${o?.cancelled ?? 0} hóa đơn đã hủy (không tính)`} />
      </StatRow>

      <Flex gap={12} wrap>
        <ChartCard title="Thu phí theo tháng" empty={!data?.byMonth?.some((m) => m.billed)} style={{ flex: '2 1 520px' }}>
          <ResponsiveContainer>
            <ComposedChart data={data?.byMonth ?? []}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="period" />
              <YAxis tickFormatter={formatCompactMoney} width={60} />
              <Tooltip formatter={(v, name) => [formatMoney(v), name]} />
              <Legend />
              <Bar dataKey="collected" name="Đã thu" stackId="a" fill="#52c41a" />
              <Bar dataKey="outstanding" name="Còn nợ" stackId="a" fill="#ff7875" />
              <Line dataKey="billed" name="Phải thu" stroke="#1677ff" />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Cơ cấu theo loại phí" empty={!data?.byFeeCategory?.length}>
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={data?.byFeeCategory ?? []}
                dataKey="billed"
                nameKey="feeCategory"
                innerRadius={60}
                outerRadius={100}
                label={({ feeCategory, percent }) => `${FEE_CATEGORIES[feeCategory]?.label} ${(percent * 100).toFixed(0)}%`}
              >
                {(data?.byFeeCategory ?? []).map((x, i) => (
                  <Cell key={x.feeCategory} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v, name) => [formatMoney(v), FEE_CATEGORIES[name]?.label ?? name]} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </Flex>

      <Card size="small">
        <Tabs
          items={[
            {
              key: 'fee',
              label: 'Theo loại phí',
              children: (
                <Table rowKey="feeCategory" size="small" loading={loading} pagination={false} scroll={{ x: 640 }}
                  dataSource={data?.byFeeCategory}
                  columns={[{ title: 'Loại phí', dataIndex: 'feeCategory', render: (v) => FEE_CATEGORIES[v]?.label ?? v }, ...moneyColumns]} />
              ),
            },
            {
              key: 'month',
              label: 'Theo tháng',
              children: (
                <Table rowKey="period" size="small" loading={loading} pagination={false} scroll={{ x: 640 }}
                  dataSource={data?.byMonth}
                  columns={[{ title: 'Kỳ', dataIndex: 'period' }, { title: 'Số HĐ', dataIndex: 'invoiceCount', align: 'right' }, ...moneyColumns]} />
              ),
            },
            {
              key: 'building',
              label: 'Theo tòa',
              children: (
                <Table rowKey="buildingId" size="small" loading={loading} pagination={false} scroll={{ x: 640 }}
                  dataSource={data?.byBuilding}
                  columns={[{ title: 'Tòa', dataIndex: 'buildingName' }, ...moneyColumns]} />
              ),
            },
            {
              key: 'method',
              label: 'Theo phương thức',
              children: (
                <Table rowKey="method" size="small" loading={loading} pagination={false}
                  dataSource={data?.byMethod}
                  columns={[
                    { title: 'Phương thức', dataIndex: 'method', render: (v) => PAYMENT_METHODS[v]?.label ?? v },
                    { title: 'Số giao dịch', dataIndex: 'count', align: 'right' },
                    { title: 'Số tiền', dataIndex: 'amount', align: 'right', render: formatMoney },
                  ]} />
              ),
            },
            {
              key: 'debts',
              label: 'Công nợ quá hạn',
              children: <DebtTable buildingId={buildingId} />,
            },
          ]}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Hóa đơn đã hủy không tính vào phải thu. Khoản "đã thu" = hóa đơn PAID (BR-F9).
        </Typography.Text>
      </Card>
    </Flex>
  );
}

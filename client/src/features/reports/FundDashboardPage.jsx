import { useMemo, useState } from 'react';
import { Card, DatePicker, Flex, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { reportApi } from '../../api/moduleE.api';
import { useApi } from '../../hooks/useApi';
import { formatCompactMoney, formatDate, formatMoney } from '../../utils/format';
import { ChartCard, ExportButton, StatCard, StatRow } from './components';

// UC-E11 — Dashboard quỹ bảo trì (Manager, Board)
export default function FundDashboardPage() {
  const [range, setRange] = useState([dayjs().startOf('year'), dayjs()]);
  const params = useMemo(
    () => ({ from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD') }),
    [range],
  );
  const { data, loading } = useApi(() => reportApi.fund(params), [params]);

  return (
    <Flex vertical gap={12}>
      <Card size="small">
        <Flex gap={8} wrap justify="space-between">
          <DatePicker.RangePicker value={range} format="DD/MM/YYYY" allowClear={false} onChange={(v) => v && setRange(v)} />
          <ExportButton type="fund" params={params} />
        </Flex>
      </Card>

      <StatRow>
        <StatCard title="Số dư quỹ hiện tại" value={data?.balance} formatter={formatMoney} color="#1677ff" />
        <StatCard title="Tổng thu trong kỳ" value={data?.totalIncome} formatter={formatMoney} color="#389e0d" />
        <StatCard title="Tổng chi trong kỳ" value={data?.totalExpense} formatter={formatMoney} color="#cf1322" />
        <StatCard title="Đề xuất chi đang chờ" value={data?.pendingProposals?.length} />
      </StatRow>

      <Flex gap={12} wrap>
        <ChartCard
          title="Thu chi theo tháng"
          empty={!data?.monthly?.some((m) => m.income || m.expense)}
          style={{ flex: '2 1 520px' }}
        >
          <ResponsiveContainer>
            <BarChart data={data?.monthly ?? []}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="period" />
              <YAxis tickFormatter={formatCompactMoney} width={60} />
              <Tooltip formatter={(v, name) => [formatMoney(v), name]} />
              <Legend />
              <Bar dataKey="income" name="Thu" fill="#52c41a" />
              <Bar dataKey="expense" name="Chi" fill="#ff7875" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <Card size="small" title="Đề xuất chi đang chờ biểu quyết" style={{ flex: '1 1 320px' }}>
          {data?.pendingProposals?.length ? (
            <Flex vertical gap={8}>
              {data.pendingProposals.map((p) => (
                <Flex key={p._id} justify="space-between" gap={8}>
                  <Flex vertical>
                    <Typography.Text strong>{p.title}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {p.voteCount} phiếu · {formatDate(p.createdAt)}
                    </Typography.Text>
                  </Flex>
                  <Typography.Text>{formatMoney(p.amount)}</Typography.Text>
                </Flex>
              ))}
            </Flex>
          ) : (
            <Typography.Text type="secondary">Không có đề xuất đang chờ</Typography.Text>
          )}
        </Card>
      </Flex>

      <Card size="small" title="Giao dịch gần nhất">
        <Table
          rowKey="_id"
          size="small"
          loading={loading}
          dataSource={data?.recentTransactions}
          pagination={false}
          scroll={{ x: 640 }}
          locale={{ emptyText: 'Không có dữ liệu' }}
          columns={[
            { title: 'Ngày', dataIndex: 'occurredAt', width: 110, render: formatDate },
            { title: 'Loại', dataIndex: 'type', width: 80, render: (v) => (v === 'INCOME' ? <Tag color="green">Thu</Tag> : <Tag color="red">Chi</Tag>) },
            { title: 'Nội dung', render: (_, r) => r.description || r.proposalId?.title || r.source },
            { title: 'Số tiền', dataIndex: 'amount', align: 'right', render: formatMoney },
            { title: 'Số dư sau', dataIndex: 'balanceAfter', align: 'right', render: (v) => (v == null ? '—' : formatMoney(v)) },
          ]}
        />
      </Card>
    </Flex>
  );
}

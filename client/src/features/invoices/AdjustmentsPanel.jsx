import { useNavigate } from 'react-router';
import { Alert, Card, Flex, Statistic, Table, Typography } from 'antd';
import { invoiceApi } from '../../api/moduleB.api';
import EnumTag from '../../components/EnumTag';
import { ADJUSTMENT_STATUS } from '../../constants/enums';
import { useApi } from '../../hooks/useApi';
import { formatDateTime, formatMoney } from '../../utils/format';
import { periodLabel } from './invoiceShared';

const signed = (v) => (v > 0 ? `+${formatMoney(v)}` : formatMoney(v));

/**
 * M4-5 — Khoản điều chỉnh nằm trong các thông báo của kỳ `period`, hiện riêng trên màn hình duyệt để Trưởng BQL
 * xem lý do (nhất là giảm tiền) trước khi Duyệt & Phát hành. Không có khoản nào thì không hiện.
 */
export default function AdjustmentsPanel({ period }) {
  const navigate = useNavigate();
  const { data, raw, loading } = useApi(() => invoiceApi.adjustments({ period, limit: 100, status: 'PENDING,APPLIED' }), [period]);
  const summary = raw?.summary;
  if (!summary?.count) return null;

  return (
    <Card size="small" title={`Khoản điều chỉnh trong kỳ ${periodLabel(period)} (${summary.count})`}>
      <Flex vertical gap={12}>
        <Alert
          type="warning"
          showIcon
          message="Kiểm tra lý do các khoản điều chỉnh trước khi duyệt"
          description="Kế toán lập cho thông báo kỳ trước đã phát hành; các dòng này đã nằm trong thông báo kỳ này và được duyệt cùng."
        />
        <Flex gap={32} wrap>
          <Statistic title="Thu thêm" value={formatMoney(summary.increase)} />
          <Statistic title="Giảm trừ" value={formatMoney(summary.decrease)} />
        </Flex>
        <Table
          rowKey="_id"
          size="small"
          loading={loading}
          dataSource={data ?? []}
          pagination={false}
          scroll={{ x: 980 }}
          onRow={(a) => ({ onClick: () => a.invoiceId && navigate(`/app/invoices/${a.invoiceId._id}`), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'Căn hộ', width: 100, render: (_, a) => <b>{[a.apartmentId?.buildingId?.code, a.apartmentId?.code].filter(Boolean).join('-')}</b> },
            { title: 'Thông báo gốc', width: 200, render: (_, a) => <Typography.Text code>{a.sourceInvoiceId?.code}</Typography.Text> },
            { title: 'Số tiền', dataIndex: 'amount', width: 130, align: 'right', render: (v) => <b>{signed(v)}</b> },
            { title: 'Lý do', dataIndex: 'reason' },
            { title: 'Kế toán', width: 160, render: (_, a) => `${a.requestedBy?.fullName ?? '—'} · ${formatDateTime(a.createdAt)}` },
            { title: 'Trạng thái', dataIndex: 'status', width: 140, render: (v) => <EnumTag map={ADJUSTMENT_STATUS} value={v} /> },
          ]}
        />
      </Flex>
    </Card>
  );
}

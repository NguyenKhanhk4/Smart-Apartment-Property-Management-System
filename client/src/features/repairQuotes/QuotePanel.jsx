import { Link } from 'react-router';
import { Card, Collapse, Descriptions, Empty, Flex, Table, Tag, Typography } from 'antd';
import EnumTag from '../../components/EnumTag';
import { QUOTE_STATUS } from '../../constants/enums';
import { formatDateTime, formatMoney } from '../../utils/format';

const itemColumns = [
  { title: 'Hạng mục', dataIndex: 'description' },
  { title: 'SL', dataIndex: 'quantity', width: 70, align: 'right' },
  { title: 'Đơn giá', dataIndex: 'unitPrice', width: 130, align: 'right', render: formatMoney },
  { title: 'Thành tiền', dataIndex: 'amount', width: 140, align: 'right', render: formatMoney },
];

/** Bảng hạng mục + tổng của 1 bản báo giá (dùng cả trong hộp thoại quyết định của cư dân) */
export function QuoteItems({ quote }) {
  return (
    <Table
      rowKey={(_, i) => i}
      size="small"
      pagination={false}
      dataSource={quote.items}
      columns={itemColumns}
      scroll={{ x: 480 }}
      summary={() => (
        <Table.Summary.Row>
          <Table.Summary.Cell index={0} colSpan={3} align="right">
            <b>Tổng</b>
          </Table.Summary.Cell>
          <Table.Summary.Cell index={1} align="right">
            <b>{formatMoney(quote.totalAmount)}</b>
          </Table.Summary.Cell>
        </Table.Summary.Row>
      )}
    />
  );
}

function QuoteDetail({ quote, invoiceBase }) {
  return (
    <Flex vertical gap={8}>
      <Descriptions size="small" column={{ xs: 1, md: 2 }}>
        <Descriptions.Item label="Kỹ thuật viên">{quote.createdBy?.fullName ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="Gửi lúc">{formatDateTime(quote.sentAt)}</Descriptions.Item>
        {quote.previousAmount != null && (
          <Descriptions.Item label="Đã đồng ý trước đó">{formatMoney(quote.previousAmount)}</Descriptions.Item>
        )}
        {quote.expiresAt && <Descriptions.Item label="Tự đóng nếu không phản hồi">{formatDateTime(quote.expiresAt)}</Descriptions.Item>}
        {quote.decidedAt && quote.status !== 'SUPERSEDED' && (
          <Descriptions.Item label="Quyết định">
            {quote.autoAccepted ? 'Tự áp dụng (trong ngưỡng)' : (quote.decidedBy?.fullName ?? 'Hệ thống')} · {formatDateTime(quote.decidedAt)}
            {quote.decisionNote && ` · ${quote.decisionNote}`}
          </Descriptions.Item>
        )}
        {quote.invoiceId && (
          <Descriptions.Item label="Đã tính vào">
            <Link to={`${invoiceBase}/${quote.invoiceId._id}`}>{quote.invoiceId.code}</Link>
          </Descriptions.Item>
        )}
      </Descriptions>
      {quote.note && <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{quote.note}</Typography.Paragraph>}
      <QuoteItems quote={quote} />
    </Flex>
  );
}

/** Các phiên bản báo giá sửa chữa của phiếu (mới nhất mở sẵn) */
export default function QuotePanel({ quotes, loading, invoiceBase = '/app/invoices', extra }) {
  return (
    <Card size="small" title="Báo giá sửa chữa" extra={extra} loading={loading && !quotes}>
      {!quotes?.length ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Kỹ thuật viên chưa gửi báo giá" />
      ) : (
        <Collapse
          size="small"
          defaultActiveKey={[quotes[0]._id]}
          items={quotes.map((q) => ({
            key: q._id,
            label: (
              <Flex gap={8} align="center" wrap>
                <Typography.Text code>{q.code}</Typography.Text>
                <span>Lần {q.version}</span>
                <b>{formatMoney(q.totalAmount)}</b>
                <EnumTag map={QUOTE_STATUS} value={q.status} />
                {q.autoAccepted && <Tag>Trong ngưỡng, không cần duyệt lại</Tag>}
              </Flex>
            ),
            children: <QuoteDetail quote={q} invoiceBase={invoiceBase} />,
          }))}
        />
      )}
    </Card>
  );
}

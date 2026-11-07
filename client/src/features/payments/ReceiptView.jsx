import { Descriptions, Flex, Table, Typography } from 'antd';
import EnumTag from '../../components/EnumTag';
import { INVOICE_STATUS, PAYMENT_METHODS } from '../../constants/enums';
import { formatDate, formatDateTime, formatMoney } from '../../utils/format';
import { periodLabel } from '../invoices/invoiceShared';

/** Nội dung biên lai (UC35) — dùng chung trang quản trị và cư dân. Biên lai chỉ xác nhận đã thu tiền, không thay thế hóa đơn GTGT */
export default function ReceiptView({ receipt: r }) {
  const apt = [r.apartmentId?.buildingId?.code, r.apartmentId?.code].filter(Boolean).join('-');
  return (
    <div className="receipt-print">
      <Flex vertical align="center" className="mb-4">
        <Typography.Title level={4} className="mb-0!">
          BIÊN LAI THU TIỀN
        </Typography.Title>
        <Typography.Text type="secondary">Số {r.receiptNumber ?? r.receiptNo ?? r._id}</Typography.Text>
      </Flex>
      <Descriptions column={{ xs: 1, md: 2 }} size="small" bordered>
        <Descriptions.Item label="Căn hộ">
          {apt} {r.apartmentId?.buildingId?.name && `(${r.apartmentId.buildingId.name})`}
        </Descriptions.Item>
        <Descriptions.Item label="Người nộp">{r.payerId?.fullName ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="Thời điểm">{formatDateTime(r.paidAt)}</Descriptions.Item>
        <Descriptions.Item label="Hình thức">
          <EnumTag map={PAYMENT_METHODS} value={r.method} />
          {(r.bankRef || r.reference) && ` · Mã GD ${r.bankRef || r.reference}`}
        </Descriptions.Item>
        <Descriptions.Item label="Số tiền">
          <b>{formatMoney(r.amount)}</b>
        </Descriptions.Item>
        <Descriptions.Item label="Người thu">{r.confirmedBy?.fullName ?? 'payOS tự động'}</Descriptions.Item>
        {r.note && (
          <Descriptions.Item label="Ghi chú" span={2}>
            {r.note}
          </Descriptions.Item>
        )}
      </Descriptions>

      {r.bookingId && (
        <Typography.Paragraph className="mt-4 mb-0">
          Phí tiện ích <b>{r.bookingId.amenityId?.name}</b> ngày {formatDate(r.bookingId.date)} {r.bookingId.slotStart}–{r.bookingId.slotEnd}
          {r.creditAmount > 0 && ' (không giữ được chỗ, tiền đã vào Số dư trả trước)'}
        </Typography.Paragraph>
      )}

      <Typography.Title level={5} className="mt-5!">
        Phân bổ vào thông báo phí
      </Typography.Title>
      <Table
        rowKey={(a) => a.invoice?._id ?? a.amount}
        size="small"
        pagination={false}
        dataSource={r.allocations}
        locale={{ emptyText: 'Không phân bổ vào thông báo phí nào' }}
        columns={[
          { title: 'Thông báo phí', render: (_, a) => a.invoice?.code ?? '—' },
          { title: 'Kỳ', width: 90, render: (_, a) => periodLabel(a.invoice?.period) },
          { title: 'Số tiền trả', dataIndex: 'amount', width: 140, align: 'right', render: formatMoney },
          { title: 'Còn nợ hiện tại', width: 140, align: 'right', render: (_, a) => formatMoney(a.invoice?.outstanding) },
          { title: 'Trạng thái', width: 170, render: (_, a) => <EnumTag map={INVOICE_STATUS} value={a.invoice?.status} /> },
        ]}
        scroll={{ x: 640 }}
      />

      <Flex vertical gap={4} className="mt-4" align="end">
        {r.creditAmount > 0 && <span>Tiền thừa vào Số dư trả trước: {formatMoney(r.creditAmount)}</span>}
        <span>Tổng còn nợ hiện tại: <b>{formatMoney(r.currentOutstanding)}</b></span>
        <span>Số dư trả trước hiện tại: <b>{formatMoney(r.prepaidBalance)}</b></span>
      </Flex>
      {r.vatNote && (
        <Typography.Paragraph type="secondary" italic className="mt-4 mb-0">
          {r.vatNote}
        </Typography.Paragraph>
      )}
    </div>
  );
}

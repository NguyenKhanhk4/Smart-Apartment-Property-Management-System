import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Skeleton,
  Table,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckOutlined,
  DeleteOutlined,
  DollarOutlined,
  PlusOutlined,
  ReloadOutlined,
  RollbackOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { invoiceApi } from '../../api/moduleB.api';
import EnumTag from '../../components/EnumTag';
import PageHeader from '../../components/PageHeader';
import ReasonModal from '../../components/ReasonModal';
import { INVOICE_STATUS, PAYER_SOURCES, PAYMENT_METHODS, PREPAID_TX_TYPES } from '../../constants/enums';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { formatDate, formatDateTime, formatMoney, moneyInputProps } from '../../utils/format';
import RecordPaymentModal from '../payments/RecordPaymentModal';
import { aptLabel, itemColumns, OUTSTANDING_STATUSES, outstandingOf, periodLabel } from './invoiceShared';

// Mô đun 4 — chi tiết thông báo phí cho Kế toán / Trưởng BQL.
// Nháp: Kế toán thêm / xóa khoản thu khác, Tính lại, Trình duyệt. Chờ duyệt: Trưởng BQL Duyệt & Phát hành / Trả lại.
export default function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const isAccountant = hasRole('ACCOUNTANT');
  const isManager = hasRole('MANAGER');
  const [adding, setAdding] = useState(false);
  const [returning, setReturning] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [form] = Form.useForm();

  const inv = useApi(() => invoiceApi.get(id), [id]);
  const d = inv.data;
  const isDraft = d?.status === 'DRAFT';
  const isPending = d?.status === 'PENDING_APPROVAL';
  const canCollect = isAccountant && OUTSTANDING_STATUSES.includes(d?.status);
  const reload = inv.reload;

  const [addItem, addingItem] = useAction((v) => invoiceApi.addItem(id, v), {
    onDone: () => (setAdding(false), form.resetFields(), reload()),
  });
  const [removeItem] = useAction((index) => invoiceApi.removeItem(id, index), { onDone: reload });
  const [recalc, recalculating] = useAction(() => invoiceApi.recalculate(id), { onDone: reload });
  const [submit, submitting] = useAction(() => invoiceApi.submit({ invoiceIds: [id] }), { onDone: reload });
  const [publish, publishing] = useAction(() => invoiceApi.publish({ invoiceIds: [id] }), { onDone: reload });

  const deleteColumn =
    isAccountant && isDraft
      ? {
          title: '',
          width: 56,
          render: (_, item, index) =>
            item.feeCategory === 'OTHER' && (
              <Popconfirm title="Xóa khoản thu khác này?" onConfirm={() => removeItem(index).catch(() => {})}>
                <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label="Xóa" />
              </Popconfirm>
            ),
        }
      : null;

  const paymentColumns = [
    { title: 'Ngày', dataIndex: 'paidAt', width: 150, render: formatDateTime },
    { title: 'Hình thức', dataIndex: 'method', width: 150, render: (m) => <EnumTag map={PAYMENT_METHODS} value={m} /> },
    { title: 'Phiếu thu / mã GD', render: (_, p) => p.receiptNo || p.reference || p.bankRef || '—' },
    { title: 'Tổng lần thu', dataIndex: 'amount', width: 140, align: 'right', render: formatMoney },
    { title: 'Phân bổ vào thông báo này', dataIndex: 'allocatedAmount', width: 190, align: 'right', render: formatMoney },
    { title: 'Người ghi nhận', render: (_, p) => p.confirmedBy?.fullName ?? 'payOS tự động' },
    {
      title: '',
      width: 100,
      render: (_, p) => (
        <Button size="small" type="link" onClick={() => navigate(`/app/payments/${p._id}/receipt`)}>
          Biên lai
        </Button>
      ),
    },
  ];

  return (
    <Flex vertical gap={16}>
      <PageHeader
        className="mb-0"
        title={d ? `Thông báo phí ${d.code}` : <Skeleton.Input active size="small" />}
        breadcrumb={[
          { label: 'Trang chủ', path: '/app/home' },
          { label: 'Thông báo phí', path: '/app/invoices' },
          { label: 'Chi tiết' },
        ]}
        extra={
          <Flex gap={8} wrap>
            {d && <EnumTag map={INVOICE_STATUS} value={d.status} />}
            {isAccountant && isDraft && (
              <>
                <Popconfirm
                  title="Tính lại theo đơn giá, xe, phí tiện ích hiện tại?"
                  description="Khoản thu khác đã thêm tay được giữ nguyên."
                  onConfirm={() => recalc().catch(() => {})}
                >
                  <Button icon={<ReloadOutlined />} loading={recalculating}>
                    Tính lại
                  </Button>
                </Popconfirm>
                <Popconfirm title="Trình Trưởng BQL duyệt thông báo này?" onConfirm={() => submit().catch(() => {})}>
                  <Button type="primary" icon={<SendOutlined />} loading={submitting}>
                    Trình duyệt
                  </Button>
                </Popconfirm>
              </>
            )}
            {isManager && isPending && (
              <>
                <Button danger icon={<RollbackOutlined />} onClick={() => setReturning(true)}>
                  Trả lại
                </Button>
                <Popconfirm
                  title="Duyệt & Phát hành?"
                  description="Người nộp phí nhận thông báo + email ngay; sau đó không sửa được."
                  onConfirm={() => publish().catch(() => {})}
                >
                  <Button type="primary" icon={<CheckOutlined />} loading={publishing}>
                    Duyệt & Phát hành
                  </Button>
                </Popconfirm>
              </>
            )}
            {canCollect && (
              <Button type="primary" icon={<DollarOutlined />} onClick={() => setCollecting(true)}>
                Ghi nhận thu tiền
              </Button>
            )}
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/app/invoices', { viewTransition: true })}>
              Danh sách
            </Button>
          </Flex>
        }
      />

      {d?.returnNote && isDraft && (
        <Alert
          type="warning"
          showIcon
          message={`Trưởng BQL trả lại lúc ${formatDateTime(d.returnedAt)}`}
          description={`Lý do: ${d.returnNote}`}
        />
      )}

      <Card title="Thông tin" loading={inv.loading && !d}>
        {d && (
          <Descriptions column={{ xs: 1, md: 2, xl: 3 }} size="small">
            <Descriptions.Item label="Căn hộ">
              <b>{aptLabel(d)}</b>&nbsp;({d.buildingId?.name})
            </Descriptions.Item>
            <Descriptions.Item label="Kỳ">{periodLabel(d.period)}</Descriptions.Item>
            <Descriptions.Item label="Người nộp phí">
              <Flex gap={6} align="center" wrap>
                {d.payerId?.fullName ?? '—'} {d.payerId?.phone && `· ${d.payerId.phone}`}
                <EnumTag map={PAYER_SOURCES} value={d.payerSource} />
              </Flex>
            </Descriptions.Item>
            <Descriptions.Item label="Trình duyệt">
              {d.submittedBy ? `${d.submittedBy.fullName} · ${formatDateTime(d.submittedAt)}` : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Duyệt / trả lại">{d.reviewedBy?.fullName ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Ngày phát hành">{formatDate(d.issuedAt)}</Descriptions.Item>
            <Descriptions.Item label="Hạn đóng">{formatDate(d.dueDate)}</Descriptions.Item>
            <Descriptions.Item label="Ngày trả đủ">{formatDate(d.paidAt)}</Descriptions.Item>
          </Descriptions>
        )}
      </Card>

      <Card
        title="Các dòng phí"
        extra={
          isAccountant &&
          isDraft && (
            <Button icon={<PlusOutlined />} onClick={() => setAdding(true)}>
              Thêm khoản thu khác
            </Button>
          )
        }
      >
        <Table
          rowKey={(_, i) => i}
          size="small"
          pagination={false}
          loading={inv.loading}
          dataSource={d?.items ?? []}
          columns={itemColumns(deleteColumn)}
          scroll={{ x: 700 }}
          summary={() =>
            d && (
              <>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={4} align="right">
                    <b>Tổng tiền kỳ này</b>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <b>{formatMoney(d.totalAmount)}</b>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
                {d.prepaidApplied > 0 && (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={4} align="right">
                      Đã trừ Số dư trả trước
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right">
                      − {formatMoney(d.prepaidApplied)}
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                )}
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={4} align="right">
                    Đã thanh toán / Còn nợ
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    {formatMoney(d.paidAmount)} /{' '}
                    <Typography.Text type={outstandingOf(d) ? 'danger' : undefined} strong>
                      {formatMoney(outstandingOf(d))}
                    </Typography.Text>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
                {d.previousDebt > 0 && (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={4} align="right">
                      <Typography.Text type="secondary">Nợ các kỳ trước (chỉ hiển thị, không cộng vào kỳ này)</Typography.Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right">
                      <Typography.Text type="danger">{formatMoney(d.previousDebt)}</Typography.Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                )}
              </>
            )
          }
        />
      </Card>

      {d && !isDraft && !isPending && (
        <Card title="Thanh toán">
          <Table rowKey="_id" size="small" pagination={false} dataSource={d.payments} columns={paymentColumns} scroll={{ x: 900 }} />
          {d.prepaidTransactions?.length > 0 && (
            <Flex vertical gap={4} className="mt-3">
              {d.prepaidTransactions.map((t) => (
                <Typography.Text key={t._id} type="secondary">
                  <EnumTag map={PREPAID_TX_TYPES} value={t.type} /> {formatMoney(t.amount)} · {formatDateTime(t.createdAt)}
                </Typography.Text>
              ))}
            </Flex>
          )}
        </Card>
      )}

      <Modal
        open={adding}
        title="Thêm khoản thu khác"
        okText="Thêm"
        cancelText="Đóng"
        confirmLoading={addingItem}
        onCancel={() => setAdding(false)}
        onOk={() => form.submit()}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false} onFinish={(v) => addItem(v).catch(() => {})}>
          <Form.Item name="description" label="Nội dung" rules={[{ required: true, whitespace: true, min: 3, max: 200 }]}>
            <Input placeholder="Vd: Làm lại thẻ xe" maxLength={200} />
          </Form.Item>
          <Form.Item name="amount" label="Số tiền (đ)" rules={[{ required: true, type: 'number', min: 1 }]}>
            <InputNumber {...moneyInputProps} min={1} max={10_000_000_000} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <RecordPaymentModal open={collecting} invoice={d} onClose={() => setCollecting(false)} onDone={() => setCollecting(false)} />

      <ReasonModal
        open={returning}
        title="Trả lại cho Kế toán"
        hint="Thông báo về trạng thái Nháp để Kế toán sửa và trình duyệt lại."
        okText="Trả lại"
        minLength={5}
        action={(reason) => invoiceApi.returnBack({ invoiceIds: [id], reason })}
        onClose={() => setReturning(false)}
        onDone={() => (setReturning(false), reload())}
      />
    </Flex>
  );
}

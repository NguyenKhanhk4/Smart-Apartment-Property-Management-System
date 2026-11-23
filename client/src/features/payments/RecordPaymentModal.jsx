import { useNavigate } from 'react-router';
import dayjs from 'dayjs';
import { Alert, DatePicker, Form, Input, InputNumber, Modal, Radio, Typography } from 'antd';
import { paymentApi } from '../../api/moduleB.api';
import { useAction } from '../../hooks/useApi';
import { formatMoney, moneyInputProps } from '../../utils/format';

/**
 * Kế toán ghi nhận tiền mặt / chuyển khoản (UC30), mở từ:
 *  - chi tiết 1 thông báo: `invoice`
 *  - Sổ công nợ: `payer` = { apartmentId, payerId, name, apt, outstanding } (thu theo căn + Người nộp phí)
 * Tiền được phân bổ vào thông báo còn nợ CŨ NHẤT của Người nộp phí đó tại căn trước (không nhất thiết là thông báo
 * đang mở); thừa thì vào Số dư trả trước. Xong mở biên lai.
 */
export default function RecordPaymentModal({ open, invoice, payer, onClose, onDone }) {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const method = Form.useWatch('method', form);
  const outstanding = payer
    ? Math.max(0, payer.outstanding ?? 0)
    : invoice
      ? Math.max(0, invoice.totalAmount - invoice.paidAmount)
      : 0;
  const hasOlderDebt = !payer && (invoice?.previousDebt ?? 0) > 0;
  const target = payer ? { apartmentId: payer.apartmentId, payerId: payer.payerId } : { invoiceId: invoice?._id };

  const [run, loading] = useAction(
    (v) =>
      paymentApi.recordOffline({
        ...target,
        method: v.method,
        amount: v.amount,
        bankRef: v.bankRef || undefined,
        note: v.note || undefined,
        paidAt: v.paidAt?.toISOString(),
      }),
    {
      onDone: async (res) => {
        form.resetFields();
        await onDone?.(res);
        navigate(`/app/payments/${res.data._id}/receipt`, { viewTransition: true });
      },
    },
  );

  return (
    <Modal
      open={open}
      title={payer ? `Ghi nhận thu tiền — ${payer.apt} · ${payer.name ?? 'Người nộp phí'}` : `Ghi nhận thu tiền — ${invoice?.code ?? ''}`}
      okText="Ghi nhận & in biên lai"
      cancelText="Đóng"
      confirmLoading={loading}
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnHidden
    >
      {hasOlderDebt && (
        <Alert
          className="mb-3"
          type="warning"
          showIcon
          message={`Người nộp phí còn nợ các kỳ trước ${formatMoney(invoice.previousDebt)}`}
          description="Tiền thu được trừ vào kỳ cũ nhất trước, sau đó mới tới kỳ này."
        />
      )}
      {payer && (
        <Alert
          className="mb-3"
          type="info"
          showIcon
          message={`Còn nợ ${formatMoney(outstanding)}`}
          description="Tiền thu được trừ vào kỳ còn nợ cũ nhất của Người nộp phí này trước; thừa thì vào Số dư trả trước."
        />
      )}
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{ method: 'CASH', amount: outstanding || undefined, paidAt: dayjs() }}
        onFinish={(v) => run(v).catch(() => {})}
      >
        <Form.Item name="method" label="Hình thức">
          <Radio.Group
            optionType="button"
            options={[
              { value: 'CASH', label: 'Tiền mặt' },
              { value: 'BANK_TRANSFER', label: 'Chuyển khoản' },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="amount"
          label="Số tiền nhận (đ)"
          extra={
            <Typography.Text type="secondary">
              {payer ? 'Tổng còn nợ' : 'Còn nợ của thông báo này'}: {formatMoney(outstanding)}. Nhận nhiều hơn → phần thừa vào Số
              dư trả trước.
            </Typography.Text>
          }
          rules={[{ required: true, type: 'number', min: 1, message: 'Nhập số tiền' }]}
        >
          <InputNumber {...moneyInputProps} min={1} max={10_000_000_000} style={{ width: '100%' }} />
        </Form.Item>
        {method === 'BANK_TRANSFER' && (
          <Form.Item
            name="bankRef"
            label="Mã giao dịch ngân hàng"
            rules={[{ required: true, whitespace: true, message: 'Nhập mã giao dịch trên sao kê' }]}
          >
            <Input maxLength={100} placeholder="Vd: FT26290123456" />
          </Form.Item>
        )}
        <Form.Item name="paidAt" label="Thời điểm nhận tiền">
          <DatePicker showTime format="HH:mm DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
        </Form.Item>
        <Form.Item name="note" label="Ghi chú">
          <Input.TextArea rows={2} maxLength={500} placeholder="Vd: nội dung chuyển khoản sai cú pháp, đã đối chiếu" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

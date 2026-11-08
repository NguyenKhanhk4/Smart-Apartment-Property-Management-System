import { Alert, Button, Flex, Form, Input, InputNumber, Modal, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { repairQuoteApi } from '../../api/moduleB.api';
import { useAction } from '../../hooks/useApi';
import { formatMoney, moneyInputProps } from '../../utils/format';

/**
 * UC48 — Kỹ thuật viên gửi báo giá sửa chữa trong căn hộ: các hạng mục (vật tư / nhân công), số lượng, đơn giá.
 * `accepted`: bản đã được đồng ý (khi đang làm mà phát sinh thêm). Vượt `percent`% số đó → Người nộp phí phải duyệt lại.
 */
export default function QuoteFormModal({ ticket, open, accepted, pending, percent = 10, onClose, onDone }) {
  const [form] = Form.useForm();
  const lines = Form.useWatch('items', form) ?? [];
  const total = lines.reduce((s, l) => s + Math.round((l?.quantity ?? 0) * (l?.unitPrice ?? 0)), 0);
  const revising = Boolean(accepted) && ['IN_PROGRESS', 'WAITING_PARTS'].includes(ticket.status);
  const limit = revising ? Math.floor(accepted.totalAmount * (1 + percent / 100)) : 0;
  const base = pending ?? accepted;

  const [run, loading] = useAction(
    (v) =>
      repairQuoteApi.submit({
        ticketId: ticket._id,
        items: v.items.map((i) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice })),
        note: v.note || undefined,
      }),
    {
      onDone: async () => {
        onClose();
        await onDone?.();
      },
    },
  );

  return (
    <Modal
      open={open}
      title={`${revising ? 'Báo giá lại' : 'Gửi báo giá'} — ${ticket.code}`}
      okText={revising && total <= limit ? 'Cập nhật chi phí' : 'Gửi cho Người nộp phí'}
      cancelText="Đóng"
      width="min(720px, 94vw)"
      confirmLoading={loading}
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnHidden
    >
      {revising && (
        <Alert
          className="mb-3"
          type={total > limit ? 'warning' : 'info'}
          showIcon
          message={`Người nộp phí đã đồng ý ${formatMoney(accepted.totalAmount)}`}
          description={
            total > limit
              ? `Tổng mới vượt ${percent}% (trên ${formatMoney(limit)}): phiếu sẽ quay lại Chờ đồng ý phí để Người nộp phí duyệt lại.`
              : `Không vượt ${formatMoney(limit)} (${percent}%) thì cập nhật luôn, chỉ báo cho Người nộp phí.`
          }
        />
      )}
      {pending && !revising && (
        <Alert className="mb-3" type="info" showIcon message="Đang có báo giá chờ đồng ý. Gửi bản mới sẽ thay bản cũ và tính lại thời hạn phản hồi." />
      )}
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{
          items: base?.items?.map(({ description, quantity, unitPrice }) => ({ description, quantity, unitPrice })) ?? [
            { description: '', quantity: 1, unitPrice: null },
          ],
          note: base?.note ?? '',
        }}
        onFinish={(v) => run(v).catch(() => {})}
      >
        <Form.List
          name="items"
          rules={[{ validator: (_, v) => (v?.length ? Promise.resolve() : Promise.reject(new Error('Cần ít nhất 1 hạng mục'))) }]}
        >
          {(fields, { add, remove }, { errors }) => (
            <>
              {fields.map(({ key, name }) => (
                <Flex key={key} gap={8} align="start" wrap>
                  <Form.Item
                    name={[name, 'description']}
                    style={{ flex: 1, minWidth: 220 }}
                    rules={[{ required: true, min: 2, message: 'Nhập hạng mục' }]}
                  >
                    <Input placeholder="Hạng mục (vd: Thay vòi sen, Công thợ)" maxLength={200} />
                  </Form.Item>
                  <Form.Item name={[name, 'quantity']} rules={[{ required: true, message: 'SL' }]}>
                    <InputNumber min={0.01} max={10000} placeholder="SL" style={{ width: 80 }} />
                  </Form.Item>
                  <Form.Item name={[name, 'unitPrice']} rules={[{ required: true, message: 'Đơn giá' }]}>
                    <InputNumber {...moneyInputProps} min={0} placeholder="Đơn giá" style={{ width: 160 }} />
                  </Form.Item>
                  <Button type="text" danger icon={<DeleteOutlined />} disabled={fields.length === 1} onClick={() => remove(name)} />
                </Flex>
              ))}
              <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ quantity: 1 })} disabled={fields.length >= 30}>
                Thêm hạng mục
              </Button>
              <Form.ErrorList errors={errors} />
            </>
          )}
        </Form.List>
        <Typography.Title level={5} style={{ textAlign: 'right', margin: '12px 0' }}>
          Tổng chi phí dự kiến: {formatMoney(total)}
        </Typography.Title>
        <Form.Item name="note" label="Mô tả hư hỏng, cách xử lý, thời gian dự kiến">
          <Input.TextArea rows={3} maxLength={1000} showCount />
        </Form.Item>
        <Typography.Text type="secondary">
          Chi phí được tính vào thông báo phí kỳ sau khi Người nộp phí nghiệm thu kết quả sửa chữa.
        </Typography.Text>
      </Form>
    </Modal>
  );
}

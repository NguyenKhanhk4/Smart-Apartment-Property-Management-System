import dayjs from 'dayjs';
import { DatePicker, Form, Input, Modal, Select, Typography } from 'antd';
import { debtApi } from '../../api/moduleB.api';
import { CONTACT_METHODS } from '../../constants/enums';
import { useAction } from '../../hooks/useApi';

/**
 * Trưởng BQL ghi kết quả xử lý nợ quá hạn (UC31): hình thức liên hệ, phản hồi, biện pháp đã áp dụng, ngày hẹn trả.
 * Có ngày hẹn → hệ thống tạm dừng nhắc tự động đến hết ngày đó; quá hẹn mà chưa trả đủ sẽ báo lại.
 */
export default function DebtActivityModal({ open, caseId, payerName, onClose, onDone }) {
  const [form] = Form.useForm();
  const [run, loading] = useAction(
    (v) =>
      debtApi.recordActivity(caseId, {
        method: v.method,
        response: v.response || undefined,
        measures: v.measures || undefined,
        note: v.note || undefined,
        promisedDate: v.promisedDate ? v.promisedDate.format('YYYY-MM-DD') : undefined,
      }),
    {
      onDone: async () => {
        form.resetFields();
        await onDone?.();
        onClose();
      },
    },
  );

  return (
    <Modal
      open={open}
      title={`Ghi kết quả xử lý nợ${payerName ? ` — ${payerName}` : ''}`}
      okText="Lưu"
      cancelText="Đóng"
      confirmLoading={loading}
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={(v) => run(v).catch(() => {})} initialValues={{ method: 'PHONE' }}>
        <Form.Item name="method" label="Hình thức liên hệ" rules={[{ required: true, message: 'Chọn hình thức liên hệ' }]}>
          <Select options={Object.entries(CONTACT_METHODS).map(([value, m]) => ({ value, label: m.label }))} />
        </Form.Item>
        <Form.Item name="response" label="Phản hồi của Người nộp phí">
          <Input.TextArea rows={2} maxLength={1000} placeholder="Vd: hẹn trả sau ngày nhận lương; không nghe máy; từ chối vì khiếu nại phí" />
        </Form.Item>
        <Form.Item
          name="promisedDate"
          label="Ngày hẹn trả"
          extra="Hệ thống tạm dừng nhắc nợ đến hết ngày này; quá hẹn mà chưa trả đủ sẽ báo lại cho Trưởng BQL."
        >
          <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d && d.isBefore(dayjs(), 'day')} />
        </Form.Item>
        <Form.Item name="measures" label="Biện pháp đã áp dụng">
          <Input.TextArea rows={2} maxLength={1000} placeholder="Vd: gửi Thông báo nợ quá hạn bằng văn bản" />
        </Form.Item>
        <Form.Item name="note" label="Ghi chú">
          <Input.TextArea rows={2} maxLength={1000} />
        </Form.Item>
        <Typography.Text type="secondary">Hệ thống không tự áp dụng biện pháp cưỡng chế nào.</Typography.Text>
      </Form>
    </Modal>
  );
}

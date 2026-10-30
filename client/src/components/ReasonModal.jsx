import { Form, Input, Modal, Typography } from 'antd';
import { useAction } from '../hooks/useApi';

/**
 * Modal nhập lý do dùng chung (từ chối, hủy...). `action(reason)` trả promise; thành công thì onDone().
 * `label`, `placeholder`, `required` tùy chọn.
 */
export default function ReasonModal({
  open,
  title,
  hint,
  okText,
  label = 'Lý do',
  placeholder,
  minLength = 1,
  action,
  onClose,
  onDone,
}) {
  const [form] = Form.useForm();
  const [run, loading] = useAction((v) => action(v.reason.trim()), {
    onDone: () => {
      form.resetFields();
      onDone();
    },
  });
  return (
    <Modal
      open={open}
      title={title}
      okText={okText}
      cancelText="Đóng"
      okButtonProps={{ danger: true }}
      confirmLoading={loading}
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnHidden
    >
      {hint && <Typography.Paragraph type="secondary">{hint}</Typography.Paragraph>}
      <Form form={form} layout="vertical" preserve={false} onFinish={(v) => run(v).catch(() => {})}>
        <Form.Item
          name="reason"
          label={label}
          rules={[{ required: true, whitespace: true, min: minLength, max: 500, message: `Nhập lý do (tối thiểu ${minLength} ký tự)` }]}
        >
          <Input.TextArea rows={3} maxLength={500} showCount placeholder={placeholder} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

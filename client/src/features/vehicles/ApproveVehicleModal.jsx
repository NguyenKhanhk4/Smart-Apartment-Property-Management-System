import { Form, Input, Modal } from 'antd';
import { vehicleApi } from '../../api/moduleA.api';
import { useAction } from '../../hooks/useApi';

// UC66 — Duyệt đăng ký xe kèm cấp số thẻ gửi xe (server bắt buộc cardNumber). Dùng ở Yêu cầu gửi xe và trang chủ Lễ tân.
export default function ApproveVehicleModal({ vehicle, open, onClose, onDone }) {
  const [form] = Form.useForm();
  const [approve, approving] = useAction(
    (values) => vehicleApi.approve(vehicle._id, { cardNumber: values.cardNumber.trim().toUpperCase() }),
    {
      success: 'Đã duyệt đăng ký xe và cấp thẻ gửi xe',
      onDone: () => {
        onClose();
        onDone?.();
      },
    },
  );

  return (
    <Modal
      title={`Duyệt phương tiện & cấp thẻ gửi xe: ${vehicle?.plateNumber || vehicle?.type || ''}`}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={approving}
      okText="Xác nhận duyệt & cấp thẻ"
      cancelText="Hủy"
      destroyOnHidden
    >
      <Form form={form} layout="vertical" preserve={false} onFinish={(v) => approve(v).catch(() => {})} className="mt-4">
        <Form.Item
          name="cardNumber"
          label="Số thẻ gửi xe (bắt buộc)"
          rules={[{ required: true, whitespace: true, message: 'Vui lòng nhập số thẻ gửi xe' }]}
          extra="Thẻ gửi xe được kích hoạt (ACTIVE) ngay khi duyệt phương tiện."
        >
          <Input placeholder="Ví dụ: PC-A101-01" className="uppercase font-semibold" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

import { useState } from 'react';
import { Alert, App, Form, Input, Modal } from 'antd';
import { apartmentsApi } from '../../api/moduleA.api';

export default function ApartmentDeleteModal({ apartment, onClose, onSaved }) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    try {
      const body = await form.validateFields();
      setSaving(true);
      await apartmentsApi.delete(apartment._id, body);
      message.success('Đã xóa bản ghi căn hộ nhập nhầm');
      onSaved();
    } catch (err) { if (!err.errorFields) setError(err.message); }
    finally { setSaving(false); }
  };
  return <Modal open title={`Xóa bản ghi nhập nhầm — ${apartment.code}`} onCancel={saving ? undefined : onClose}
    onOk={save} confirmLoading={saving} okText="Xóa bản ghi" okButtonProps={{ danger: true }}>
    <Alert type="warning" showIcon title="Chỉ xóa căn nhập nhầm chưa có bất kỳ hồ sơ liên quan nào. Hệ thống kiểm tra lại trước khi xóa." className="mb-4" />
    {error && <Alert type="error" showIcon title={error} className="mb-4" />}
    <Form form={form} layout="vertical">
      <Form.Item name="reason" label="Lý do xác định căn nhập nhầm" rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={500} /></Form.Item>
      <Form.Item name="sourceReference" label="Tài liệu đối chiếu" rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={500} /></Form.Item>
    </Form>
  </Modal>;
}

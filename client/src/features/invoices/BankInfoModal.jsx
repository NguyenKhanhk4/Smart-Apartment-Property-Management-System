import { useEffect } from 'react';
import { Alert, Form, Input, Modal } from 'antd';
import { systemConfigApi } from '../../api/moduleE.api';
import { useAction, useApi } from '../../hooks/useApi';

// Tài khoản nhận tiền in trên thông báo phí (PDF + màn hình cư dân). Lưu ở tham số hệ thống (Trưởng BQL sửa, ghi Audit Log)
// cho tới khi có trang thông tin tòa nhà của Mô đun 1.
const FIELDS = [
  { key: 'BANK_NAME', label: 'Ngân hàng', placeholder: 'Vd: Vietcombank — CN Hà Nội' },
  { key: 'BANK_ACCOUNT_NO', label: 'Số tài khoản', placeholder: 'Vd: 0123456789' },
  { key: 'BANK_ACCOUNT_NAME', label: 'Chủ tài khoản', placeholder: 'Vd: BAN QUAN LY TOA NHA ABC' },
];

export default function BankInfoModal({ open, onClose }) {
  const [form] = Form.useForm();
  const configs = useApi(() => systemConfigApi.list(), [], { enabled: open });
  const current = Object.fromEntries((configs.data ?? []).map((c) => [c.key, c.value]));
  const missing = configs.data && FIELDS.some((f) => !(f.key in current));

  useEffect(() => {
    if (configs.data) form.setFieldsValue(Object.fromEntries(FIELDS.map((f) => [f.key, current[f.key] ?? ''])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configs.data]);

  const [save, saving] = useAction(
    async (values) => {
      for (const f of FIELDS) {
        const value = values[f.key].trim();
        if (value !== (current[f.key] ?? '')) await systemConfigApi.update(f.key, value);
      }
    },
    { success: 'Đã lưu tài khoản nhận tiền', onDone: onClose },
  );

  return (
    <Modal
      open={open}
      title="Tài khoản nhận tiền phí dịch vụ"
      okText="Lưu"
      cancelText="Đóng"
      confirmLoading={saving}
      okButtonProps={{ disabled: missing }}
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnHidden
    >
      {missing && (
        <Alert className="mb-3" type="warning" showIcon message="CSDL chưa có tham số tài khoản nhận tiền. Chạy npm run db:sync ở server rồi mở lại." />
      )}
      <Form form={form} layout="vertical" disabled={configs.loading} onFinish={(v) => save(v).catch(() => {})}>
        {FIELDS.map((f) => (
          <Form.Item key={f.key} name={f.key} label={f.label} rules={[{ required: true, whitespace: true, max: 200 }]}>
            <Input placeholder={f.placeholder} maxLength={200} />
          </Form.Item>
        ))}
      </Form>
    </Modal>
  );
}

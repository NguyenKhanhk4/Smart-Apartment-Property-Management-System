import { Form, Input } from 'antd';
import { SafetyOutlined } from '@ant-design/icons';

const REQUIRED = { required: true, message: 'Vui lòng nhập mã xác minh' };
const EMAIL_RULE = { pattern: /^\d{6}$/, transform: (value) => value?.trim(), message: 'Mã qua email gồm 6 chữ số' };
const DESK_RULE = {
  pattern: /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/i,
  transform: (value) => value?.replace(/[\s-]/g, ''),
  message: 'Nhập đúng 8 ký tự trên phiếu mã tại quầy',
};

export default function VerificationCodeField({ desk }) {
  return (
    <Form.Item name="code" label={desk ? 'Mã in tại quầy' : 'Mã xác minh qua email'} rules={[REQUIRED, desk ? DESK_RULE : EMAIL_RULE]}>
      <Input
        size="large"
        prefix={<SafetyOutlined className="text-ink-3" />}
        placeholder={desk ? '8 ký tự chữ hoặc số, ví dụ ABCD-2345' : 'Nhập 6 chữ số trong email'}
        inputMode={desk ? 'text' : 'numeric'}
        autoComplete="one-time-code"
      />
    </Form.Item>
  );
}

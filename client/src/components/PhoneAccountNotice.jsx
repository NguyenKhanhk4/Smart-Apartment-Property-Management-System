import { Alert, Button } from 'antd';

const accountSummary = ({ fullName, email, idNumber }) =>
  [fullName, email, idNumber && `CCCD ${idNumber}`].filter(Boolean).join(' · ');

/** Kết quả tra SĐT trong form gắn người vào căn hộ. `check` lấy từ usePhoneAccount */
export default function PhoneAccountNotice({ check }) {
  const { status, account, phone } = check;
  const show = (props) => <Alert showIcon className="mb-4" {...props} />;

  switch (status) {
    case 'checking':
      return show({ type: 'info', title: 'Đang kiểm tra số điện thoại...' });
    case 'error':
      return show({
        type: 'error',
        title: 'Chưa kiểm tra được số điện thoại',
        action: <Button size="small" onClick={check.reload}>Thử lại</Button>,
      });
    case 'internal':
      return show({ type: 'error', title: 'Số điện thoại này thuộc tài khoản nội bộ, không thể gắn làm cư dân' });
    case 'new':
      return show({
        type: 'info',
        title: `Chưa có tài khoản với số ${phone}. Hệ thống sẽ tạo tài khoản mới.`,
        description: 'Kiểm tra lại số điện thoại với giấy tờ trước khi lưu.',
      });
    case 'existing':
      return show({
        type: 'warning',
        title: `Số ${phone} đã có tài khoản: ${accountSummary(account)}`,
        description: 'Đối chiếu với giấy tờ. Nếu không phải người này, hãy kiểm tra lại số điện thoại.',
        action: <Button size="small" type="primary" onClick={check.confirm}>Đúng người này</Button>,
      });
    case 'confirmed':
      return show({
        type: 'success',
        title: `Đã xác nhận: ${accountSummary(account)}`,
        description: 'Thông tin tài khoản giữ nguyên, hệ thống chỉ thêm căn hộ này.',
        action: <Button size="small" onClick={check.reset}>Chọn lại</Button>,
      });
    default:
      return null;
  }
}

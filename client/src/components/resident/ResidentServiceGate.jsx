import { Alert, Button, Space, Spin } from 'antd';
import { useLocation, useNavigate } from 'react-router';
import { useResident } from '../../hooks/useResident';

export default function ResidentServiceGate({ children }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { loading, canUseServices, residency } = useResident();
  const servicePage = /^\/r\/(amenities|tickets|guests|my-vehicles|my-code|bookings)(\/|$)/.test(pathname);
  if (!servicePage) return children;
  if (loading) return <Spin tip="Đang kiểm tra trạng thái cư trú..." />;
  if (residency && canUseServices === false) return (
    <Alert type="warning" showIcon title="Cần Ban quản lý xác nhận vào ở"
      description={<Space direction="vertical">
        <span>Căn {residency.code} chưa được ghi nhận vào ở. Chưa thể đăng ký dịch vụ, xe, thẻ hoặc gửi phản ánh. Bạn vẫn xem và thanh toán thông báo phí bình thường.</span>
        <Button type="primary" onClick={() => navigate('/r/my-apartment')}>Thông báo bắt đầu ở</Button>
      </Space>} />
  );
  return children;
}

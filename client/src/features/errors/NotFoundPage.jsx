import { Link } from 'react-router';
import { Button, Result } from 'antd';

export default function NotFoundPage() {
  return (
    <Result
      status="404"
      title="404"
      subTitle="Trang bạn tìm không tồn tại."
      extra={
        <Link to="/">
          <Button type="primary">Về trang chủ</Button>
        </Link>
      }
    />
  );
}

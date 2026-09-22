import { Link } from 'react-router';
import { Button, Result } from 'antd';

export default function ForbiddenPage() {
  return (
    <Result
      status="403"
      title="403"
      subTitle="Bạn không có quyền truy cập trang này."
      extra={
        <Link to="/">
          <Button type="primary">Về trang chủ</Button>
        </Link>
      }
    />
  );
}

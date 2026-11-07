import { Result } from 'antd';

// Giữ chỗ cho trang chưa làm
export default function PlaceholderPage({ title, description }) {
  return (
    <Result
      status="info"
      title={title}
      subTitle={description ?? 'Chức năng đang được phát triển.'}
    />
  );
}

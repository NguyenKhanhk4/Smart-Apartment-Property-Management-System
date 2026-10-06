import { Flex, Spin } from 'antd';

// Fallback khi đang tải trang lazy
export default function PageLoader() {
  return (
    <Flex align="center" justify="center" style={{ minHeight: 240 }}>
      <Spin />
    </Flex>
  );
}

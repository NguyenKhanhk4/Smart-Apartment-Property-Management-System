import { Outlet } from 'react-router';
import { Card, Flex, Typography } from 'antd';

// Khung cho trang login / register: card giữa màn hình
export default function AuthLayout() {
  return (
    <Flex align="center" justify="center" style={{ minHeight: '100vh', padding: 16 }}>
      <Card style={{ width: '100%', maxWidth: 420 }}>
        <Typography.Title level={3} style={{ textAlign: 'center', marginTop: 0 }}>
          SAPMS
        </Typography.Title>
        <Outlet />
      </Card>
    </Flex>
  );
}

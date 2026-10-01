import { useState } from 'react';
import { App, Button, Card, Dropdown, Empty, Flex, Statistic, Typography } from 'antd';
import { DownloadOutlined, FileExcelOutlined, FilePdfOutlined } from '@ant-design/icons';
import { reportApi } from '../../api/moduleE.api';
import { useAuth } from '../../hooks/useAuth';

/** UC-E13 — Nút xuất Excel/PDF, kế thừa bộ lọc đang xem. Chỉ Manager/Accountant. */
export function ExportButton({ type, params }) {
  const { message } = App.useApp();
  const { hasRole } = useAuth();
  const [loading, setLoading] = useState(false);
  if (!hasRole('MANAGER', 'ACCOUNTANT')) return null;

  const download = async ({ key: format }) => {
    setLoading(true);
    try {
      const name = await reportApi.download({ ...params, type, format });
      message.success(`Đã tải ${name}`);
    } catch (e) {
      message.error(e.message || 'Xuất báo cáo thất bại, thử lại với khoảng thời gian nhỏ hơn');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dropdown
      menu={{
        items: [
          { key: 'xlsx', icon: <FileExcelOutlined style={{ color: '#217346' }} />, label: 'Excel (.xlsx)' },
          { key: 'pdf', icon: <FilePdfOutlined style={{ color: '#d4380d' }} />, label: 'PDF' },
        ],
        onClick: download,
      }}
    >
      <Button icon={<DownloadOutlined />} loading={loading}>
        Xuất báo cáo
      </Button>
    </Dropdown>
  );
}

/** Ô số liệu tổng quan */
export function StatCard({ title, value, formatter, suffix, color, hint }) {
  return (
    <Card size="small" style={{ flex: '1 1 180px', minWidth: 160 }}>
      <Statistic
        title={title}
        value={value ?? 0}
        formatter={formatter}
        suffix={suffix}
        styles={color ? { content: { color } } : undefined}
      />
      {hint && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {hint}
        </Typography.Text>
      )}
    </Card>
  );
}

export function StatRow({ children }) {
  return (
    <Flex gap={12} wrap>
      {children}
    </Flex>
  );
}

/** Card chứa biểu đồ; không có dữ liệu → "Không có dữ liệu" thay vì báo lỗi */
export function ChartCard({ title, empty, height = 300, children, extra, style }) {
  return (
    <Card size="small" title={title} extra={extra} style={{ flex: '1 1 420px', minWidth: 0, ...style }}>
      {empty ? (
        <Empty description="Không có dữ liệu" style={{ height, display: 'grid', placeContent: 'center' }} />
      ) : (
        <div style={{ width: '100%', height }}>{children}</div>
      )}
    </Card>
  );
}

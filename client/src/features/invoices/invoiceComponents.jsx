// Component dùng chung cho các trang thông báo phí / biên lai (quản trị + cư dân)
import { useState } from 'react';
import { App, Button, Descriptions, Typography } from 'antd';
import { FilePdfOutlined } from '@ant-design/icons';

/** Nút tải file PDF: `download()` trả về tên file đã lưu */
export function DownloadPdfButton({ download, label = 'Tải PDF', ...props }) {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const run = async () => {
    setLoading(true);
    try {
      message.success(`Đã tải ${await download()}`);
    } catch (err) {
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Button icon={<FilePdfOutlined />} loading={loading} onClick={run} {...props}>
      {label}
    </Button>
  );
}

/** Hướng dẫn chuyển khoản: tài khoản nhận tiền + nội dung mẫu "A1205 T10-2026" (payInfo từ chi tiết thông báo) */
export function PayInfo({ payInfo }) {
  if (!payInfo) return null;
  return (
    <Descriptions column={{ xs: 1, md: 2 }} size="small" bordered>
      <Descriptions.Item label="Ngân hàng">{payInfo.bankName ?? 'Liên hệ Ban quản lý'}</Descriptions.Item>
      <Descriptions.Item label="Số tài khoản">
        {payInfo.accountNo ? <Typography.Text copyable>{payInfo.accountNo}</Typography.Text> : '—'}
      </Descriptions.Item>
      <Descriptions.Item label="Chủ tài khoản">{payInfo.accountName ?? '—'}</Descriptions.Item>
      <Descriptions.Item label="Nội dung chuyển khoản">
        <Typography.Text strong copyable>
          {payInfo.content}
        </Typography.Text>
      </Descriptions.Item>
    </Descriptions>
  );
}

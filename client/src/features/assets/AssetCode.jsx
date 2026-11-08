import { Typography } from 'antd';

// Mã thiết bị (UC07): chữ đơn cách, đậm, cỡ rõ. Không dùng Typography.Text code vì antd thu nhỏ chữ bên trong còn 85%.
// Thiết bị cũ chưa có mã (chưa chạy migrate) thì ghi rõ thay vì để ô trống.
export default function AssetCode({ code, size = 13 }) {
  if (!code) return <Typography.Text type="secondary" italic style={{ fontSize: size - 1 }}>Chưa có mã</Typography.Text>;
  return (
    <span
      style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: size,
        fontWeight: 600,
        letterSpacing: 0.3,
        padding: '1px 6px',
        borderRadius: 4,
        background: 'var(--ant-color-fill-tertiary)',
        border: '1px solid var(--ant-color-border-secondary)',
        alignSelf: 'flex-start',
        whiteSpace: 'nowrap',
      }}
    >
      {code}
    </span>
  );
}

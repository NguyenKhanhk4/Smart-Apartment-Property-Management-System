import { useState } from 'react';
import { Button, Modal } from 'antd';
import { ExclamationCircleOutlined, QrcodeOutlined } from '@ant-design/icons';
import { paymentApi } from '../../api/moduleB.api';
import { formatMoney } from '../../utils/format';

/**
 * Thanh toán online qua payOS (UC29): tạo link rồi chuyển sang trang thanh toán payOS (quét VietQR / chọn ngân hàng).
 * Thanh toán xong payOS đưa về /r/payments/result?orderCode=... để xem kết quả.
 * Khi cổng thanh toán online bị lỗi / gián đoạn: hiển thị hộp thoại hướng dẫn cư dân giải pháp thay thế.
 */
export default function PayosButton({ invoiceIds, amount, block, children }) {
  const [loading, setLoading] = useState(false);

  const handlePay = async () => {
    setLoading(true);
    try {
      const res = await paymentApi.payosCreate({ invoiceIds });
      if (res?.data?.checkoutUrl) {
        window.location.assign(res.data.checkoutUrl);
      }
    } catch {
      Modal.warning({
        title: 'Cổng thanh toán online đang gián đoạn',
        icon: <ExclamationCircleOutlined className="text-r-warn-fg" />,
        centered: true,
        content: (
          <div className="text-[13px] text-r-text mt-2 leading-relaxed space-y-2">
            <p className="text-r-muted">
              Hệ thống kết nối PayOS hiện đang bảo trì hoặc gặp sự cố kỹ thuật gián đoạn tạm thời.
            </p>
            <div className="p-3 bg-r-warn-bg border border-r-border rounded-xl space-y-1.5 text-[12px]">
              <div className="font-semibold text-r-warn-fg">Giải pháp cho Quý cư dân:</div>
              <div>• Quý cư dân vui lòng quay lại <strong>thử lại sau 15 – 30 phút</strong>.</div>
              <div>• Hoặc đến thanh toán trực tiếp tại <strong>Văn phòng Ban Quản lý (Tầng 1)</strong> (tiền mặt / POS).</div>
            </div>
          </div>
        ),
        okText: 'Đã hiểu',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      type="primary"
      size="large"
      block={block}
      icon={<QrcodeOutlined />}
      loading={loading}
      disabled={!invoiceIds?.length}
      onClick={handlePay}
    >
      {children ?? `Thanh toán online ${formatMoney(amount)}`}
    </Button>
  );
}

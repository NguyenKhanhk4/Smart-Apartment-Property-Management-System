import { Button } from 'antd';
import { QrcodeOutlined } from '@ant-design/icons';
import { paymentApi } from '../../api/moduleB.api';
import { useAction } from '../../hooks/useApi';
import { formatMoney } from '../../utils/format';

/**
 * Thanh toán online qua payOS (UC29): tạo link rồi chuyển sang trang thanh toán payOS (quét VietQR / chọn ngân hàng).
 * Thanh toán xong payOS đưa về /r/payments/result?orderCode=... để xem kết quả.
 */
export default function PayosButton({ invoiceIds, amount, block, children }) {
  const [pay, loading] = useAction(() => paymentApi.payosCreate({ invoiceIds }), {
    success: false,
    onDone: (res) => {
      window.location.assign(res.data.checkoutUrl);
    },
  });
  return (
    <Button
      type="primary"
      size="large"
      block={block}
      icon={<QrcodeOutlined />}
      loading={loading}
      disabled={!invoiceIds?.length}
      onClick={() => pay().catch(() => {})}
    >
      {children ?? `Thanh toán online ${formatMoney(amount)}`}
    </Button>
  );
}

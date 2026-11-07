import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button, Result, Spin } from 'antd';
import { paymentApi } from '../../api/moduleB.api';
import { useApi } from '../../hooks/useApi';
import { usePolling } from '../../hooks/usePolling';
import { formatDateTime, formatMoney } from '../../utils/format';
import { periodLabel } from '../invoices/invoiceShared';

// payOS đưa cư dân về đây sau khi thanh toán / hủy: /r/payments/result?orderCode=...&status=PAID|CANCELLED...
// Không tin tham số trên URL: luôn hỏi server (server hỏi lại payOS) rồi mới báo kết quả.
const MAX_POLLS = 20; // ~1 phút

export default function PaymentResultPage() {
  const [search] = useSearchParams();
  const orderCode = search.get('orderCode');
  const [polls, setPolls] = useState(0);
  const res = useApi(() => paymentApi.payosStatus(orderCode), [orderCode], { enabled: Boolean(orderCode) });
  const p = res.data;
  const waiting = p?.status === 'PENDING' && polls < MAX_POLLS;

  usePolling(
    () => {
      setPolls((n) => n + 1);
      res.reload();
    },
    3000,
    { enabled: waiting },
  );

  if (!orderCode) return <Result status="warning" title="Thiếu mã giao dịch" extra={<BackButton />} />;
  if (!p) return res.loading ? <Spin size="large" className="block! mx-auto mt-16" /> : <Result status="error" title="Không tìm thấy giao dịch" extra={<BackButton />} />;

  if (p.status === 'SUCCESS') {
    return (
      <Result
        status="success"
        title={`Thanh toán thành công ${formatMoney(p.amount)}`}
        subTitle={
          <>
            {formatDateTime(p.paidAt)} · Mã {p.orderCode}
            {p.allocations.map((a) => (
              <div key={String(a.invoiceId)}>
                Kỳ {periodLabel(a.invoice?.period)} ({a.invoice?.code}): {formatMoney(a.amount)}
              </div>
            ))}
            {p.creditAmount > 0 && <div>{formatMoney(p.creditAmount)} đã vào Số dư trả trước</div>}
          </>
        }
        extra={[
          <Link key="r" to={`/r/payments/${p.paymentId}/receipt`}>
            <Button type="primary">Xem biên lai</Button>
          </Link>,
          <BackButton key="b" />,
        ]}
      />
    );
  }
  if (p.status === 'FAILED') {
    return <Result status="warning" title="Thanh toán chưa hoàn tất" subTitle="Giao dịch đã bị hủy hoặc hết hạn. Bạn có thể thanh toán lại." extra={<BackButton />} />;
  }
  return (
    <Result
      status="info"
      icon={waiting ? <Spin size="large" /> : undefined}
      title={waiting ? 'Đang chờ xác nhận từ ngân hàng…' : 'Chưa nhận được kết quả thanh toán'}
      subTitle={
        waiting
          ? 'Vui lòng giữ trang này trong giây lát.'
          : 'Nếu bạn đã chuyển tiền, hệ thống sẽ tự cập nhật và gửi biên lai khi nhận được xác nhận. Ban quản lý sẽ đối soát nếu cần.'
      }
      extra={
        p.checkoutUrl && !waiting ? (
          <>
            <Button href={p.checkoutUrl}>Mở lại trang thanh toán</Button>
            <BackButton />
          </>
        ) : (
          <BackButton />
        )
      }
    />
  );
}

function BackButton() {
  return (
    <Link to="/r/invoices">
      <Button>Về Phí dịch vụ</Button>
    </Link>
  );
}

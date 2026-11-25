import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Skeleton } from 'antd';
import { ExclamationCircleOutlined, ExportOutlined, ReloadOutlined } from '@ant-design/icons';
import { QRCodeSVG } from 'qrcode.react';
import { paymentApi } from '../../api/moduleB.api';
import SurfaceCard from '../../components/resident/SurfaceCard';
import { usePolling } from '../../hooks/usePolling';
import { formatMoney } from '../../utils/format';

const POLL_MS = 3000;

function useCountdown(until) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000)) : 0;
}

/**
 * Mã VietQR của payOS hiện ngay trên trang (UC29): tạo / dùng lại link thanh toán (server dùng lại link còn hạn
 * cho đúng các thông báo phí này), quét bằng app ngân hàng; tự hỏi trạng thái và chuyển sang trang kết quả khi đã trả.
 * Khi cổng thanh toán online bị lỗi / gián đoạn: hiển thị thông báo hướng dẫn cư dân giải pháp thay thế.
 */
export default function PayosQrPanel({ invoiceIds, amount, className = '' }) {
  const navigate = useNavigate();
  const [state, setState] = useState({ link: null, error: null, loading: true });
  const [attempt, setAttempt] = useState(0); // tăng để tạo lại mã (hết hạn / bị hủy / lỗi)
  const key = invoiceIds.join(',');

  useEffect(() => {
    let alive = true;
    paymentApi.payosCreate({ invoiceIds: key.split(',') }).then(
      (res) => alive && setState({ link: res.data, error: null, loading: false }),
      (err) => alive && setState({ link: null, error: err.message || 'Không tạo được mã thanh toán', loading: false }),
    );
    return () => {
      alive = false;
    };
  }, [key, attempt]);

  const regenerate = () => {
    setState({ link: null, error: null, loading: true });
    setAttempt((n) => n + 1);
  };

  const { link, error, loading } = state;
  const left = useCountdown(link?.expiredAt);
  const expired = Boolean(link) && left === 0;

  usePolling(
    async () => {
      try {
        const res = await paymentApi.payosStatus(link.orderCode);
        if (res.data.status === 'SUCCESS') {
          navigate(`/r/payments/result?orderCode=${link.orderCode}`, { viewTransition: true });
        } else if (res.data.status === 'FAILED') {
          regenerate(); // cư dân hủy trên trang payOS / link hết hạn → mã mới
        }
      } catch {
        // lỗi mạng tạm thời: lần sau hỏi lại
      }
    },
    POLL_MS,
    { enabled: Boolean(link?.orderCode) && !expired },
  );

  return (
    <SurfaceCard className={`p-4 md:p-5 ${className}`}>
      <h2 className="text-base font-semibold mb-1">Quét mã để thanh toán</h2>
      <p className="text-r-muted text-[13px] mb-3">
        Mở app ngân hàng bất kỳ và quét mã QR. Hệ thống tự gạch nợ ngay khi nhận được tiền.
      </p>

      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : error ? (
        <div className="py-1 flex flex-col gap-3">
          <div className="p-3.5 bg-r-warn-bg border border-r-border rounded-xl text-left">
            <div className="flex items-start gap-2.5">
              <ExclamationCircleOutlined className="text-r-warn-fg text-base mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-r-text text-[13.5px] leading-snug">
                  Cổng thanh toán online đang gián đoạn
                </div>
                <div className="text-r-muted text-[12.5px] mt-1.5 leading-relaxed">
                  Hệ thống kết nối PayOS hiện đang bảo trì hoặc gặp sự cố kỹ thuật tạm thời.
                </div>
              </div>
            </div>

            <div className="mt-3 pt-2.5 border-t border-r-border/80 text-[12px] text-r-text space-y-1.5">
              <div className="font-medium text-r-warn-fg">Giải pháp cho Quý cư dân:</div>
              <div className="flex items-start gap-1.5">
                <span className="shrink-0">•</span>
                <span>Quý cư dân vui lòng quay lại <strong>thử lại sau 15 – 30 phút</strong>.</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="shrink-0">•</span>
                <span>Hoặc đến thanh toán trực tiếp tại <strong>Văn phòng Ban Quản lý (Tầng 1)</strong> (tiền mặt / POS).</span>
              </div>
            </div>
          </div>

          <Button
            type="primary"
            icon={<ReloadOutlined />}
            onClick={regenerate}
            block
            className="mt-0.5"
          >
            Thử kết nối lại
          </Button>
        </div>
      ) : (
        link?.qrCode && (
          <div className="flex flex-col items-center gap-3">
            <div className={`rounded-lg bg-white p-3 border border-r-border ${expired ? 'opacity-30' : ''}`}>
              <QRCodeSVG value={link.qrCode} size={220} level="M" marginSize={0} />
            </div>
            {expired ? (
              <Button type="primary" icon={<ReloadOutlined />} onClick={regenerate}>
                Mã đã hết hạn — tạo mã mới
              </Button>
            ) : (
              <span className="text-r-muted text-[12px]">
                Mã hết hạn sau {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
              </span>
            )}
            <div className="text-xl font-semibold">{formatMoney(link.amount ?? amount)}</div>
            <a href={link.checkoutUrl} className="text-[13px]">
              Mở trang thanh toán payOS <ExportOutlined />
            </a>
          </div>
        )
      )}
    </SurfaceCard>
  );
}

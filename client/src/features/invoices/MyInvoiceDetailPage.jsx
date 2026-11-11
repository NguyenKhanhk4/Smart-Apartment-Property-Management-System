import { Link, useNavigate, useParams } from 'react-router';
import { Alert, Button, Flex, Grid, Skeleton, Typography } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { invoiceApi } from '../../api/moduleB.api';
import PageHeader from '../../components/PageHeader';
import StatusBadge from '../../components/resident/StatusBadge';
import SurfaceCard from '../../components/resident/SurfaceCard';
import { FEE_CATEGORIES, INVOICE_STATUS, PAYMENT_METHODS } from '../../constants/enums';
import { useApi } from '../../hooks/useApi';
import { formatDate, formatDateTime, formatMoney } from '../../utils/format';
import PayosButton from '../payments/PayosButton';
import PayosQrPanel from '../payments/PayosQrPanel';
import { DownloadPdfButton } from './invoiceComponents';
import { INVOICE_TONE, OUTSTANDING_STATUSES, outstandingOf, periodLabel } from './invoiceShared';

// Mô đun 4 — UC28: chi tiết thông báo phí cho cư dân: thanh toán payOS, hướng dẫn chuyển khoản, tải PDF.
function Row({ label, value, strong, muted, danger }) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <span className={muted ? 'text-r-muted' : ''}>{label}</span>
      <span className={`text-right ${strong ? 'font-semibold' : ''} ${danger ? 'text-r-warn-fg' : ''}`}>{value}</span>
    </div>
  );
}

export default function MyInvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: d, loading } = useApi(() => invoiceApi.get(id), [id]);
  const outstanding = d ? outstandingOf(d) : 0;
  const due = d && OUTSTANDING_STATUSES.includes(d.status);
  const canPay = Boolean(d?.isPayer && due && outstanding > 0);
  const wide = Grid.useBreakpoint().lg; // màn hình rộng: mã QR payOS ở cột phải; điện thoại: nút chuyển sang trang payOS

  return (
    <div className="flex flex-col lg:flex-row lg:items-start gap-4">
      <div className="flex flex-col gap-4 max-w-3xl w-full min-w-0">
        <PageHeader
          className="mb-0"
          title={d ? `Phí tháng ${periodLabel(d.period)}` : 'Thông báo phí'}
          extra={
            <Flex gap={8} wrap>
              {d && <DownloadPdfButton download={() => invoiceApi.downloadPdf(id)} />}
              <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/r/invoices', { viewTransition: true })}>
                Danh sách
              </Button>
            </Flex>
          }
        />

        {loading && !d ? (
          <Skeleton active />
        ) : (
          d && (
            <>
              {d.status === 'OVERDUE' && (
                <Alert type="error" showIcon message={`Đã quá hạn đóng (${formatDate(d.dueDate)}). Vui lòng thanh toán sớm.`} />
              )}
              {!d.isPayer && due && (
                <Alert type="info" showIcon message="Người nộp phí của căn hộ sẽ thanh toán thông báo này." />
              )}
              {canPay && !wide && <PayosButton invoiceIds={[d._id]} amount={outstanding} block />}

              <SurfaceCard className="p-4 md:p-5">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                  <span className="text-r-muted text-[13px]">{d.code}</span>
                  <StatusBadge tone={INVOICE_TONE[d.status]}>{INVOICE_STATUS[d.status]?.label}</StatusBadge>
                </div>
                <Row label="Ngày phát hành" value={formatDate(d.issuedAt)} muted />
                <Row label="Hạn đóng" value={formatDate(d.dueDate)} muted />
                <Row label="Người nộp phí" value={d.payerId?.fullName ?? '—'} muted />
              </SurfaceCard>

              <SurfaceCard className="p-4 md:p-5">
                <h2 className="text-base font-semibold mb-2">Chi tiết các khoản</h2>
                {d.items.map((it, i) => (
                  <div key={i} className="flex justify-between gap-4 py-2 border-b border-r-border last:border-0">
                    <span className="min-w-0">
                      <span className="block">{it.description}</span>
                      <span className="block text-[12px] text-r-muted">
                        {FEE_CATEGORIES[it.feeCategory]?.label}
                        {it.quantity !== 1 && ` · ${it.quantity} × ${formatMoney(it.unitPrice)}`}
                      </span>
                    </span>
                    <span className="shrink-0">{formatMoney(it.amount)}</span>
                  </div>
                ))}
                <div className="mt-2 pt-2 border-t border-r-border">
                  <Row label="Tổng tiền kỳ này" value={formatMoney(d.totalAmount)} strong />
                  {d.prepaidApplied > 0 && <Row label="Đã trừ Số dư trả trước" value={`− ${formatMoney(d.prepaidApplied)}`} muted />}
                  <Row label="Đã thanh toán" value={formatMoney(d.paidAmount)} muted />
                  <Row label="Còn phải trả" value={formatMoney(outstanding)} strong danger={outstanding > 0} />
                  {d.previousDebt > 0 && (
                    <Row label="Nợ các kỳ trước (chưa gồm trong số trên)" value={formatMoney(d.previousDebt)} muted danger />
                  )}
                </div>
              </SurfaceCard>

              {canPay && d.payInfo && (
                <SurfaceCard className="p-4 md:p-5">
                  <h2 className="text-base font-semibold mb-1">Hoặc chuyển khoản</h2>
                  {d.payInfo.configured ? (
                    <>
                      <Row label="Ngân hàng" value={d.payInfo.bankName} muted />
                      <Row label="Số tài khoản" value={<Typography.Text copyable>{d.payInfo.accountNo}</Typography.Text>} muted />
                      <Row label="Chủ tài khoản" value={d.payInfo.accountName} muted />
                    </>
                  ) : (
                    <p className="text-r-muted text-[13px] my-1">Liên hệ Ban quản lý để biết tài khoản nhận tiền.</p>
                  )}
                  <Row
                    label="Nội dung chuyển khoản"
                    value={
                      <Typography.Text strong copyable>
                        {d.payInfo.content}
                      </Typography.Text>
                    }
                  />
                  <p className="text-r-muted text-[12px] mt-1 mb-0">
                    Ghi đúng nội dung để Kế toán gạch nợ nhanh. Chuyển khoản tay được ghi nhận sau khi Kế toán đối chiếu sao kê.
                  </p>
                </SurfaceCard>
              )}

              {d.payments?.length > 0 && (
                <SurfaceCard className="p-4 md:p-5">
                  <h2 className="text-base font-semibold mb-2">Lịch sử thanh toán</h2>
                  {d.payments.map((p) => (
                    <Row
                      key={p._id}
                      label={`${formatDateTime(p.paidAt)} · ${PAYMENT_METHODS[p.method]?.label ?? p.method}${p.receiptNo ? ` · ${p.receiptNo}` : ''}`}
                      value={
                        d.isPayer ? (
                          <Link to={`/r/payments/${p._id}/receipt`} viewTransition>
                            {formatMoney(p.allocatedAmount)} · Biên lai
                          </Link>
                        ) : (
                          formatMoney(p.allocatedAmount)
                        )
                      }
                    />
                  ))}
                </SurfaceCard>
              )}
            </>
          )
        )}
      </div>
      {canPay && wide && (
        <aside className="w-[320px] shrink-0 sticky top-24">
          <PayosQrPanel invoiceIds={[d._id]} amount={outstanding} />
        </aside>
      )}
    </div>
  );
}

import { useNavigate, useParams } from 'react-router';
import { Alert, Button, Card, Flex, Skeleton, Typography } from 'antd';
import { ArrowLeftOutlined, PrinterOutlined, SyncOutlined } from '@ant-design/icons';
import { paymentApi } from '../../api/moduleB.api';
import EnumTag from '../../components/EnumTag';
import PageHeader from '../../components/PageHeader';
import { useAction, useApi } from '../../hooks/useApi';
import { PAYMENT_STATUS, reconcileHint } from './paymentShared';
import { DownloadPdfButton } from '../invoices/invoiceComponents';
import ReceiptView from './ReceiptView';

/** Biên lai cho quản trị (/app/payments/:id/receipt) và cư dân (/r/payments/:id/receipt) — `area` quyết định đường quay lại */
export function ReceiptPageFor({ area }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, reload } = useApi(() => paymentApi.receipt(id), [id]);
  const back = area === 'app' ? '/app/payments' : '/r/invoices';
  const done = data?.status === 'SUCCESS';
  // Kế toán: giao dịch payOS còn chờ → hỏi thẳng payOS (server gạch nợ nếu đã trả, chuyển Thất bại nếu hết hạn / bị hủy)
  const [recheck, rechecking] = useAction(() => paymentApi.payosStatus(data.orderCode), {
    success: false,
    onDone: () => reload(),
  });

  return (
    <Flex vertical gap={16} className="max-w-4xl">
      <PageHeader
        className="mb-0 print:hidden"
        title={!data || done ? 'Biên lai' : 'Chi tiết giao dịch'}
        breadcrumb={
          area === 'app'
            ? [
                { label: 'Trang chủ', path: '/app/home' },
                { label: 'Giao dịch thu', path: '/app/payments' },
                { label: !data || done ? 'Biên lai' : 'Chi tiết giao dịch' },
              ]
            : undefined
        }
        extra={
          <>
            {data?.status === 'SUCCESS' && <DownloadPdfButton label="Tải biên lai PDF" download={() => paymentApi.downloadReceipt(id)} />}
            <Button icon={<PrinterOutlined />} onClick={() => window.print()} disabled={!data}>
              In
            </Button>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(back, { viewTransition: true })}>
              Quay lại
            </Button>
          </>
        }
      />
      {data && area === 'app' && (data.needsReconcile || !done) && (
        <Alert
          className="print:hidden"
          type={data.status === 'FAILED' ? 'error' : 'warning'}
          showIcon
          message={
            <>
              <EnumTag map={PAYMENT_STATUS} value={data.status} />
              {data.needsReconcile && <Typography.Text type="warning">Cần đối soát</Typography.Text>}
            </>
          }
          description={reconcileHint(data)}
          action={
            data.method === 'PAYOS' &&
            data.orderCode &&
            data.status === 'PENDING' && (
              <Button size="small" icon={<SyncOutlined />} loading={rechecking} onClick={() => recheck().catch(() => {})}>
                Kiểm tra lại với payOS
              </Button>
            )
          }
        />
      )}
      <Card>{loading && !data ? <Skeleton active /> : data && <ReceiptView receipt={data} />}</Card>
    </Flex>
  );
}

export default function AdminReceiptPage() {
  return <ReceiptPageFor area="app" />;
}

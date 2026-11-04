import { useNavigate, useParams } from 'react-router';
import { Button, Card, Flex, Skeleton } from 'antd';
import { ArrowLeftOutlined, PrinterOutlined } from '@ant-design/icons';
import { paymentApi } from '../../api/moduleB.api';
import PageHeader from '../../components/PageHeader';
import { useApi } from '../../hooks/useApi';
import ReceiptView from './ReceiptView';

/** Biên lai cho quản trị (/app/payments/:id/receipt) và cư dân (/r/payments/:id/receipt) — `area` quyết định đường quay lại */
export function ReceiptPageFor({ area }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading } = useApi(() => paymentApi.receipt(id), [id]);
  const back = area === 'app' ? '/app/payments' : '/r/invoices';

  return (
    <Flex vertical gap={16} className="max-w-4xl">
      <PageHeader
        className="mb-0 print:hidden"
        title="Biên lai"
        breadcrumb={
          area === 'app'
            ? [
                { label: 'Trang chủ', path: '/app/home' },
                { label: 'Giao dịch thu', path: '/app/payments' },
                { label: 'Biên lai' },
              ]
            : undefined
        }
        extra={
          <>
            <Button icon={<PrinterOutlined />} onClick={() => window.print()} disabled={!data}>
              In / lưu PDF
            </Button>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(back, { viewTransition: true })}>
              Quay lại
            </Button>
          </>
        }
      />
      <Card>{loading && !data ? <Skeleton active /> : data && <ReceiptView receipt={data} />}</Card>
    </Flex>
  );
}

export default function AdminReceiptPage() {
  return <ReceiptPageFor area="app" />;
}

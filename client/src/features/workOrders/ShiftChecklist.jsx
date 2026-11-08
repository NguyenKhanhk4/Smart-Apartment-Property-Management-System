import { useState } from 'react';
import { Alert, App, Button, Card, Empty, Flex, List, Tag, Typography } from 'antd';
import { QrcodeOutlined, ReloadOutlined } from '@ant-design/icons';
import { workOrderApi } from '../../api/equipment.api';
import EnumTag from '../../components/EnumTag';
import QrScanModal from '../../components/QrScanModal';
import { WORK_ORDER_STATUS } from '../../constants/enums';
import { useApi } from '../../hooks/useApi';
import { formatDate } from '../../utils/format';
import AssetCode from '../assets/AssetCode';
import InspectionModal from './InspectionModal';

// UC08 bước 1–4 (KTV): checklist ca → bấm "Quét QR" → quét mã dán trên thiết bị → đúng thiết bị thì mở checklist
export default function ShiftChecklist() {
  const { message } = App.useApp();
  const shift = useApi(() => workOrderApi.shiftChecklist(), []);
  const [scanning, setScanning] = useState(null); // phiếu đang quét QR
  const [inspecting, setInspecting] = useState(null); // phiếu đã quét đúng, đang nhập checklist
  const data = shift.data;

  // Lỗi (sai thiết bị MSG-E03, người khác đã nhận...) báo rồi cho quét tiếp; không ném ra ngoài
  const onScan = async (qrCode) => {
    try {
      const res = await workOrderApi.scan(scanning._id, qrCode);
      setScanning(null);
      setInspecting(res.data);
      shift.reload();
    } catch (err) {
      message.error(err.message);
      if (err.errorCode === 'WORKORDER_TAKEN') {
        setScanning(null);
        shift.reload();
      }
    }
  };

  const action = (wo) => {
    if (wo.result === 'FAULTY') return <Tag color="error">Có sự cố – chờ báo cáo hư hỏng</Tag>;
    const blocked = !wo.mine && !data?.canClaim;
    return (
      <Button type="primary" icon={<QrcodeOutlined />} disabled={blocked} onClick={() => setScanning(wo)}>
        {wo.mine && wo.status === 'IN_PROGRESS' ? 'Quét QR để làm tiếp' : 'Quét QR'}
      </Button>
    );
  };

  return (
    <Flex vertical gap={12}>
      {data && !data.canClaim && (
        <Alert
          type="warning"
          showIcon
          title="Bạn không trong ca trực kỹ thuật lúc này"
          description="Chỉ làm được phiếu Trưởng BQL giao cho bạn. Phiếu chưa ai nhận dành cho kỹ thuật viên đang trực."
        />
      )}
      {data && !data.hasSchedule && (
        <Alert type="info" showIcon title="Lúc này không có lịch trực kỹ thuật, kỹ thuật viên nào cũng nhận được phiếu." />
      )}
      <Card
        size="small"
        title={`Checklist ca${data ? ` (${data.items.length} phiếu)` : ''}`}
        extra={<Button size="small" icon={<ReloadOutlined />} onClick={shift.reload} loading={shift.loading}>Làm mới</Button>}
      >
        <List
          loading={shift.loading && !data}
          dataSource={data?.items ?? []}
          locale={{ emptyText: <Empty description="Không có phiếu bảo trì nào cần làm" /> }}
          renderItem={(wo) => (
            <List.Item actions={[action(wo)]}>
              <List.Item.Meta
                title={
                  <Flex gap={8} wrap align="center">
                    <AssetCode code={wo.assetId?.code} />
                    <Typography.Text strong>{wo.assetId?.name}</Typography.Text>
                    <EnumTag map={WORK_ORDER_STATUS} value={wo.status} />
                    {wo.mine && <Tag color="cyan">Của bạn</Tag>}
                  </Flex>
                }
                description={
                  <Flex gap={12} wrap>
                    <span>{wo.assetId?.buildingId?.name}{wo.assetId?.location ? ` · ${wo.assetId.location}` : ''}</span>
                    <Typography.Text type={wo.isOverdue ? 'danger' : 'secondary'}>
                      Hạn: {formatDate(wo.scheduledDate)}{wo.isOverdue ? ' (quá hạn)' : ''}
                    </Typography.Text>
                    <span>{wo.checklistCount ? `${wo.checklistCount} mục kiểm tra` : 'Chưa có checklist'}</span>
                  </Flex>
                }
              />
            </List.Item>
          )}
        />
      </Card>
      <QrScanModal
        open={Boolean(scanning)}
        title={scanning ? `Quét QR: ${scanning.assetId?.code ?? ''} ${scanning.assetId?.name ?? ''}` : 'Quét QR'}
        instruction="Đưa mã QR dán trên thiết bị vào khung. Không quét được thì nhập mã in dưới QR:"
        placeholder="EQ-…"
        onClose={() => setScanning(null)}
        onResult={onScan}
      />
      {inspecting && (
        <InspectionModal workOrder={inspecting} open onClose={() => setInspecting(null)} onDone={shift.reload} />
      )}
    </Flex>
  );
}

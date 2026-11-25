import { useState } from 'react';
import { Alert, App, Button, Card, DatePicker, Empty, Flex, Input, List, Select, Tag, Typography } from 'antd';
import { FileProtectOutlined, QrcodeOutlined, ReloadOutlined, WarningOutlined } from '@ant-design/icons';
import { workOrderApi } from '../../api/equipment.api';
import EnumTag from '../../components/EnumTag';
import QrScanModal from '../../components/QrScanModal';
import { WORK_ORDER_STATUS, enumOptions } from '../../constants/enums';
import { useApi } from '../../hooks/useApi';
import { formatDate } from '../../utils/format';
import AssetCode from '../assets/AssetCode';
import InspectionModal from './InspectionModal';
import { AcceptanceUploadModal, FaultReportModal, RepairRequestModal } from './RepairModals';
import { filterShiftItems, sortTodayFirst } from './shiftSearch';

// Checklist ca chỉ có phiếu chưa xong
const STATUS_OPTIONS = enumOptions(WORK_ORDER_STATUS).filter((o) => !['DONE', 'CLOSED'].includes(o.value));

// UC08 (KTV): checklist ca → "Quét QR" → đúng thiết bị thì mở checklist. UC09: Có sự cố → báo hư hỏng; Đang sửa → tải biên bản
export default function ShiftChecklist() {
  const { message } = App.useApp();
  const shift = useApi(() => workOrderApi.shiftChecklist(), []);
  const [scanning, setScanning] = useState(null); // phiếu đang quét QR
  const [inspecting, setInspecting] = useState(null); // phiếu đã quét đúng, đang nhập checklist
  const [reporting, setReporting] = useState(null); // UC09: báo hư hỏng
  const [uploading, setUploading] = useState(null); // UC09: tải biên bản nghiệm thu
  const [requesting, setRequesting] = useState(null); // UC10: gửi yêu cầu sửa lại phiếu đang hoãn
  const [keyword, setKeyword] = useState('');
  const [statuses, setStatuses] = useState([]);
  const [range, setRange] = useState(null); // [từ, đến] theo ngày lên lịch
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const data = shift.data;
  const filtering = Boolean(keyword.trim() || statuses.length || range);
  const items = sortTodayFirst(filterShiftItems(data?.items ?? [], {
    keyword, statuses, from: range?.[0]?.format('YYYY-MM-DD'), to: range?.[1]?.format('YYYY-MM-DD'),
  }));
  // Làm xong phiếu thì danh sách ngắn lại: không để đứng ở trang không còn phiếu
  const current = Math.min(page, Math.max(1, Math.ceil(items.length / pageSize)));

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
    if (wo.status === 'IN_PROGRESS' && wo.result === 'FAULTY') {
      return <Button danger icon={<WarningOutlined />} onClick={() => setReporting(wo)}>Báo cáo hư hỏng</Button>;
    }
    if (wo.status === 'AWAITING_REPAIR_APPROVAL') return <Tag color="orange">Chờ Trưởng BQL duyệt sửa</Tag>;
    if (wo.status === 'UNDER_REPAIR') {
      return <Button type="primary" icon={<FileProtectOutlined />} onClick={() => setUploading(wo)}>Tải biên bản nghiệm thu</Button>;
    }
    if (wo.status === 'AWAITING_ACCEPTANCE') return <Tag color="gold">Chờ Trưởng BQL nghiệm thu</Tag>;
    if (wo.status === 'AWAITING_BOARD_ACCEPTANCE') return <Tag color="purple">Chờ Ban quản trị xác nhận</Tag>;
    if (wo.status === 'REPAIR_POSTPONED') return <Button onClick={() => setRequesting(wo)}>Gửi yêu cầu sửa lại</Button>;
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
        title={`Checklist ca${data ? ` (${filtering ? `${items.length}/` : ''}${data.items.length} phiếu)` : ''}`}
        extra={<Button size="small" icon={<ReloadOutlined />} onClick={shift.reload} loading={shift.loading}>Làm mới</Button>}
      >
        <Flex gap={8} wrap style={{ marginBottom: 8 }}>
          <Input.Search
            allowClear
            placeholder="Tìm mã, tên, vị trí thiết bị, tòa"
            style={{ width: 300, maxWidth: '100%' }}
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
          />
          <DatePicker.RangePicker
            allowEmpty={[true, true]}
            format="DD/MM/YYYY"
            placeholder={['Ngày lên lịch từ', 'đến']}
            value={range}
            onChange={(v) => {
              setRange(v?.[0] || v?.[1] ? v : null);
              setPage(1);
            }}
          />
          <Select
            allowClear
            mode="multiple"
            maxTagCount="responsive"
            placeholder="Trạng thái"
            style={{ width: 220 }}
            options={STATUS_OPTIONS}
            value={statuses}
            onChange={(v) => {
              setStatuses(v);
              setPage(1);
            }}
          />
        </Flex>
        <List
          loading={shift.loading && !data}
          dataSource={items}
          locale={{ emptyText: <Empty description={filtering ? 'Không tìm thấy phiếu phù hợp' : 'Không có phiếu bảo trì nào cần làm'} /> }}
          pagination={items.length > 10 && {
            current,
            pageSize,
            total: items.length,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50],
            showTotal: (total, [from, to]) => `${from}–${to} / ${total} phiếu`,
            onChange: (p, size) => {
              setPage(size === pageSize ? p : 1);
              setPageSize(size);
            },
          }}
          rowKey="_id"
          renderItem={(wo) => (
            <List.Item actions={[action(wo)]}>
              <List.Item.Meta
                title={
                  <Flex gap={8} wrap align="center">
                    <AssetCode code={wo.assetId?.code} />
                    <Typography.Text strong>{wo.assetId?.name}</Typography.Text>
                    <EnumTag map={WORK_ORDER_STATUS} value={wo.status} />
                    {wo.mine && <Tag color="cyan">Của bạn</Tag>}
                    {wo.repair?.isEmergency && <Tag color="red">Khẩn cấp</Tag>}
                  </Flex>
                }
                description={
                  <Flex gap={12} wrap>
                    <span>{wo.assetId?.buildingId?.name}{wo.assetId?.location ? ` · ${wo.assetId.location}` : ''}</span>
                    {wo.status === 'REPAIR_POSTPONED' ? (
                      <Typography.Text type="secondary">Hoãn sửa đến {formatDate(wo.repair?.reviewDate)}</Typography.Text>
                    ) : (
                      <Typography.Text type={wo.isOverdue ? 'danger' : 'secondary'}>
                        Hạn: {formatDate(wo.scheduledDate)}{wo.isOverdue ? ' (quá hạn)' : ''}
                      </Typography.Text>
                    )}
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
        <InspectionModal
          workOrder={inspecting}
          open
          onClose={() => setInspecting(null)}
          onDone={(wo) => {
            shift.reload();
            if (wo?.result !== 'FAULTY') return;
            if (wo.status === 'IN_PROGRESS') setReporting(wo); // UC09 bước 1: mở ngay form báo hư hỏng
            else if (wo.knownFault?.status === 'REPAIR_POSTPONED') {
              // UC10: lỗi đã có phiếu hoãn → đề nghị gửi yêu cầu sửa lại phiếu đó (không bắt buộc)
              const { _id, status, ...repair } = wo.knownFault;
              setRequesting({ _id, status, assetId: wo.assetId, title: wo.title, repair });
            }
          }}
        />
      )}
      {reporting && <FaultReportModal workOrder={reporting} open onClose={() => setReporting(null)} onDone={shift.reload} />}
      {requesting && <RepairRequestModal workOrder={requesting} open onClose={() => setRequesting(null)} onDone={shift.reload} />}
      {uploading && (
        <AcceptanceUploadModal workOrder={uploading} open onClose={() => setUploading(null)} onDone={shift.reload} />
      )}
    </Flex>
  );
}

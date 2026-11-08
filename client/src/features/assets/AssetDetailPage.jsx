import { useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { App, Button, Card, Descriptions, Flex, Skeleton, Table, Tag, Typography } from 'antd';
import { ArrowLeftOutlined, EditOutlined, PrinterOutlined } from '@ant-design/icons';
import { QRCodeSVG } from 'qrcode.react';
import { assetApi } from '../../api/equipment.api';
import { lookupApi } from '../../api/moduleE.api';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import EnumTag from '../../components/EnumTag';
import { ASSET_CATEGORIES, WORK_ORDER_STATUS } from '../../constants/enums';
import { formatDate, formatDateTime } from '../../utils/format';
import PageHeader from '../../components/PageHeader';
import AssignWorkOrderModal from '../workOrders/AssignWorkOrderModal';
import WorkOrderReportModal from '../workOrders/WorkOrderReportModal';
import AssetCode from './AssetCode';
import AssetFormModal from './AssetFormModal';
import { checklistRule, cycleText, dueText, warrantyState } from './assetFormat';

const WARRANTY_TAG = {
  EXPIRED: { color: 'default', label: 'Hết bảo hành' },
  EXPIRING: { color: 'orange', label: 'Sắp hết bảo hành' },
};

/**
 * UC07 bước 5: in nhãn QR dán lên thiết bị. Lấy đúng SVG đang hiện trên trang; chữ đặt bằng textContent
 * nên tên thiết bị không bị hiểu là HTML.
 */
function printLabel(asset, svgElement) {
  if (!svgElement) return false;
  const win = window.open('', '_blank', 'width=420,height=560');
  if (!win) return false; // trình duyệt chặn cửa sổ bật lên
  const doc = win.document;
  doc.title = `Nhãn QR ${asset.code}`;
  doc.body.style.cssText = 'font-family: sans-serif; margin: 0; display: flex; justify-content: center; padding: 24px;';
  const box = doc.createElement('div');
  box.style.cssText = 'border: 2px solid #000; border-radius: 8px; padding: 16px; text-align: center; width: 280px;';
  const line = (text, style) => {
    const p = doc.createElement('div');
    p.textContent = text;
    p.style.cssText = style;
    box.appendChild(p);
  };
  line('SAPMS – Thiết bị', 'font-size: 12px; color: #555;');
  line(asset.code, 'font-size: 22px; font-weight: 700; letter-spacing: 1px; margin: 4px 0 8px;');
  const svg = svgElement.cloneNode(true);
  svg.setAttribute('width', '220');
  svg.setAttribute('height', '220');
  box.appendChild(doc.importNode(svg, true));
  // Camera không quét được thì KTV gõ chuỗi này vào ô nhập mã (UC08)
  line(asset.qrCode, 'font-family: monospace; font-size: 11px; color: #333; margin-top: 2px;');
  line(asset.name, 'font-size: 14px; font-weight: 600; margin-top: 8px;');
  if (asset.location) line(asset.location, 'font-size: 12px; color: #555;');
  line('Kỹ thuật viên quét mã này khi kiểm tra định kỳ', 'font-size: 10px; color: #777; margin-top: 8px;');
  doc.body.appendChild(box);
  win.focus();
  win.print();
  return true;
}

// UC07 — Chi tiết thiết bị: thông tin, mẫu checklist, mã QR, phiếu đang mở, lịch sử bảo trì
export default function AssetDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  // Tên truyền từ danh sách → hiện ngay để tiêu đề morph từ dòng trong bảng (không chờ API)
  const passedName = useLocation().state?.name;
  const { hasRole } = useAuth();
  const isManager = hasRole('MANAGER');
  const { message } = App.useApp();
  const [page, setPage] = useState(1);
  const [assigning, setAssigning] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(false);
  const qrRef = useRef(null);
  const asset = useApi(() => assetApi.get(id), [id]);
  const history = useApi(() => assetApi.history(id, { page, limit: 10 }), [id, page]);
  const buildings = useApi(() => lookupApi.buildings(), [], { enabled: isManager });
  const a = asset.data;
  const wo = a?.openWorkOrder;
  const warranty = warrantyState(a?.warrantyEnd);

  return (
    <Flex vertical gap={16}>
      <PageHeader
        className="mb-0"
        title={a?.name ?? passedName ?? <Skeleton.Input active size="small" />}
        titleTransitionName={`asset-${id}`}
        breadcrumb={[
          { label: 'Trang chủ', path: '/app/home' },
          { label: 'Thiết bị', path: '/app/assets' },
          { label: 'Chi tiết' },
        ]}
        extra={
          <>
            {a && (a.isActive ? <Tag color="green">Đang theo dõi</Tag> : <Tag>Đã ngừng</Tag>)}
            {a && isManager && (
              <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
                Sửa
              </Button>
            )}
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/app/assets', { viewTransition: true })}>
              Danh sách
            </Button>
          </>
        }
      />
      <Flex gap={16} wrap align="stretch">
        <Card title="Thông tin thiết bị" loading={asset.loading} style={{ flex: '3 1 480px', minWidth: 0 }}>
          {a && (
            <Descriptions column={{ xs: 1, md: 2 }} size="small">
              <Descriptions.Item label="Mã"><AssetCode code={a.code} size={15} /></Descriptions.Item>
              <Descriptions.Item label="Loại"><EnumTag map={ASSET_CATEGORIES} value={a.category} /></Descriptions.Item>
              <Descriptions.Item label="Tòa">{a.buildingId?.name}</Descriptions.Item>
              <Descriptions.Item label="Vị trí">{a.location || '—'}</Descriptions.Item>
              <Descriptions.Item label="Hãng sản xuất">{a.manufacturer || '—'}</Descriptions.Item>
              <Descriptions.Item label="Ngày lắp đặt">{formatDate(a.installDate)}</Descriptions.Item>
              <Descriptions.Item label="Hết bảo hành">
                {formatDate(a.warrantyEnd)}
                {WARRANTY_TAG[warranty] && <Tag color={WARRANTY_TAG[warranty].color} style={{ marginLeft: 8 }}>{WARRANTY_TAG[warranty].label}</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label="Nhà cung cấp">
                {a.vendorName || '—'}{a.vendorPhone ? ` · ${a.vendorPhone}` : ''}
              </Descriptions.Item>
              <Descriptions.Item label="Chu kỳ bảo trì">{cycleText(a)}</Descriptions.Item>
              <Descriptions.Item label="Số lần đã bảo trì">{a.doneCount}</Descriptions.Item>
              <Descriptions.Item label="Bảo trì gần nhất">{formatDate(a.lastMaintenanceDate)}</Descriptions.Item>
              <Descriptions.Item label="Bảo trì tiếp theo">
                <Typography.Text type={a.isActive && dueText(a.nextMaintenanceDate) ? 'danger' : undefined}>
                  {formatDate(a.nextMaintenanceDate)}
                  {a.isActive && dueText(a.nextMaintenanceDate) && ` (${dueText(a.nextMaintenanceDate)})`}
                </Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="Ghi chú" span={2}>{a.note || '—'}</Descriptions.Item>
            </Descriptions>
          )}
        </Card>
        <Card
          title="Mã QR"
          loading={asset.loading}
          style={{ flex: '1 1 220px', minWidth: 0 }}
          extra={a?.qrCode && (
            <Button size="small" icon={<PrinterOutlined />} onClick={() => printLabel(a, qrRef.current?.querySelector('svg')) || message.warning('Trình duyệt đang chặn cửa sổ in. Hãy cho phép cửa sổ bật lên (pop-up) với trang này rồi bấm lại.')}>
              In nhãn
            </Button>
          )}
        >
          {a?.qrCode ? (
            <Flex vertical align="center" gap={8}>
              <div ref={qrRef}>
                <QRCodeSVG value={a.qrCode} size={160} level="M" marginSize={2} title={`Mã QR thiết bị ${a.code}`} />
              </div>
              <Typography.Text strong>{a.code}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12, textAlign: 'center' }}>
                <Typography.Text copyable style={{ fontFamily: 'monospace', fontSize: 12 }}>{a.qrCode}</Typography.Text>
                <br />
                In và dán lên thiết bị. Kỹ thuật viên quét mã này khi kiểm tra định kỳ; không quét được thì nhập chuỗi trên. Mã không đổi khi sửa thiết bị.
              </Typography.Text>
            </Flex>
          ) : (
            <Typography.Text type="secondary">Thiết bị chưa có mã QR.</Typography.Text>
          )}
        </Card>
      </Flex>
      <Card title="Mẫu checklist kiểm tra" size="small" loading={asset.loading}>
        {a?.checklist?.length ? (
          <Table
            rowKey="label"
            size="small"
            pagination={false}
            dataSource={a.checklist}
            scroll={{ x: 520 }}
            columns={[
              { title: 'Mục', dataIndex: 'label' },
              { title: 'Cách kiểm tra', width: 220, render: (_, item) => checklistRule(item) },
              { title: 'Bắt buộc', dataIndex: 'required', width: 100, render: (v) => (v ? <Tag color="blue">Bắt buộc</Tag> : <Tag>Không</Tag>) },
            ]}
          />
        ) : (
          <Typography.Text type="warning">
            Chưa có mẫu checklist. {isManager ? 'Bấm Sửa để thêm các mục kiểm tra.' : 'Liên hệ Trưởng BQL để bổ sung.'}
          </Typography.Text>
        )}
      </Card>
      <Card
        title="Phiếu bảo trì đang mở"
        size="small"
        loading={asset.loading}
        extra={
          wo && isManager && (
            <Button size="small" type={wo.assignedTo ? 'default' : 'primary'} onClick={() => setAssigning(true)}>
              {wo.assignedTo ? 'Giao lại' : 'Phân công'}
            </Button>
          )
        }
      >
        {wo ? (
          <Descriptions column={{ xs: 1, md: 3 }} size="small">
            <Descriptions.Item label="Trạng thái"><EnumTag map={WORK_ORDER_STATUS} value={wo.status} /></Descriptions.Item>
            <Descriptions.Item label="Ngày lên lịch">{formatDate(wo.scheduledDate)}</Descriptions.Item>
            <Descriptions.Item label="Kỹ thuật viên">{wo.assignedTo?.fullName ?? <Typography.Text type="warning">Chưa phân công</Typography.Text>}</Descriptions.Item>
          </Descriptions>
        ) : (
          <Typography.Text type="secondary">Không có phiếu bảo trì đang mở.</Typography.Text>
        )}
      </Card>
      <Card title="Lịch sử bảo trì" size="small">
        <Table
          rowKey="_id"
          size="small"
          loading={history.loading}
          dataSource={history.data ?? []}
          scroll={{ x: 700 }}
          pagination={{ current: page, pageSize: 10, total: history.pagination?.total, onChange: setPage, hideOnSinglePage: true }}
          columns={[
            { title: 'Ngày dự kiến', dataIndex: 'scheduledDate', width: 120, render: formatDate },
            { title: 'Hoàn thành', dataIndex: 'completedAt', width: 160, render: formatDateTime },
            { title: 'Kỹ thuật viên', dataIndex: ['assignedTo', 'fullName'], width: 150, render: (v) => v ?? '—' },
            { title: 'Đúng hạn', dataIndex: 'onTime', width: 100, render: (v) => (v ? <Tag color="green">Đúng hạn</Tag> : <Tag color="red">Trễ hạn</Tag>) },
            { title: 'Kết quả', dataIndex: 'note' },
            {
              title: '',
              width: 120,
              render: (_, r) => (
                <Button size="small" onClick={() => setViewing(r)}>
                  {r.completionImages?.length ? `Xem ${r.completionImages.length} ảnh` : 'Xem báo cáo'}
                </Button>
              ),
            },
          ]}
        />
      </Card>
      {viewing && <WorkOrderReportModal workOrder={viewing} open onClose={() => setViewing(null)} />}
      {assigning && wo && (
        <AssignWorkOrderModal workOrder={wo} open onClose={() => setAssigning(false)} onDone={asset.reload} />
      )}
      {editing && a && (
        <AssetFormModal asset={a} buildings={buildings.data ?? []} open onClose={() => setEditing(false)} onDone={asset.reload} />
      )}
    </Flex>
  );
}

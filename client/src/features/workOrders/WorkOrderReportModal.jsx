import { Descriptions, Modal, Table, Tag, Typography } from 'antd';
import EnumTag from '../../components/EnumTag';
import EvidencePhotos from '../../components/EvidencePhotos';
import { WORK_ORDER_RESULTS } from '../../constants/enums';
import { formatDate, formatDateTime } from '../../utils/format';
import { isMeasured, rangeText } from './inspectionForm';
import { RepairInfo } from './RepairModals';

const resultCell = (r, item) => {
  if (item && isMeasured(item)) return r.value == null ? '—' : `${r.value}${item.unit ? ` ${item.unit}` : ''}`;
  if (r.ok == null) return '—';
  return r.ok ? 'Đạt' : 'Không đạt';
};

// Kết quả kiểm tra (UC08): KTV, thời gian, kết quả Đạt / Có sự cố, từng mục checklist, ghi chú, ảnh.
// Trưởng BQL xem ở trang Phiếu bảo trì và lịch sử thiết bị; KTV xem lại việc của mình.
export default function WorkOrderReportModal({ workOrder, open, onClose }) {
  const checklist = workOrder.checklist ?? [];
  const results = workOrder.results ?? [];
  return (
    <Modal title="Kết quả kiểm tra" open={open} onCancel={onClose} footer={null} width="min(720px, 94vw)" destroyOnHidden>
      <Typography.Paragraph type="secondary">{workOrder.title}</Typography.Paragraph>
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="Kỹ thuật viên">{workOrder.assignedTo?.fullName ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="Ngày lên lịch">{formatDate(workOrder.scheduledDate)}</Descriptions.Item>
        <Descriptions.Item label="Quét QR lúc">{formatDateTime(workOrder.scannedAt ?? workOrder.startedAt)}</Descriptions.Item>
        <Descriptions.Item label="Kiểm tra lúc">{formatDateTime(workOrder.inspectedAt ?? workOrder.completedAt)}</Descriptions.Item>
        <Descriptions.Item label="Kết quả">
          {workOrder.result ? <EnumTag map={WORK_ORDER_RESULTS} value={workOrder.result} /> : '—'}
          {workOrder.status === 'CLOSED' && <Typography.Text type="secondary"> Không sửa, thiết bị ngừng sử dụng</Typography.Text>}
          {workOrder.result === 'FAULTY' && workOrder.status === 'DONE' && workOrder.repair && (
            <Typography.Text type="secondary"> Đã sửa và nghiệm thu{workOrder.repair.acceptedAt ? ` lúc ${formatDateTime(workOrder.repair.acceptedAt)}` : ''}</Typography.Text>
          )}
          {workOrder.result === 'FAULTY' && workOrder.status === 'IN_PROGRESS' && (
            <Typography.Text type="secondary"> Chờ báo cáo hư hỏng</Typography.Text>
          )}
        </Descriptions.Item>
        <Descriptions.Item label={workOrder.result === 'FAULTY' ? 'Mô tả sự cố' : 'Ghi chú'}>
          <Typography.Text style={{ whiteSpace: 'pre-wrap' }}>{workOrder.note || '—'}</Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label="Ảnh kiểm tra">
          {workOrder.completionImages?.length ? (
            <EvidencePhotos urls={workOrder.completionImages} />
          ) : (
            <Typography.Text type="secondary">Không có ảnh (dữ liệu trước khi bắt buộc chụp ảnh)</Typography.Text>
          )}
        </Descriptions.Item>
      </Descriptions>
      {results.length > 0 && (
        <Table
          style={{ marginTop: 16 }}
          rowKey="index"
          size="small"
          pagination={false}
          dataSource={results}
          scroll={{ x: 520 }}
          columns={[
            { title: 'Mục', dataIndex: 'label' },
            { title: 'Cho phép', width: 140, render: (_, r) => (isMeasured(checklist[r.index]) ? rangeText(checklist[r.index]) : '—') },
            { title: 'Kết quả', width: 120, render: (_, r) => resultCell(r, checklist[r.index]) },
            {
              title: '',
              dataIndex: 'isOk',
              width: 100,
              render: (v) => (v == null ? <Tag>Bỏ trống</Tag> : v ? <Tag color="success">Đạt</Tag> : <Tag color="error">Không đạt</Tag>),
            },
          ]}
        />
      )}
      {workOrder.repair && (
        <>
          <Typography.Title level={5} style={{ marginTop: 20 }}>Sửa chữa (ảnh hư hỏng, biên bản nghiệm thu)</Typography.Title>
          <RepairInfo workOrder={workOrder} />
        </>
      )}
    </Modal>
  );
}

import { Descriptions, Modal, Typography } from 'antd';
import EvidencePhotos from '../../components/EvidencePhotos';
import { formatDate, formatDateTime } from '../../utils/format';

// Báo cáo hoàn thành work order: KTV, thời gian, ghi chú kết quả, ảnh bằng chứng.
// Manager (người giao việc) xem ở trang Work order và lịch sử bảo trì tài sản; KTV xem lại việc của mình.
export default function WorkOrderReportModal({ workOrder, open, onClose }) {
  return (
    <Modal title="Báo cáo hoàn thành" open={open} onCancel={onClose} footer={null} width={640} destroyOnHidden>
      <Typography.Paragraph type="secondary">{workOrder.title}</Typography.Paragraph>
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="Kỹ thuật viên">{workOrder.assignedTo?.fullName ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="Ngày lên lịch">{formatDate(workOrder.scheduledDate)}</Descriptions.Item>
        <Descriptions.Item label="Bắt đầu">{formatDateTime(workOrder.startedAt)}</Descriptions.Item>
        <Descriptions.Item label="Hoàn thành">{formatDateTime(workOrder.completedAt)}</Descriptions.Item>
        <Descriptions.Item label="Kết quả">
          <Typography.Text style={{ whiteSpace: 'pre-wrap' }}>{workOrder.note || '—'}</Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label="Ảnh bằng chứng">
          {workOrder.completionImages?.length ? (
            <EvidencePhotos urls={workOrder.completionImages} />
          ) : (
            <Typography.Text type="secondary">Không có ảnh (dữ liệu trước khi bắt buộc chụp ảnh)</Typography.Text>
          )}
        </Descriptions.Item>
      </Descriptions>
    </Modal>
  );
}

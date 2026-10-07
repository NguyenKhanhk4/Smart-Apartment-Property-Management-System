import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Flex,
  Image,
  Rate,
  Result,
  Spin,
  Timeline,
  Typography,
} from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { ticketApi } from '../../api/moduleE.api';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import EnumTag from '../../components/EnumTag';
import { PRIORITIES, TICKET_STATUS } from '../../constants/enums';
import { formatDateTime } from '../../utils/format';
import EvidencePhotos from '../../components/EvidencePhotos';
import { AssignModal, ConfirmModal, ProgressModal, RejectModal } from './TicketActionModals';

const HISTORY_LABEL = {
  CREATED: 'Cư dân tạo phản ánh',
  ASSIGNED: 'Phân công',
  REASSIGNED: 'Phân công lại',
  PROGRESS: 'Cập nhật tiến độ',
  RESOLVED: 'Đã xử lý xong',
  CONFIRMED: 'Cư dân xác nhận',
  REOPENED: 'Cư dân chưa đồng ý',
  ESCALATED: 'Hệ thống leo thang',
  AUTO_CLOSED: 'Hệ thống tự đóng',
  REJECTED: 'Từ chối',
};
const HISTORY_COLOR = { ESCALATED: 'red', REJECTED: 'gray', REOPENED: 'orange', CONFIRMED: 'green', AUTO_CLOSED: 'green' };

// Chi tiết phản ánh dùng chung cho cư dân (/r) và nội bộ (/app); nút thao tác hiện theo quyền
export default function TicketDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const [modal, setModal] = useState(null);
  const { data: t, loading, error, reload } = useApi(() => ticketApi.get(id), [id]);

  if (error && !t) {
    return <Result status="warning" title={error.message} extra={<Button onClick={() => navigate(-1)}>Quay lại</Button>} />;
  }
  if (!t) return <Spin style={{ display: 'block', margin: 48 }} />;

  const isFinal = ['CLOSED', 'REJECTED'].includes(t.status);
  const canDispatch = hasRole('MANAGER', 'STAFF:RECEPTIONIST') && !isFinal && t.status !== 'WAITING_CONFIRM';
  const isMyTask = hasRole('STAFF:TECHNICIAN') && t.assignedTo?._id === user.id;
  const canProgress = isMyTask && ['ASSIGNED', 'IN_PROGRESS'].includes(t.status);
  const canConfirm = hasRole('RESIDENT') && t.status === 'WAITING_CONFIRM';
  const modalProps = (key) => ({ ticket: t, open: modal === key, onClose: () => setModal(null), onDone: reload });

  return (
    <Spin spinning={loading}>
      <Flex vertical gap={12}>
        <Flex align="center" gap={8} wrap>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} />
          <Typography.Title level={4} style={{ margin: 0, flex: 1, minWidth: 200 }}>
            {t.title}
          </Typography.Title>
          {canDispatch && (
            <>
              <Button type="primary" onClick={() => setModal('assign')}>
                {t.assignedTo ? 'Phân công lại' : 'Phân công'}
              </Button>
              {['NEW', 'ASSIGNED'].includes(t.status) && (
                <Button danger onClick={() => setModal('reject')}>
                  Từ chối
                </Button>
              )}
            </>
          )}
          {canProgress && (
            <Button type="primary" onClick={() => setModal('progress')}>
              Cập nhật tiến độ
            </Button>
          )}
          {canConfirm && (
            <Button type="primary" onClick={() => setModal('confirm')}>
              Xác nhận & đánh giá
            </Button>
          )}
        </Flex>

        {t.isOverdue && (
          <Alert type="error" showIcon title={`Phản ánh đã quá hạn xử lý (hạn ${formatDateTime(t.dueDate)})`} />
        )}
        {canConfirm && (
          <Alert type="info" showIcon title="Kỹ thuật viên đã xử lý xong. Vui lòng xác nhận kết quả và đánh giá." />
        )}

        <Card size="small">
          <Descriptions column={{ xs: 1, md: 2 }} size="small">
            <Descriptions.Item label="Mã">{t.code}</Descriptions.Item>
            <Descriptions.Item label="Trạng thái">
              <EnumTag map={TICKET_STATUS} value={t.status} />
            </Descriptions.Item>
            <Descriptions.Item label="Loại">{t.category?.name}</Descriptions.Item>
            <Descriptions.Item label="Ưu tiên">
              <EnumTag map={PRIORITIES} value={t.priority} />
              {t.escalationCount > 0 && (
                <Typography.Text type="danger"> (leo thang {t.escalationCount} lần)</Typography.Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Căn hộ">
              {t.apartmentId?.code} {t.apartmentId?.buildingId?.name && `· ${t.apartmentId.buildingId.name}`}
            </Descriptions.Item>
            <Descriptions.Item label="Người gửi">{t.createdBy?.fullName}</Descriptions.Item>
            <Descriptions.Item label="Ngày gửi">{formatDateTime(t.createdAt)}</Descriptions.Item>
            <Descriptions.Item label="Hạn xử lý">{formatDateTime(t.dueDate)}</Descriptions.Item>
            <Descriptions.Item label="Kỹ thuật viên">{t.assignedTo?.fullName ?? 'Chưa phân công'}</Descriptions.Item>
            {t.rating && (
              <Descriptions.Item label="Đánh giá">
                <Rate disabled value={t.rating} style={{ fontSize: 14 }} /> {t.ratingComment}
              </Descriptions.Item>
            )}
            {t.rejectReason && <Descriptions.Item label="Lý do từ chối">{t.rejectReason}</Descriptions.Item>}
            {t.autoClosed && <Descriptions.Item label="Ghi chú">Tự đóng do cư dân không phản hồi</Descriptions.Item>}
          </Descriptions>
          <Typography.Paragraph style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{t.description}</Typography.Paragraph>
          {t.imageUrls?.length > 0 && (
            <Image.PreviewGroup>
              <Flex gap={8} wrap>
                {t.imageUrls.map((url) => (
                  <Image key={url} src={url} width={96} height={96} style={{ objectFit: 'cover', borderRadius: 8 }} />
                ))}
              </Flex>
            </Image.PreviewGroup>
          )}
        </Card>

        <Card size="small" title="Lịch sử xử lý">
          <Timeline
            items={[...t.history].reverse().map((h) => ({
              color: HISTORY_COLOR[h.action] ?? 'blue',
              content: (
                <Flex vertical>
                  <Typography.Text strong>
                    {HISTORY_LABEL[h.action] ?? h.action}
                    {h.by?.fullName ? ` — ${h.by.fullName}` : h.by ? '' : ' — Hệ thống'}
                  </Typography.Text>
                  {h.note && <Typography.Text>{h.note}</Typography.Text>}
                  {h.imageUrls?.length > 0 && (
                    <div style={{ margin: '6px 0' }}>
                      <EvidencePhotos urls={h.imageUrls} size={72} />
                    </div>
                  )}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {formatDateTime(h.at)}
                  </Typography.Text>
                </Flex>
              ),
            }))}
          />
        </Card>
      </Flex>

      <AssignModal {...modalProps('assign')} />
      <RejectModal {...modalProps('reject')} />
      <ProgressModal {...modalProps('progress')} />
      <ConfirmModal {...modalProps('confirm')} />
    </Spin>
  );
}

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
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
import { ArrowLeftOutlined, PhoneOutlined } from '@ant-design/icons';
import { ticketApi } from '../../api/moduleE.api';
import { repairQuoteApi } from '../../api/moduleB.api';
import QuoteFormModal from '../repairQuotes/QuoteFormModal';
import QuotePanel from '../repairQuotes/QuotePanel';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import EnumTag from '../../components/EnumTag';
import EvidencePhotos from '../../components/EvidencePhotos';
import {
  PRIORITIES,
  TICKET_HISTORY_ACTIONS,
  TICKET_SCOPES,
  TICKET_STATUS,
  TICKET_TYPES,
} from '../../constants/enums';
import { formatDateTime } from '../../utils/format';
import {
  AssignModal, ComplaintResponseModal, ConfirmModal, MergeModal, ProgressModal,
  QuoteDecisionModal, ReclassifyModal, RejectModal,
} from './TicketActionModals';
import { ticketActions } from './ticketActions';

// Chi tiết phản ánh dùng chung cho cư dân (/r) và nội bộ (/app); nút thao tác hiện theo quyền
export default function TicketDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const [modal, setModal] = useState(null);
  const { data: t, loading, error, reload } = useApi(() => ticketApi.get(id), [id]);
  // Báo giá sửa chữa (sự cố trong căn hộ) — tải lại cùng phiếu
  const hasQuotes = t?.type === 'INCIDENT' && t?.scope === 'IN_APARTMENT';
  const quotes = useApi(() => repairQuoteApi.byTicket(id), [id, t?.status, t?.history?.length], { enabled: Boolean(hasQuotes) });
  const [claim, claiming] = useAction(() => ticketApi.claim(id), { success: 'Đã nhận sự cố', onDone: reload });

  if (error && !t) {
    return <Result status="warning" title={error.message} extra={<Button onClick={() => navigate(-1)}>Quay lại</Button>} />;
  }
  if (!t) return <Spin style={{ display: 'block', margin: 48 }} />;

  const {
    canClaim, canAssign, canReject, canProgress, canRespondComplaint, canQuote,
    canDecideQuote, canConfirm, canReclassify, canMerge,
  } = ticketActions(t, user, hasRole);
  const quoteList = quotes.data?.items ?? [];
  const pendingQuote = quoteList.find((q) => q.status === 'PENDING');
  const acceptedQuote = quoteList.find((q) => q.status === 'ACCEPTED');
  const isComplaint = t.type === 'COMPLAINT';
  const modalProps = (key) => ({ ticket: t, open: modal === key, onClose: () => setModal(null), onDone: reload });

  return (
    <Spin spinning={loading}>
      <Flex vertical gap={12}>
        <Flex align="center" gap={8} wrap>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} />
          <Typography.Title level={3} style={{ margin: 0, flex: 1, minWidth: 200 }}>
            {t.title}
          </Typography.Title>
          {canClaim && (
            <Button type="primary" loading={claiming} onClick={() => claim().catch(() => {})}>
              Nhận sự cố
            </Button>
          )}
          {canAssign && (
            <Button type="primary" onClick={() => setModal('assign')}>
              {t.assignedTo ? 'Phân công lại' : 'Phân công'}
            </Button>
          )}
          {canReclassify && <Button onClick={() => setModal('classify')}>Đổi phân loại</Button>}
          {canMerge && <Button onClick={() => setModal('merge')}>Gộp vào phiếu khác</Button>}
          {canReject && (
            <Button danger onClick={() => setModal('reject')}>
              Từ chối
            </Button>
          )}
          {canDecideQuote && (
            <Button type="primary" onClick={() => setModal('quote')}>
              Xem & quyết định báo giá
            </Button>
          )}
          {canQuote && (
            <Button type={canProgress ? 'default' : 'primary'} onClick={() => setModal('quote-form')}>
              {acceptedQuote && t.status !== 'WAITING_QUOTE_APPROVAL' ? 'Báo giá lại' : pendingQuote ? 'Sửa báo giá' : 'Gửi báo giá'}
            </Button>
          )}
          {canProgress && (
            <Button type="primary" onClick={() => setModal('progress')}>
              Cập nhật tiến độ
            </Button>
          )}
          {canRespondComplaint && (
            <Button type="primary" onClick={() => setModal('complaint')}>Xử lý phản ánh</Button>
          )}
          {canConfirm && (
            <Button type="primary" onClick={() => setModal('confirm')}>
              {isComplaint && t.status === 'CLOSED' ? 'Đánh giá kết quả' : 'Xác nhận & đánh giá'}
            </Button>
          )}
        </Flex>

        {t.mergedParent && (
          <Alert
            type="info"
            showIcon
            title={
              hasRole('RESIDENT') ? (
                `Sự cố này trùng với phiếu ${t.mergedParent.code} đang được xử lý (${TICKET_STATUS[t.mergedParent.status]?.label}). Bạn sẽ được báo khi xử lý xong.`
              ) : (
                <>
                  Đã gộp vào phiếu <Link to={`/app/tickets/${t.mergedParent._id}`}>{t.mergedParent.code}</Link> — {t.mergedParent.title}
                </>
              )
            }
          />
        )}
        {t.mergedChildren?.length > 0 && !hasRole('RESIDENT') && (
          <Alert
            type="info"
            showIcon
            title={`Phiếu trùng đã gộp vào đây: ${t.mergedChildren.map((c) => `${c.code} (căn ${c.apartmentCode ?? '?'})`).join(', ')}`}
          />
        )}
        {t.isOverdue && (
          <Alert type="error" showIcon title={`Phản ánh đã quá hạn xử lý (hạn ${formatDateTime(t.dueDate)})`} />
        )}
        {canConfirm && (
          <Alert type="info" showIcon title={isComplaint
            ? 'Ban quản lý đã xử lý phản ánh. Bạn có thể đánh giá kết quả.'
            : 'Kỹ thuật viên đã xử lý xong. Vui lòng xác nhận kết quả và đánh giá.'} />
        )}
        {canDecideQuote && (
          <Alert
            type="warning"
            showIcon
            title="Sửa chữa trong căn hộ có phát sinh phí. Người nộp phí của căn vui lòng đồng ý hoặc từ chối báo giá."
          />
        )}
        {isComplaint && hasRole('MANAGER', 'STAFF:RECEPTIONIST') && (
          <Alert type="info" showIcon title="Phản ánh do Trưởng BQL tiếp nhận và phản hồi, không giao cho kỹ thuật viên." />
        )}

        <Card size="small">
          <Descriptions column={{ xs: 1, md: 2 }} size="small">
            <Descriptions.Item label="Mã">{t.code}</Descriptions.Item>
            <Descriptions.Item label="Trạng thái">
              <EnumTag map={TICKET_STATUS} value={t.status} />
            </Descriptions.Item>
            <Descriptions.Item label="Phân loại">
              <EnumTag map={TICKET_TYPES} value={t.type} />
              {!isComplaint && <EnumTag map={TICKET_SCOPES} value={t.scope} />}
            </Descriptions.Item>
            <Descriptions.Item label="Danh mục">{t.category?.name}</Descriptions.Item>
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
            {t.ackDueAt && !t.assignedTo && (
              <Descriptions.Item label="Hạn nhận phiếu">{formatDateTime(t.ackDueAt)}</Descriptions.Item>
            )}
            {t.responseDueAt && (
              <Descriptions.Item label="Hạn phản hồi">
                {t.respondedAt ? `Đã phản hồi ${formatDateTime(t.respondedAt)}` : formatDateTime(t.responseDueAt)}
              </Descriptions.Item>
            )}
            <Descriptions.Item label="Hạn xử lý">
              {formatDateTime(t.dueDate)}
              {/* M5-2: hạn được lùi thêm phần thời gian chờ khi phiếu chạy tiếp */}
              {t.slaPausedAt && ` (SLA tạm dừng từ ${formatDateTime(t.slaPausedAt)})`}
            </Descriptions.Item>
            {!isComplaint && (
              <Descriptions.Item label="Kỹ thuật viên">{t.assignedTo?.fullName ?? 'Chưa có người nhận'}</Descriptions.Item>
            )}
            {t.quoteDecision?.at && (
              <Descriptions.Item label="Báo giá">
                {t.quoteDecision.accepted ? 'Cư dân đã đồng ý' : 'Cư dân đã từ chối'} lúc {formatDateTime(t.quoteDecision.at)}
              </Descriptions.Item>
            )}
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

        {/* Liên hệ người gửi để xác minh / hẹn giờ vào xử lý — chỉ nhân viên thấy */}
        {hasRole('MANAGER', 'STAFF:RECEPTIONIST', 'STAFF:TECHNICIAN') && (
          <Card size="small" title="Người gửi & liên hệ">
            <Descriptions column={{ xs: 1, md: 2 }} size="small">
              <Descriptions.Item label="Người cần liên hệ">{t.contact?.name ?? t.createdBy?.fullName ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="SĐT liên hệ">
                {(t.contact?.phone ?? (!t.createdByStaff && t.createdBy?.phone)) ? (
                  <Typography.Link href={`tel:${t.contact?.phone ?? t.createdBy?.phone}`} copyable={{ text: t.contact?.phone ?? t.createdBy?.phone }}>
                    <PhoneOutlined /> {t.contact?.phone ?? t.createdBy?.phone}
                  </Typography.Link>
                ) : (
                  <Typography.Text type="secondary">Chưa có</Typography.Text>
                )}
              </Descriptions.Item>
              {t.contact?.note && <Descriptions.Item label="Ghi chú liên hệ">{t.contact.note}</Descriptions.Item>}
              <Descriptions.Item label="Kênh gửi">
                {t.createdByStaff ? `Lễ tân ${t.createdBy?.fullName ?? ''} tạo hộ tại quầy / qua điện thoại` : 'Cư dân tự gửi trên web'}
              </Descriptions.Item>
              {!t.createdByStaff && t.createdBy && (
                <Descriptions.Item label="Tài khoản gửi">
                  {t.createdBy.fullName}
                  {t.createdBy.phone && ` · ${t.createdBy.phone}`}
                  {t.createdBy.email && ` · ${t.createdBy.email}`}
                </Descriptions.Item>
              )}
              <Descriptions.Item label="Căn hộ">
                {t.apartmentId?.code}
                {t.apartmentId?.floor != null && ` · Tầng ${t.apartmentId.floor}`}
                {t.apartmentId?.buildingId?.name && ` · ${t.apartmentId.buildingId.name}`}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        )}

        {hasQuotes && (
          <QuotePanel
            quotes={quoteList}
            loading={quotes.loading}
            invoiceBase={hasRole('RESIDENT') ? '/r/invoices' : '/app/invoices'}
          />
        )}

        <Card size="small" title="Lịch sử xử lý">
          <Timeline
            items={[...t.history].reverse().map((h) => ({
              color: TICKET_HISTORY_ACTIONS[h.action]?.color ?? 'blue',
              content: (
                <Flex vertical>
                  <Typography.Text strong>
                    {TICKET_HISTORY_ACTIONS[h.action]?.label ?? h.action}
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
      <ReclassifyModal {...modalProps('classify')} />
      <MergeModal {...modalProps('merge')} />
      <ProgressModal {...modalProps('progress')} />
      <ComplaintResponseModal {...modalProps('complaint')} />
      <ConfirmModal {...modalProps('confirm')} />
      <QuoteDecisionModal {...modalProps('quote')} quote={pendingQuote} />
      <QuoteFormModal
        ticket={t}
        open={modal === 'quote-form'}
        accepted={acceptedQuote}
        pending={pendingQuote}
        percent={quotes.data?.reapprovalPercent}
        onClose={() => setModal(null)}
        onDone={reload}
      />
    </Spin>
  );
}

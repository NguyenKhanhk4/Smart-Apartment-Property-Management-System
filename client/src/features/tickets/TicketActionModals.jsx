import { Alert, Form, Input, Modal, Radio, Rate, Select } from 'antd';
import { ticketApi } from '../../api/moduleE.api';
import { QuoteItems } from '../repairQuotes/QuotePanel';
import { formatMoney } from '../../utils/format';
import { useAction, useApi } from '../../hooks/useApi';
import { PRIORITIES, TICKET_SCOPES, TICKET_STATUS, TICKET_TYPES, enumOptions } from '../../constants/enums';
import { keysOf } from '../../utils/status';
import EvidencePhotosField from '../../components/EvidencePhotosField';
import { toFiles } from '../../utils/upload';
import { useAuth } from '../../hooks/useAuth';
import { isConsentLocked } from '../../utils/consent';
import { progressOptions } from './ticketActions';

const TS = keysOf(TICKET_STATUS);

const PROGRESS_LABEL = {
  IN_PROGRESS: 'Đang xử lý (cập nhật tiến độ)',
  WAITING_PARTS: 'Chờ linh kiện',
  WAITING_CONFIRM: 'Đã xử lý xong — chờ cư dân nghiệm thu',
};
const NOTE_LABEL = {
  WAITING_PARTS: 'Linh kiện cần chờ, dự kiến ngày có',
  WAITING_CONFIRM: 'Ghi chú kết quả',
};

// Modal dùng chung: form + submit qua useAction
function ActionModal({ title, open, onClose, onDone, action, success, okText, children, initialValues, form: outerForm }) {
  const [innerForm] = Form.useForm();
  const form = outerForm ?? innerForm;
  const [run, loading] = useAction(action, {
    success,
    onDone: () => {
      onClose();
      onDone?.();
    },
  });
  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText={okText}
      confirmLoading={loading}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={initialValues}
        preserve={false}
        onFinish={(v) => run(v).catch(() => {})}
      >
        {children}
      </Form>
    </Modal>
  );
}

// UC-E03 — Phân công KTV + điều chỉnh ưu tiên (đổi ưu tiên → hạn tính lại theo SLA)
export function AssignModal({ ticket, open, onClose, onDone }) {
  const { data: techs = [] } = useApi(() => ticketApi.assignees(), [], { enabled: open });
  return (
    <ActionModal
      title={`Phân công ${ticket.code}`}
      open={open}
      onClose={onClose}
      onDone={onDone}
      okText="Phân công"
      success="Đã phân công kỹ thuật viên"
      initialValues={{ assignedTo: ticket.assignedTo?._id, priority: ticket.priority }}
      action={(v) => ticketApi.assign(ticket._id, v)}
    >
      <Form.Item name="assignedTo" label="Kỹ thuật viên" rules={[{ required: true, message: 'Chọn kỹ thuật viên' }]}>
        <Select
          placeholder="Chọn kỹ thuật viên"
          options={techs.map((t) => ({
            value: t._id,
            label: `${t.fullName} — đang xử lý ${t.openTickets}`,
          }))}
        />
      </Form.Item>
      <Form.Item
        name="priority"
        label="Mức ưu tiên"
        extra="Đổi mức ưu tiên sẽ tính lại hạn xử lý theo SLA (Khẩn cấp 24h, Cao 3 ngày, Thường 7 ngày)."
      >
        <Select options={enumOptions(PRIORITIES)} />
      </Form.Item>
      <Form.Item name="note" label="Ghi chú">
        <Input.TextArea rows={2} maxLength={500} />
      </Form.Item>
    </ActionModal>
  );
}

export function RejectModal({ ticket, open, onClose, onDone }) {
  return (
    <ActionModal
      title={`Từ chối ${ticket.code}`}
      open={open}
      onClose={onClose}
      onDone={onDone}
      okText="Từ chối"
      success="Đã từ chối phản ánh"
      action={(v) => ticketApi.reject(ticket._id, v.reason)}
    >
      <Form.Item name="reason" label="Lý do" rules={[{ required: true, min: 5, message: 'Nhập lý do (tối thiểu 5 ký tự)' }]}>
        <Input.TextArea rows={3} maxLength={500} />
      </Form.Item>
    </ActionModal>
  );
}

// UC-E04 — KTV cập nhật tiến độ; chỉ hiện các bước chuyển hợp lệ (sự cố trong căn hộ phải gửi báo giá trước)
export function ProgressModal({ ticket, open, onClose, onDone }) {
  const [form] = Form.useForm();
  const status = Form.useWatch('status', form);
  const resolved = status === TS.WAITING_CONFIRM;
  const allowed = progressOptions(ticket);
  const options = allowed.map((value) => ({ value, label: PROGRESS_LABEL[value] }));
  return (
    <ActionModal
      title={`Cập nhật tiến độ ${ticket.code}`}
      open={open}
      onClose={onClose}
      onDone={onDone}
      okText="Cập nhật"
      success="Đã cập nhật tiến độ"
      form={form}
      initialValues={{ status: allowed[0] }}
      // "Đã xử lý xong" bắt buộc kèm ảnh kết quả làm bằng chứng cho Manager/Lễ tân
      action={({ images, ...v }) => ticketApi.progress(ticket._id, v, v.status === TS.WAITING_CONFIRM ? toFiles(images) : [])}
    >
      <Form.Item name="status" label="Trạng thái">
        <Radio.Group options={options} style={{ display: 'flex', flexDirection: 'column', gap: 8 }} />
      </Form.Item>
      <Form.Item name="note" label={NOTE_LABEL[status] ?? 'Ghi chú tiến độ'}>
        <Input.TextArea rows={3} maxLength={1000} showCount />
      </Form.Item>
      {resolved && <EvidencePhotosField name="images" label="Ảnh kết quả" />}
    </ActionModal>
  );
}

export function ComplaintResponseModal({ ticket, open, onClose, onDone }) {
  return (
    <ActionModal title={`Xử lý phản ánh ${ticket.code}`} open={open} onClose={onClose} onDone={onDone}
      okText="Lưu phản hồi" success="Đã lưu kết quả xử lý phản ánh"
      initialValues={{ status: TS.IN_PROGRESS }}
      action={({ images, ...body }) => ticketApi.respondComplaint(ticket._id, body, toFiles(images))}>
      <Form.Item name="status" label="Tiến độ" rules={[{ required: true }]}>
        <Radio.Group options={[
          { value: TS.IN_PROGRESS, label: 'Đang xử lý — gửi phản hồi' },
          { value: TS.CLOSED, label: 'Đã xử lý — đóng phiếu' },
        ]} />
      </Form.Item>
      <Form.Item name="note" label="Nội dung phản hồi / Kết quả xử lý"
        rules={[{ required: true, whitespace: true, min: 5, message: 'Nhập ít nhất 5 ký tự' }]}>
        <Input.TextArea rows={4} maxLength={2000} showCount />
      </Form.Item>
      <EvidencePhotosField name="images" label="Ảnh minh chứng (nếu có)" required={false} />
    </ActionModal>
  );
}

// UC-E05 — Cư dân xác nhận + đánh giá sao, hoặc báo chưa đạt
export function ConfirmModal({ ticket, open, onClose, onDone }) {
  const { user } = useAuth();
  const photoLocked = isConsentLocked(user); // BR-X7: chưa đồng ý điều khoản thì không gửi kèm ảnh
  const ratingOnly = ticket.type === 'COMPLAINT' && ticket.status === TS.CLOSED;
  return (
    <ActionModal
      title={`${ratingOnly ? 'Đánh giá phản ánh' : 'Xác nhận kết quả'} ${ticket.code}`}
      open={open}
      onClose={onClose}
      onDone={onDone}
      okText="Gửi"
      success={(res) => (res.data.status === TS.CLOSED ? 'Cảm ơn bạn đã đánh giá' : 'Đã gửi lại cho kỹ thuật viên')}
      initialValues={{ accepted: true, rating: 5 }}
      action={({ accepted, rating, comment, reason, images }) =>
        ticketApi.confirm(ticket._id, accepted ? { accepted, rating, comment } : { accepted, reason }, accepted || photoLocked ? [] : toFiles(images))
      }
    >
      <Form.Item name="accepted" label="Kết quả xử lý" hidden={ratingOnly}>
        <Radio.Group
          options={[
            { value: true, label: 'Đã giải quyết' },
            { value: false, label: 'Chưa đạt, cần xử lý lại' },
          ]}
        />
      </Form.Item>
      <Form.Item noStyle shouldUpdate={(a, b) => a.accepted !== b.accepted}>
        {({ getFieldValue }) =>
          getFieldValue('accepted') !== false ? (
            <>
              <Form.Item name="rating" label={ticket.type === 'COMPLAINT' ? 'Đánh giá kết quả xử lý' : 'Đánh giá kỹ thuật viên'} rules={[{ required: true, message: 'Chọn số sao' }]}>
                <Rate />
              </Form.Item>
              <Form.Item name="comment" label="Nhận xét">
                <Input.TextArea rows={2} maxLength={500} />
              </Form.Item>
            </>
          ) : (
            <>
              <Form.Item name="reason" label="Lý do chưa đạt" rules={[{ required: true, min: 5, message: 'Nhập lý do (tối thiểu 5 ký tự)' }]}>
                <Input.TextArea rows={3} maxLength={500} />
              </Form.Item>
              {/* UC49: ảnh minh chứng kết quả chưa đạt (tùy chọn) */}
              {photoLocked ? (
                <Alert
                  type="info"
                  showIcon
                  title="Chưa đính kèm ảnh được"
                  description="Bạn cần đồng ý điều khoản dữ liệu cá nhân (trong Hồ sơ cá nhân) để gửi ảnh. Vẫn gửi được lý do không kèm ảnh."
                />
              ) : (
                <EvidencePhotosField name="images" label="Ảnh minh chứng (nếu có)" required={false} />
              )}
            </>
          )
        }
      </Form.Item>
    </ActionModal>
  );
}

// Sự cố trong căn hộ — Người nộp phí đồng ý (→ Đang xử lý) hoặc từ chối (→ phiếu bị từ chối) báo giá.
// `quote`: bản báo giá đang chờ (form báo giá của Người 3); dữ liệu cũ không có thì lấy ghi chú trong lịch sử
export function QuoteDecisionModal({ ticket, quote: pending, open, onClose, onDone }) {
  const quote = [...(ticket.history ?? [])].reverse().find((h) => h.action === 'QUOTE_REQUESTED');
  return (
    <ActionModal
      title={`Báo giá sửa chữa ${ticket.code}`}
      open={open}
      onClose={onClose}
      onDone={onDone}
      okText="Gửi quyết định"
      success={(res) =>
        res.data.history?.at(-1)?.action === 'QUOTE_ACCEPTED'
          ? 'Đã đồng ý, kỹ thuật viên sẽ tiến hành'
          : res.data.status === TS.REJECTED
            ? 'Đã từ chối báo giá'
            : 'Đã từ chối chi phí phát sinh, kỹ thuật viên làm tiếp theo báo giá đã đồng ý'
      }
      initialValues={{ accepted: true }}
      action={({ accepted, note }) => ticketApi.decideQuote(ticket._id, { accepted, note })}
    >
      {pending && (
        <Form.Item label={`Báo giá ${pending.code}: ${formatMoney(pending.totalAmount)}`}>
          {pending.previousAmount != null && (
            <div className="mb-2">
              Chi phí phát sinh so với số đã đồng ý {formatMoney(pending.previousAmount)}, cần bạn duyệt lại.
            </div>
          )}
          {pending.note && <div style={{ whiteSpace: 'pre-wrap', marginBottom: 8 }}>{pending.note}</div>}
          <QuoteItems quote={pending} />
        </Form.Item>
      )}
      {!pending && quote?.note && (
        <Form.Item label="Nội dung báo giá">
          <div style={{ whiteSpace: 'pre-wrap' }}>{quote.note}</div>
        </Form.Item>
      )}
      <Form.Item name="accepted" label="Quyết định">
        <Radio.Group
          options={[
            { value: true, label: 'Đồng ý chi phí, tiến hành sửa (tính vào thông báo phí kỳ sau khi nghiệm thu)' },
            { value: false, label: 'Từ chối, không sửa' },
          ]}
        />
      </Form.Item>
      <Form.Item name="note" label="Ghi chú">
        <Input.TextArea rows={2} maxLength={500} />
      </Form.Item>
    </ActionModal>
  );
}

// M5-5 — đổi loại / phạm vi phiếu chưa bắt đầu xử lý; hạn SLA tính lại từ lúc đổi
export function ReclassifyModal({ ticket, open, onClose, onDone }) {
  const [form] = Form.useForm();
  const type = Form.useWatch('type', form) ?? ticket.type;
  return (
    <ActionModal
      title={`Đổi phân loại ${ticket.code}`}
      open={open}
      onClose={onClose}
      onDone={onDone}
      form={form}
      okText="Đổi phân loại"
      success="Đã đổi phân loại phiếu"
      initialValues={{ type: ticket.type, scope: ticket.scope }}
      action={({ type: nextType, scope, reason }) =>
        ticketApi.classify(ticket._id, { type: nextType, ...(nextType === 'INCIDENT' && { scope }), reason })
      }
    >
      <Form.Item name="type" label="Loại phiếu" extra="Đổi sang Phản ánh thì phiếu bỏ kỹ thuật viên, chuyển cho Trưởng BQL xử lý">
        <Radio.Group optionType="button" buttonStyle="solid" options={enumOptions(TICKET_TYPES)} />
      </Form.Item>
      {type === 'INCIDENT' && (
        <Form.Item name="scope" label="Phạm vi" extra="Trong căn hộ: phải gửi báo giá cho Người nộp phí trước khi sửa">
          <Radio.Group options={enumOptions(TICKET_SCOPES)} />
        </Form.Item>
      )}
      <Form.Item name="reason" label="Lý do" rules={[{ required: true, min: 5, message: 'Nhập lý do (tối thiểu 5 ký tự)' }]}>
        <Input.TextArea rows={3} maxLength={500} showCount />
      </Form.Item>
    </ActionModal>
  );
}

// M5-6 — gộp phiếu trùng vào phiếu chính (sự cố khu vực chung đang mở cùng tòa, cùng loại sự cố)
export function MergeModal({ ticket, open, onClose, onDone }) {
  const { data: similar = [], loading } = useApi(
    () =>
      ticketApi.similar({
        apartmentId: ticket.apartmentId?._id ?? ticket.apartmentId,
        categoryId: ticket.category?._id ?? ticket.category,
        excludeId: ticket._id,
      }),
    [ticket._id],
    { enabled: open },
  );
  return (
    <ActionModal
      title={`Gộp ${ticket.code} vào phiếu khác`}
      open={open}
      onClose={onClose}
      onDone={onDone}
      okText="Gộp phiếu"
      success="Đã gộp phiếu"
      action={({ parentId, note }) => ticketApi.merge(ticket._id, { parentId, note })}
    >
      <Form.Item
        name="parentId"
        label="Phiếu chính"
        extra="Phiếu này sẽ đóng theo phiếu chính; người báo được thông báo khi xử lý xong"
        rules={[{ required: true, message: 'Chọn phiếu chính' }]}
      >
        <Select
          loading={loading}
          placeholder={similar.length ? 'Chọn phiếu đang xử lý cùng sự cố' : 'Không có sự cố cùng loại đang mở trong tòa'}
          options={similar.map((s) => ({ value: s._id, label: `${s.code} · ${s.title} (${TICKET_STATUS[s.status]?.label ?? s.status})` }))}
        />
      </Form.Item>
      <Form.Item name="note" label="Ghi chú">
        <Input.TextArea rows={2} maxLength={500} />
      </Form.Item>
    </ActionModal>
  );
}


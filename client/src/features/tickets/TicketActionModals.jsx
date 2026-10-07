import { Form, Input, Modal, Radio, Rate, Select } from 'antd';
import { ticketApi } from '../../api/moduleE.api';
import { useAction, useApi } from '../../hooks/useApi';
import { PRIORITIES, enumOptions } from '../../constants/enums';
import EvidencePhotosField from '../../components/EvidencePhotosField';
import { toFiles } from '../../utils/upload';

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

// UC-E04 — KTV cập nhật tiến độ
export function ProgressModal({ ticket, open, onClose, onDone }) {
  const [form] = Form.useForm();
  const resolved = Form.useWatch('status', form) === 'WAITING_CONFIRM';
  const options = [
    { value: 'IN_PROGRESS', label: 'Đang xử lý (cập nhật tiến độ)' },
    { value: 'WAITING_CONFIRM', label: 'Đã xử lý xong — chờ cư dân xác nhận' },
  ];
  return (
    <ActionModal
      title={`Cập nhật tiến độ ${ticket.code}`}
      open={open}
      onClose={onClose}
      onDone={onDone}
      okText="Cập nhật"
      success="Đã cập nhật tiến độ"
      form={form}
      initialValues={{ status: 'IN_PROGRESS' }}
      // "Đã xử lý xong" bắt buộc kèm ảnh kết quả làm bằng chứng cho Manager/Lễ tân
      action={({ images, ...v }) => ticketApi.progress(ticket._id, v, v.status === 'WAITING_CONFIRM' ? toFiles(images) : [])}
    >
      <Form.Item name="status" label="Trạng thái">
        <Radio.Group options={options} style={{ display: 'flex', flexDirection: 'column', gap: 8 }} />
      </Form.Item>
      <Form.Item name="note" label={resolved ? 'Ghi chú kết quả' : 'Ghi chú tiến độ'}>
        <Input.TextArea rows={3} maxLength={1000} showCount />
      </Form.Item>
      {resolved && <EvidencePhotosField name="images" label="Ảnh kết quả" />}
    </ActionModal>
  );
}

// UC-E05 — Cư dân xác nhận + đánh giá sao, hoặc báo chưa đạt
export function ConfirmModal({ ticket, open, onClose, onDone }) {
  return (
    <ActionModal
      title={`Xác nhận kết quả ${ticket.code}`}
      open={open}
      onClose={onClose}
      onDone={onDone}
      okText="Gửi"
      success={(res) => (res.data.status === 'CLOSED' ? 'Cảm ơn bạn đã đánh giá' : 'Đã gửi lại cho kỹ thuật viên')}
      initialValues={{ accepted: true, rating: 5 }}
      action={({ accepted, rating, comment, reason }) =>
        ticketApi.confirm(ticket._id, accepted ? { accepted, rating, comment } : { accepted, reason })
      }
    >
      <Form.Item name="accepted" label="Kết quả xử lý">
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
              <Form.Item name="rating" label="Đánh giá kỹ thuật viên" rules={[{ required: true, message: 'Chọn số sao' }]}>
                <Rate />
              </Form.Item>
              <Form.Item name="comment" label="Nhận xét">
                <Input.TextArea rows={2} maxLength={500} />
              </Form.Item>
            </>
          ) : (
            <Form.Item name="reason" label="Lý do chưa đạt" rules={[{ required: true, min: 5, message: 'Nhập lý do (tối thiểu 5 ký tự)' }]}>
              <Input.TextArea rows={3} maxLength={500} />
            </Form.Item>
          )
        }
      </Form.Item>
    </ActionModal>
  );
}

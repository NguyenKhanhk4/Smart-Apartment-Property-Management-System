import { Form, Input, Modal, Typography } from 'antd';
import { workOrderApi } from '../../api/moduleD.api';
import { useAction } from '../../hooks/useApi';
import EvidencePhotosField from '../../components/EvidencePhotosField';
import { toFiles } from '../../utils/upload';

// UC-D04 — KTV hoàn thành work order: bắt buộc ghi chú kết quả (≥ 5 ký tự) + ít nhất 1 ảnh bằng chứng.
// Hoàn thành xong, ngày bảo trì tiếp theo của tài sản được tính lại từ hôm nay.
export default function CompleteWorkOrderModal({ workOrder, open, onClose, onDone }) {
  const [form] = Form.useForm();
  const [save, saving] = useAction(
    (v) => workOrderApi.updateStatus(workOrder._id, { status: 'DONE', note: v.note.trim() }, toFiles(v.images)),
    {
      onDone: () => {
        onClose();
        onDone?.();
      },
    },
  );

  return (
    <Modal
      title="Hoàn thành work order"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Hoàn thành"
      cancelText="Hủy"
      confirmLoading={saving}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        {workOrder.title}. Sau khi hoàn thành sẽ không sửa được nữa, lịch bảo trì của tài sản được tính lại từ hôm nay.
      </Typography.Paragraph>
      <Form form={form} layout="vertical" preserve={false} onFinish={(v) => save(v).catch(() => {})}>
        <Form.Item
          name="note"
          label="Kết quả bảo trì"
          rules={[
            { required: true, whitespace: true, message: 'Nhập ghi chú kết quả' },
            { min: 5, message: 'Ghi chú tối thiểu 5 ký tự' },
          ]}
        >
          <Input.TextArea rows={4} maxLength={1000} showCount placeholder="Đã làm gì, thay thế vật tư nào, tình trạng sau bảo trì…" />
        </Form.Item>
        <EvidencePhotosField name="images" label="Ảnh bằng chứng" />
      </Form>
    </Modal>
  );
}

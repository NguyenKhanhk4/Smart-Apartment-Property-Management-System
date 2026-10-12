import { Form, Input, Modal, Select, Typography } from 'antd';
import { workOrderApi } from '../../api/moduleD.api';
import { useAction, useApi } from '../../hooks/useApi';

// UC-D03 — Phân công / giao lại kỹ thuật viên. Dùng chung cho trang Work order và chi tiết tài sản.
// `workOrder` cần có _id, title và assignedTo ({ _id, fullName } hoặc null).
export default function AssignWorkOrderModal({ workOrder, open, onClose, onDone }) {
  const [form] = Form.useForm();
  const { data: techs = [], loading } = useApi(() => workOrderApi.assignees(), [], { enabled: open });
  const [save, saving] = useAction((v) => workOrderApi.assign(workOrder._id, v), {
    onDone: () => {
      onClose();
      onDone?.();
    },
  });
  const current = workOrder.assignedTo;

  return (
    <Modal
      title={current ? 'Giao lại work order' : 'Phân công work order'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText={current ? 'Giao lại' : 'Phân công'}
      cancelText="Hủy"
      confirmLoading={saving}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        {workOrder.title}
        {current && <> — đang giao cho <b>{current.fullName}</b></>}
      </Typography.Paragraph>
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{ assignedTo: current?._id }}
        onFinish={(v) => save({ assignedTo: v.assignedTo, note: v.note?.trim() || undefined }).catch(() => {})}
      >
        <Form.Item name="assignedTo" label="Kỹ thuật viên" rules={[{ required: true, message: 'Chọn kỹ thuật viên' }]}>
          <Select
            showSearch
            optionFilterProp="label"
            loading={loading}
            placeholder="Chọn kỹ thuật viên"
            options={techs.map((t) => ({
              value: t._id,
              label: `${t.fullName} — đang có ${t.openWorkOrders} việc mở`,
            }))}
          />
        </Form.Item>
        <Form.Item name="note" label="Ghi chú">
          <Input.TextArea rows={2} maxLength={500} showCount placeholder="Dặn dò kỹ thuật viên (tùy chọn)" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

import { useState } from 'react';
import { Form, Input, Modal, Select, Upload } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { complaintCategoryApi, lookupApi, ticketApi } from '../../api/moduleE.api';
import { useAction, useApi } from '../../hooks/useApi';
import { PRIORITIES } from '../../constants/enums';

const MAX_SIZE = 5 * 1024 * 1024;

// UC-E02 — Cư dân tạo phản ánh kèm tối đa 5 ảnh jpg/png ≤ 5MB
export default function TicketCreateModal({ open, onClose, onCreated }) {
  const [form] = Form.useForm();
  const [files, setFiles] = useState([]);
  const { data: categories = [] } = useApi(() => complaintCategoryApi.list(), [], { enabled: open });
  const { data: apartments = [] } = useApi(() => lookupApi.apartments(), [], { enabled: open });

  const [submit, submitting] = useAction(
    (values) => ticketApi.create(values, files.map((f) => f.originFileObj)),
    {
      success: 'Đã gửi phản ánh',
      onDone: (res) => {
        form.resetFields();
        setFiles([]);
        onCreated?.(res.data);
      },
    },
  );

  const beforeUpload = (file) => {
    const okType = ['image/jpeg', 'image/png'].includes(file.type);
    if (!okType || file.size > MAX_SIZE) {
      Modal.error({ title: 'Ảnh không hợp lệ', content: 'Chỉ nhận ảnh jpg/png, tối đa 5MB mỗi ảnh.' });
      return Upload.LIST_IGNORE;
    }
    return false; // giữ lại, gửi cùng form
  };

  const categoryId = Form.useWatch('categoryId', form);
  const selected = categories.find((c) => c._id === categoryId);

  return (
    <Modal
      title="Tạo phản ánh"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Gửi phản ánh"
      confirmLoading={submitting}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={(v) => submit(v).catch(() => {})}>
        {apartments.length > 1 && (
          <Form.Item name="apartmentId" label="Căn hộ" rules={[{ required: true, message: 'Chọn căn hộ' }]}>
            <Select options={apartments.map((a) => ({ value: a._id, label: a.code }))} />
          </Form.Item>
        )}
        <Form.Item
          name="categoryId"
          label="Loại phản ánh"
          rules={[{ required: true, message: 'Chọn loại phản ánh' }]}
          extra={
            selected &&
            `Mức ưu tiên: ${PRIORITIES[selected.defaultPriority]?.label} · Hạn xử lý dự kiến ${selected.slaHours} giờ`
          }
        >
          <Select
            placeholder="Chọn loại"
            options={categories.map((c) => ({ value: c._id, label: c.name }))}
          />
        </Form.Item>
        <Form.Item
          name="title"
          label="Tiêu đề"
          rules={[{ required: true, min: 5, max: 150, message: 'Tiêu đề 5-150 ký tự' }]}
        >
          <Input placeholder="Vd: Rò nước trần nhà tắm" />
        </Form.Item>
        <Form.Item
          name="description"
          label="Mô tả chi tiết"
          rules={[{ required: true, min: 10, message: 'Mô tả tối thiểu 10 ký tự' }]}
        >
          <Input.TextArea rows={4} maxLength={2000} showCount />
        </Form.Item>
        <Form.Item label="Ảnh minh họa (tối đa 5)">
          <Upload
            listType="picture-card"
            accept="image/jpeg,image/png"
            multiple
            fileList={files}
            beforeUpload={beforeUpload}
            onChange={({ fileList }) => setFiles(fileList.slice(0, 5))}
          >
            {files.length < 5 && (
              <div>
                <PlusOutlined />
                <div style={{ marginTop: 4 }}>Thêm ảnh</div>
              </div>
            )}
          </Upload>
        </Form.Item>
      </Form>
    </Modal>
  );
}

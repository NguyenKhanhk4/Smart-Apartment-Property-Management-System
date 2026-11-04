import { useState } from 'react';
import { Form, Input, Modal, Radio, Select, Upload } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { complaintCategoryApi, lookupApi, ticketApi } from '../../api/moduleE.api';
import { useAction, useApi } from '../../hooks/useApi';
import ApartmentSelect from '../../components/ApartmentSelect';
import { PRIORITIES, TICKET_SCOPES, TICKET_TYPES, enumOptions } from '../../constants/enums';

const MAX_SIZE = 5 * 1024 * 1024;

const TYPE_HINT = {
  INCIDENT: 'Hỏng hóc cần kỹ thuật xử lý: điện, nước, thang máy, cửa... Kỹ thuật viên đang trực sẽ nhận phiếu.',
  COMPLAINT: 'Góp ý, khiếu nại về dịch vụ, vệ sinh, an ninh, hàng xóm... Ban quản lý sẽ phản hồi.',
};

/**
 * UC-E02 — Gửi sự cố / phản ánh kèm tối đa 5 ảnh jpg/png ≤ 5MB.
 * `staff` = Lễ tân tạo hộ cư dân: chọn căn bất kỳ, gọi API /tickets/staff.
 */
export default function TicketCreateModal({ open, onClose, onCreated, staff = false }) {
  const [form] = Form.useForm();
  const [files, setFiles] = useState([]);
  const type = Form.useWatch('type', form) ?? 'INCIDENT';
  const { data: categories = [] } = useApi(() => complaintCategoryApi.list(), [], { enabled: open });
  const { data: myApartments = [] } = useApi(() => lookupApi.apartments(), [], { enabled: open && !staff });

  const [submit, submitting] = useAction(
    (values) => (staff ? ticketApi.createByStaff : ticketApi.create)(values, files.map((f) => f.originFileObj)),
    {
      success: type === 'COMPLAINT' ? 'Đã gửi phản ánh' : 'Đã gửi sự cố',
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
      title={staff ? 'Tạo phiếu giúp cư dân' : 'Gửi sự cố / phản ánh'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Gửi"
      cancelText="Hủy"
      confirmLoading={submitting}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ type: 'INCIDENT', scope: 'COMMON_AREA' }}
        onFinish={(v) => submit(v).catch(() => {})}
      >
        {staff ? (
          <Form.Item name="apartmentId" label="Căn hộ" rules={[{ required: true, message: 'Chọn căn hộ' }]}>
            <ApartmentSelect placeholder="Tìm mã căn" />
          </Form.Item>
        ) : (
          myApartments.length > 1 && (
            <Form.Item name="apartmentId" label="Căn hộ" rules={[{ required: true, message: 'Chọn căn hộ' }]}>
              <Select options={myApartments.map((a) => ({ value: a._id, label: a.code }))} />
            </Form.Item>
          )
        )}
        <Form.Item name="type" label="Bạn muốn gửi" extra={TYPE_HINT[type]}>
          <Radio.Group optionType="button" buttonStyle="solid" options={enumOptions(TICKET_TYPES)} />
        </Form.Item>
        {type === 'INCIDENT' && (
          <Form.Item
            name="scope"
            label="Vị trí"
            extra="Sửa chữa trong căn hộ có thể phát sinh phí; kỹ thuật viên gửi báo giá để người nộp phí đồng ý trước."
          >
            <Radio.Group options={enumOptions(TICKET_SCOPES)} />
          </Form.Item>
        )}
        <Form.Item
          name="categoryId"
          label="Danh mục"
          rules={[{ required: true, message: 'Chọn danh mục' }]}
          extra={
            selected &&
            `Mức ưu tiên: ${PRIORITIES[selected.defaultPriority]?.label} · Hạn xử lý dự kiến ${selected.slaHours} giờ`
          }
        >
          <Select placeholder="Chọn danh mục" options={categories.map((c) => ({ value: c._id, label: c.name }))} />
        </Form.Item>
        <Form.Item name="title" label="Tiêu đề" rules={[{ required: true, min: 5, max: 150, message: 'Tiêu đề 5-150 ký tự' }]}>
          <Input placeholder={type === 'COMPLAINT' ? 'Vd: Hành lang tầng 5 chưa được dọn' : 'Vd: Rò nước trần nhà tắm'} />
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

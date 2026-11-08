import { useState } from 'react';
import { Alert, App, Form, Input, Modal, Select, Tag, Upload } from 'antd';
import { ApartmentOutlined, ClockCircleOutlined, HomeOutlined, MessageOutlined, PhoneOutlined, PlusOutlined, ToolOutlined, UserOutlined } from '@ant-design/icons';
import { complaintCategoryApi, lookupApi, ticketApi } from '../../api/moduleE.api';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { PHONE_RULES } from '../../utils/phone';
import ApartmentSelect from '../../components/ApartmentSelect';
import { PRIORITIES, TICKET_STATUS } from '../../constants/enums';
import { IMAGE_ACCEPT, IMAGE_HINT, checkImageFile } from '../../utils/imageUpload';

const MAX_PHOTOS = 5;

const TYPES = [
  {
    value: 'INCIDENT',
    icon: <ToolOutlined />,
    title: 'Sự cố kỹ thuật',
    desc: 'Hỏng hóc điện, nước, thang máy, cửa… Kỹ thuật viên đang trực nhận phiếu.',
  },
  {
    value: 'COMPLAINT',
    icon: <MessageOutlined />,
    title: 'Phản ánh',
    desc: 'Góp ý về dịch vụ, vệ sinh, an ninh, hàng xóm… Ban quản lý phản hồi.',
  },
];
const SCOPES = [
  { value: 'COMMON_AREA', icon: <ApartmentOutlined />, title: 'Khu vực chung', desc: 'Hành lang, thang máy, sảnh… miễn phí' },
  { value: 'IN_APARTMENT', icon: <HomeOutlined />, title: 'Trong căn hộ', desc: 'Có thể phát sinh phí, báo giá trước' },
];

/** Chọn 1 trong các thẻ (icon + tiêu đề + mô tả) — dùng như input của Form.Item (value / onChange) */
function CardChoice({ options, value, onChange, compact = false }) {
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange?.(o.value)}
            className={`text-left cursor-pointer rounded-xl border bg-white px-3 transition-colors flex gap-2.5 ${compact ? 'py-2 items-center' : 'py-2.5 items-start'} ${
              active ? 'border-navy bg-navy-bg ring-2 ring-navy/15' : 'border-line hover:border-line-strong'
            }`}
          >
            <span
              className={`shrink-0 rounded-lg flex items-center justify-center ${compact ? 'w-7 h-7 text-sm' : 'w-8 h-8 text-base'} ${
                active ? 'bg-navy text-white' : 'bg-surface-alt text-ink-2'
              }`}
            >
              {o.icon}
            </span>
            <span className="min-w-0">
              <span className={`block text-[13.5px] font-semibold ${active ? 'text-navy' : 'text-ink'}`}>{o.title}</span>
              <span className="block text-[12px] leading-snug text-ink-3">{o.desc}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * UC-E02 — Gửi sự cố / phản ánh kèm tối đa 5 ảnh (mọi định dạng ảnh, tự chuyển JPEG và thu nhỏ khi gửi — UC63).
 * Web: 2 cột — trái phân loại (loại phiếu, vị trí, danh mục + hạn xử lý) + liên hệ, phải nội dung (tiêu đề, mô tả, ảnh); màn hẹp 1 cột.
 * Liên hệ để xác minh: cư dân điền sẵn tên + SĐT tài khoản (sửa được); Lễ tân tạo hộ bắt buộc nhập tên + SĐT người báo.
 * `staff` = Lễ tân tạo hộ cư dân: chọn căn bất kỳ, gọi API /tickets/staff.
 */
export default function TicketCreateModal({ open, onClose, onCreated, staff = false }) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const { user } = useAuth();
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
    const error = checkImageFile(file);
    if (error) {
      message.error(error);
      return Upload.LIST_IGNORE;
    }
    return false; // giữ lại, gửi cùng form
  };
  const changeFiles = ({ fileList }) => {
    if (fileList.length > MAX_PHOTOS) message.warning(`Tối đa ${MAX_PHOTOS} ảnh, đã bỏ bớt ảnh chọn thêm`);
    setFiles(fileList.slice(0, MAX_PHOTOS));
  };

  const categoryId = Form.useWatch('categoryId', form);
  const scope = Form.useWatch('scope', form) ?? 'COMMON_AREA';
  const apartmentId = Form.useWatch('apartmentId', form);
  const selected = categories.find((c) => c._id === categoryId);
  // M5-6: báo trước sự cố khu vực chung cùng loại đang được xử lý trong tòa để tránh báo trùng
  const checkSimilar = open && type === 'INCIDENT' && scope === 'COMMON_AREA' && Boolean(categoryId) && (!staff || Boolean(apartmentId));
  const { data: similar = [] } = useApi(() => ticketApi.similar({ apartmentId, categoryId }), [categoryId, apartmentId, checkSimilar], {
    enabled: checkSimilar,
  });
  const priority = selected && PRIORITIES[selected.defaultPriority];

  return (
    <Modal
      title={staff ? 'Tạo phiếu giúp cư dân' : 'Gửi sự cố / phản ánh'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText={type === 'COMPLAINT' ? 'Gửi phản ánh' : 'Gửi sự cố'}
      cancelText="Hủy"
      confirmLoading={submitting}
      width="min(920px, 94vw)"
      centered
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{
          type: 'INCIDENT',
          scope: 'COMMON_AREA',
          ...(!staff && { contactName: user?.fullName, contactPhone: user?.phone ?? undefined }),
        }}
        onFinish={(v) => submit(v).catch(() => {})}
        className="pt-2"
      >
        <div className="grid gap-x-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* Cột trái: phân loại */}
          <div className="md:pr-6 md:border-r md:border-line">
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
            <Form.Item name="type" label="Bạn muốn gửi">
              <CardChoice options={TYPES} />
            </Form.Item>
            {type === 'INCIDENT' && (
              <Form.Item name="scope" label="Vị trí">
                <CardChoice options={SCOPES} compact />
              </Form.Item>
            )}
            <Form.Item name="categoryId" label="Danh mục" rules={[{ required: true, message: 'Chọn danh mục' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Chọn danh mục"
                options={categories.map((c) => ({ value: c._id, label: c.name }))}
              />
            </Form.Item>
            {selected && (
              <div className="-mt-2 mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-surface-alt px-3 py-2 text-[12.5px] text-ink-2">
                <span>Mức ưu tiên</span>
                <Tag color={priority?.color} className="m-0">
                  {priority?.label}
                </Tag>
                <span className="inline-flex items-center gap-1">
                  <ClockCircleOutlined /> Hạn xử lý dự kiến {selected.slaHours} giờ
                </span>
              </div>
            )}
            <div className="mb-2 pt-1 text-[13px] font-semibold text-ink">Thông tin liên hệ</div>
            <p className="-mt-1 mb-3 text-[12px] text-ink-3">
              {staff ? 'Người báo sự cố (bắt buộc) để Ban quản lý gọi xác minh.' : 'Để Ban quản lý / kỹ thuật viên gọi xác minh và hẹn giờ vào xử lý.'}
            </p>
            <div className="grid gap-x-3 sm:grid-cols-2">
              <Form.Item
                name="contactName"
                label="Họ tên"
                rules={staff ? [{ required: true, min: 2, message: 'Nhập tên người báo' }] : undefined}
              >
                <Input prefix={<UserOutlined className="text-ink-3" />} maxLength={100} placeholder="Họ tên người cần liên hệ" />
              </Form.Item>
              <Form.Item
                name="contactPhone"
                label="Số điện thoại"
                rules={staff ? PHONE_RULES : PHONE_RULES.filter((r) => !r.required)}
              >
                <Input prefix={<PhoneOutlined className="text-ink-3" />} maxLength={15} placeholder="0912345678" inputMode="tel" />
              </Form.Item>
            </div>
            <Form.Item name="contactNote" label="Thời gian thuận tiện / ghi chú">
              <Input maxLength={200} placeholder="Vd: có nhà sau 18h, gọi trước khi lên" />
            </Form.Item>
            {checkSimilar && similar.length > 0 && (
              <Alert
                type="warning"
                showIcon
                className="mb-4"
                title="Sự cố cùng loại đang được xử lý trong tòa"
                description={
                  <>
                    {similar.map((s) => (
                      <div key={s._id}>
                        {s.code} · {s.title} ({TICKET_STATUS[s.status]?.label ?? s.status})
                      </div>
                    ))}
                    Nếu là cùng sự cố, bạn không cần gửi thêm. Vẫn gửi được nếu là sự cố khác.
                  </>
                }
              />
            )}
          </div>

          {/* Cột phải: nội dung */}
          <div>
            <Form.Item name="title" label="Tiêu đề" rules={[{ required: true, min: 5, max: 150, message: 'Tiêu đề 5-150 ký tự' }]}>
              <Input maxLength={150} placeholder={type === 'COMPLAINT' ? 'Vd: Hành lang tầng 5 chưa được dọn' : 'Vd: Rò nước trần nhà tắm'} />
            </Form.Item>
            <Form.Item name="description" label="Mô tả chi tiết" rules={[{ required: true, min: 10, message: 'Mô tả tối thiểu 10 ký tự' }]}>
              <Input.TextArea
                autoSize={{ minRows: 4, maxRows: 7 }}
                maxLength={2000}
                showCount
                placeholder="Vị trí cụ thể, bắt đầu từ khi nào, mức độ ảnh hưởng…"
              />
            </Form.Item>
            <Form.Item label={`Ảnh minh họa (${files.length}/${MAX_PHOTOS})`} extra={IMAGE_HINT} className="mb-0">
              <Upload listType="picture-card" accept={IMAGE_ACCEPT} multiple fileList={files} beforeUpload={beforeUpload} onChange={changeFiles}>
                {files.length < MAX_PHOTOS && (
                  <div className="text-ink-2">
                    <PlusOutlined />
                    <div className="mt-1 text-[12px]">Thêm ảnh</div>
                  </div>
                )}
              </Upload>
            </Form.Item>
          </div>
        </div>
      </Form>
    </Modal>
  );
}

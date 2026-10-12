import { useState } from 'react';
import { Alert, App, Button, Flex, Form, Image, Input, InputNumber, Modal, Segmented, Select, TimePicker, Typography, Upload } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { amenityApi } from '../../api/moduleD.api';
import { AMENITY_ACCESS_MODES, enumOptions } from '../../constants/enums';
import { useAction } from '../../hooks/useApi';
import { formatMoney } from '../../utils/format';

const MAX_SIZE = 5 * 1024 * 1024;
const toDayjs = (hhmm) => (hhmm ? dayjs().hour(Number(hhmm.slice(0, 2))).minute(Number(hhmm.slice(3))).second(0) : null);
const toMinutes = (d) => d.hour() * 60 + d.minute();
const blank = (v) => v === undefined || v === null || v === '';

// Nhóm trường gửi lên theo kiểu; trường tùy chọn để trống gửi '' để server xóa giá trị (null)
const MODE_BODY = {
  FREE: [],
  WALK_IN: ['perVisitFeeAdult', 'perVisitFeeChild', 'maxConcurrent', 'monthlyPassFeeAdult', 'monthlyPassFeeChild'],
  BOOKING: ['slotDurationMinutes', 'capacityPerSlot', 'feePerBooking', 'monthlyPassFeeAdult', 'monthlyPassFeeChild'],
};

function MoneyInput(props) {
  return (
    <InputNumber
      min={0}
      max={100000000}
      step={10000}
      precision={0}
      style={{ width: '100%' }}
      addonAfter="đ"
      formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}
      parser={(v) => v?.replace(/\./g, '')}
      {...props}
    />
  );
}

// UC-D05 — Thêm / sửa tiện ích theo kiểu. reception = { open, close } giờ lễ tân (BR-O15) để báo lỗi sớm;
// childFreeAge / childAdultAge để ghi chú nhóm tuổi; server vẫn kiểm tra lại.
export default function AmenityFormModal({ amenity, buildings, reception, ages, open, onClose, onDone }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [image, setImage] = useState(null); // { file, preview } ảnh mới chọn
  const isEdit = Boolean(amenity?._id);
  const initialMode = amenity?.accessMode ?? 'BOOKING';
  const mode = Form.useWatch('accessMode', form) ?? initialMode;
  const isFree = mode === 'FREE';

  const [save, saving] = useAction(
    (v) => {
      const body = {
        name: v.name,
        accessMode: v.accessMode,
        buildingId: v.buildingId ?? '',
        location: v.location ?? '',
        description: v.description ?? '',
        openTime: v.openTime ? v.openTime.format('HH:mm') : '',
        closeTime: v.closeTime ? v.closeTime.format('HH:mm') : '',
      };
      MODE_BODY[v.accessMode].forEach((k) => {
        body[k] = v[k] ?? '';
      });
      return isEdit ? amenityApi.update(amenity._id, body, image?.file) : amenityApi.create(body, image?.file);
    },
    {
      success: isEdit ? 'Đã cập nhật tiện ích' : 'Đã thêm tiện ích',
      onDone: () => {
        onClose();
        onDone();
      },
    },
  );

  const submit = (v) =>
    save(v).catch((err) => {
      // Lỗi từ server có details theo field → hiện ngay dưới ô tương ứng
      if (err.details?.length) {
        form.setFields(err.details.map((d) => ({ name: d.field, errors: [d.message] })));
      }
    });

  const beforeUpload = (file) => {
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > MAX_SIZE) {
      message.error('Chỉ nhận ảnh jpg/png tối đa 5MB.');
      return Upload.LIST_IGNORE;
    }
    setImage({ file, preview: URL.createObjectURL(file) });
    return false; // gửi cùng form (FormData)
  };

  // Giờ mở cửa:
  //   FREE — tùy chọn: để trống cả hai = không có giờ; nhập một phải nhập cả cặp
  //   WALK_IN/BOOKING — bắt buộc + nằm trong giờ lễ tân (BR-O15)
  const openRules = [
    ({ getFieldValue }) => ({
      validator: (_, v) => {
        if (isFree) {
          // Để trống cả hai → OK
          if (!v && !getFieldValue('closeTime')) return Promise.resolve();
          // Có closeTime mà thiếu openTime
          if (!v) return Promise.reject(new Error('Nhập cả giờ mở và giờ đóng'));
          return Promise.resolve();
        }
        if (!v) return Promise.reject(new Error('Chọn giờ mở cửa'));
        return toMinutes(v) >= toMinutes(toDayjs(reception.open))
          ? Promise.resolve()
          : Promise.reject(new Error(`Không sớm hơn giờ lễ tân (${reception.open})`));
      },
    }),
  ];
  const closeRules = [
    ({ getFieldValue }) => ({
      validator: (_, v) => {
        const o = getFieldValue('openTime');
        if (isFree) {
          // Để trống cả hai → OK
          if (!v && !o) return Promise.resolve();
          // Có openTime mà thiếu closeTime
          if (!v) return Promise.reject(new Error('Nhập cả giờ mở và giờ đóng'));
          if (o && toMinutes(v) <= toMinutes(o)) return Promise.reject(new Error('Phải sau giờ mở cửa'));
          return Promise.resolve();
        }
        if (!v) return Promise.reject(new Error('Chọn giờ đóng cửa'));
        if (toMinutes(v) > toMinutes(toDayjs(reception.close))) {
          return Promise.reject(new Error(`Không muộn hơn giờ lễ tân (${reception.close})`));
        }
        if (o && toMinutes(v) <= toMinutes(o)) return Promise.reject(new Error('Phải sau giờ mở cửa'));
        const slot = mode === 'BOOKING' ? (getFieldValue('slotDurationMinutes') ?? 0) : 0;
        if (o && toMinutes(o) + slot > toMinutes(v)) return Promise.reject(new Error('Không đủ cho 1 slot'));
        return Promise.resolve();
      },
    }),
  ];

  // Gói tháng: nhập đủ cả hai giá hoặc để trống cả hai (trống = không bán gói)
  const passRule = (other, label) => ({ getFieldValue }) => ({
    validator: (_, v) =>
      blank(v) !== blank(getFieldValue(other)) && blank(v) ? Promise.reject(new Error(`Nhập thêm ${label} hoặc để trống cả hai`)) : Promise.resolve(),
  });

  const money = (name, label, extra, rules = [], dependencies) => (
    <Form.Item name={name} label={label} style={{ flex: 1, minWidth: 180 }} extra={extra} rules={rules} dependencies={dependencies}>
      <MoneyInput />
    </Form.Item>
  );

  // Tiện ích không phải WALK_IN: bỏ giá vé mặc định 0 để lúc đổi sang Vào cửa buộc nhập giá vé
  const stored = Object.fromEntries(Object.entries(amenity ?? {}).filter(([, v]) => v !== null));
  if (initialMode !== 'WALK_IN') {
    delete stored.perVisitFeeAdult;
    delete stored.perVisitFeeChild;
  }
  const initialValues = isEdit
    ? {
        ...stored,
        accessMode: initialMode,
        buildingId: amenity.buildingId?._id ?? amenity.buildingId ?? undefined,
        openTime: amenity.openTime ? toDayjs(amenity.openTime) : null,
        closeTime: amenity.closeTime ? toDayjs(amenity.closeTime) : null,
      }
    : {
        accessMode: 'BOOKING',
        openTime: toDayjs(reception.open),
        closeTime: toDayjs(reception.close),
        slotDurationMinutes: 60,
        capacityPerSlot: 1,
        feePerBooking: 0,
      };

  return (
    <Modal
      title={isEdit ? `Sửa tiện ích — ${amenity.name}` : 'Thêm tiện ích'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText={isEdit ? 'Lưu' : 'Thêm'}
      cancelText="Hủy"
      confirmLoading={saving}
      width={680}
      destroyOnHidden
    >
      {isEdit && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Thay đổi chỉ áp dụng cho lượt đặt / vé mới. Lượt đã đặt giữ nguyên khung giờ và phí lúc đặt."
        />
      )}
      <Form form={form} layout="vertical" preserve={false} initialValues={initialValues} onFinish={submit}>
        <Form.Item name="accessMode" label="Kiểu tiện ích" extra={AMENITY_ACCESS_MODES[mode]?.hint}>
          <Segmented block options={enumOptions(AMENITY_ACCESS_MODES)} />
        </Form.Item>
        {isEdit && mode !== initialMode && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="Đổi kiểu tiện ích: các trường của kiểu cũ sẽ bị bỏ, cần nhập đủ các trường của kiểu mới. Không đổi được khi còn lượt đặt sắp tới."
          />
        )}
        <Form.Item name="name" label="Tên tiện ích" rules={[{ required: true, min: 2, max: 100, message: 'Tên 2–100 ký tự' }]}>
          <Input maxLength={100} placeholder="vd Phòng gym" />
        </Form.Item>
        <Flex gap={12} wrap>
          <Form.Item name="buildingId" label="Tòa" style={{ flex: 1, minWidth: 200 }} extra="Để trống = dùng chung toàn khu">
            <Select allowClear placeholder="Toàn khu" options={buildings.map((b) => ({ value: b._id, label: b.name }))} />
          </Form.Item>
          <Form.Item name="location" label="Vị trí" style={{ flex: 1, minWidth: 200 }}>
            <Input maxLength={200} placeholder="vd Tầng 3 khối đế" />
          </Form.Item>
        </Flex>

        <Flex gap={12} wrap>
          <Form.Item
            name="openTime"
            label={isFree ? 'Giờ mở (hiển thị)' : 'Giờ mở cửa'}
            style={{ flex: 1, minWidth: 140 }}
            dependencies={['closeTime']}
            rules={openRules}
          >
            <TimePicker format="HH:mm" minuteStep={5} needConfirm={false} allowClear={isFree} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="closeTime"
            label={isFree ? 'Giờ đóng (hiển thị)' : 'Giờ đóng cửa'}
            style={{ flex: 1, minWidth: 140 }}
            dependencies={['openTime', 'slotDurationMinutes']}
            rules={closeRules}
          >
            <TimePicker format="HH:mm" minuteStep={5} needConfirm={false} allowClear={isFree} style={{ width: '100%' }} />
          </Form.Item>
          {mode === 'BOOKING' && (
            <Form.Item
              name="slotDurationMinutes"
              label="Thời lượng slot (phút)"
              style={{ flex: 1, minWidth: 140 }}
              rules={[{ required: true, message: 'Nhập thời lượng' }]}
            >
              <InputNumber min={15} max={720} step={15} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          )}
        </Flex>
        {!isFree && (
          <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
            Giờ mở cửa phải nằm trong giờ lễ tân {reception.open}–{reception.close}.
          </Typography.Paragraph>
        )}

        {mode === 'WALK_IN' && (
          <>
            <Flex gap={12} wrap>
              {money(
                'perVisitFeeAdult',
                'Vé lẻ người lớn (đ / lượt)',
                `Từ ${ages.childAdultAge} tuổi. Nhập 0 nếu miễn phí.`,
                [{ required: true, message: 'Nhập giá vé người lớn (0 = miễn phí)' }],
              )}
              {money(
                'perVisitFeeChild',
                'Vé lẻ trẻ em (đ / lượt)',
                `Từ ${ages.childFreeAge} đến dưới ${ages.childAdultAge} tuổi. Trẻ dưới ${ages.childFreeAge} tuổi miễn phí.`,
                [{ required: true, message: 'Nhập giá vé trẻ em (0 = miễn phí)' }],
              )}
            </Flex>
            <Form.Item
              name="maxConcurrent"
              label="Số người tối đa cùng lúc"
              style={{ maxWidth: 240 }}
              extra="Để trống = không giới hạn"
            >
              <InputNumber min={1} max={10000} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </>
        )}

        {mode === 'BOOKING' && (
          <Flex gap={12} wrap>
            <Form.Item
              name="capacityPerSlot"
              label="Sức chứa / slot (căn hộ)"
              style={{ flex: 1, minWidth: 160 }}
              extra="Sân thường là 1 căn / slot"
              rules={[{ required: true, message: 'Nhập sức chứa' }]}
            >
              <InputNumber min={1} max={1000} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            {money('feePerBooking', 'Phí / lượt đặt (đ)', <FeeHint form={form} />, [{ required: true, message: 'Nhập phí (0 = miễn phí)' }])}
          </Flex>
        )}

        {!isFree && (
          <>
            <Flex gap={12} wrap>
              {money(
                'monthlyPassFeeAdult',
                'Gói tháng người lớn (đ)',
                'Để trống cả hai giá = không bán gói tháng',
                [passRule('monthlyPassFeeChild', 'giá gói trẻ em')],
                ['monthlyPassFeeChild'],
              )}
              {money('monthlyPassFeeChild', 'Gói tháng trẻ em (đ)', null, [passRule('monthlyPassFeeAdult', 'giá gói người lớn')], ['monthlyPassFeeAdult'])}
            </Flex>
          </>
        )}

        <Form.Item name="description" label="Mô tả">
          <Input.TextArea rows={2} maxLength={1000} showCount />
        </Form.Item>
        <Form.Item label="Ảnh" extra="jpg/png, tối đa 5MB">
          <Flex gap={12} align="center">
            {(image || amenity?.imageUrl) && (
              <Image
                src={image?.preview ?? amenity.imageUrl}
                width={72}
                height={72}
                style={{ objectFit: 'cover', borderRadius: 8 }}
              />
            )}
            <Upload accept="image/jpeg,image/png" maxCount={1} showUploadList={false} beforeUpload={beforeUpload}>
              <Button icon={<UploadOutlined />}>{image || amenity?.imageUrl ? 'Đổi ảnh' : 'Chọn ảnh'}</Button>
            </Upload>
          </Flex>
        </Form.Item>
      </Form>
    </Modal>
  );
}

// Ghi chú phí theo giá trị đang nhập
function FeeHint({ form }) {
  const fee = Form.useWatch('feePerBooking', form);
  return fee === 0 ? 'Miễn phí' : fee ? formatMoney(fee) : null;
}

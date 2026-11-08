import { Button, Checkbox, DatePicker, Divider, Flex, Form, Input, InputNumber, Modal, Select, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { assetApi } from '../../api/equipment.api';
import { ASSET_CATEGORIES, CYCLE_UNITS, enumOptions } from '../../constants/enums';
import { useAction } from '../../hooks/useApi';
import { cleanChecklist, isDuplicateLabel } from './assetFormat';

const toDay = (v) => (v ? dayjs(v) : null);
const toYmd = (v) => (v ? v.format('YYYY-MM-DD') : null);
const EMPTY_ITEM = { label: '', unit: '', minValue: null, maxValue: null, required: true };
const flex1 = { flex: '1 1 200px', minWidth: 0 };

/** Lỗi theo trường từ server (MSG-E01 trùng mã...) → báo đỏ đúng ô */
const markFieldErrors = (form) => (err) => {
  const fields = (err?.details ?? []).filter((d) => d.field).map((d) => ({
    name: d.field.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)),
    errors: [d.message],
  }));
  if (fields.length) form.setFields(fields);
};

// UC07 bước 2–4, 6: thêm / sửa thiết bị (Trưởng BQL)
export default function AssetFormModal({ asset, buildings, open, onClose, onDone }) {
  const [form] = Form.useForm();
  const [save, saving] = useAction(
    (v) => {
      const body = {
        ...v,
        code: v.code?.trim().toUpperCase(),
        installDate: toYmd(v.installDate),
        warrantyEnd: toYmd(v.warrantyEnd),
        lastMaintenanceDate: toYmd(v.lastMaintenanceDate),
        checklist: cleanChecklist(v.checklist),
      };
      return asset ? assetApi.update(asset._id, body) : assetApi.create(body);
    },
    {
      // MSG-E02 khi thêm mới (server trả "Đã lưu thiết bị. Bạn có thể in mã QR.")
      success: (res) => res.message ?? 'Đã lưu thiết bị',
      onDone: (res) => {
        onClose();
        onDone(res.data);
      },
    },
  );

  const initialValues = asset
    ? {
        ...asset,
        buildingId: asset.buildingId?._id ?? asset.buildingId,
        installDate: toDay(asset.installDate),
        warrantyEnd: toDay(asset.warrantyEnd),
        lastMaintenanceDate: toDay(asset.lastMaintenanceDate),
        cycleValue: asset.cycleValue ?? asset.maintenanceCycleDays,
        cycleUnit: asset.cycleUnit ?? (asset.maintenanceCycleDays ? 'DAY' : undefined),
        checklist: asset.checklist?.length ? asset.checklist : [EMPTY_ITEM],
      }
    : { category: 'ELEVATOR', cycleValue: 1, cycleUnit: 'MONTH', checklist: [EMPTY_ITEM] };

  return (
    <Modal
      title={asset ? `Sửa thiết bị ${asset.code ?? ''}` : 'Thêm thiết bị'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Lưu"
      cancelText="Hủy"
      confirmLoading={saving}
      destroyOnHidden
      width="min(760px, 94vw)"
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={initialValues}
        onFinish={(v) => save(v).catch(markFieldErrors(form))}
      >
        <Divider titlePlacement="start" plain>Thông tin thiết bị</Divider>
        <Flex gap={12} wrap>
          <Form.Item
            name="code"
            label="Mã thiết bị"
            style={flex1}
            extra="In trên nhãn QR. Chữ, số, gạch ngang."
            rules={[
              { required: true, message: 'Nhập mã thiết bị' },
              { pattern: /^[A-Za-z0-9][A-Za-z0-9-]{1,29}$/, message: '2–30 ký tự chữ, số hoặc dấu gạch ngang' },
            ]}
          >
            <Input maxLength={30} placeholder="vd TM-A01" style={{ textTransform: 'uppercase' }} />
          </Form.Item>
          <Form.Item name="name" label="Tên thiết bị" style={{ flex: '2 1 260px', minWidth: 0 }} rules={[{ required: true, min: 2, message: 'Nhập tên thiết bị' }]}>
            <Input maxLength={150} placeholder="vd Thang máy số 1" />
          </Form.Item>
        </Flex>
        <Flex gap={12} wrap>
          <Form.Item name="category" label="Loại" style={flex1} rules={[{ required: true }]}>
            <Select options={enumOptions(ASSET_CATEGORIES)} />
          </Form.Item>
          <Form.Item name="buildingId" label="Tòa nhà" style={flex1} rules={[{ required: true, message: 'Chọn tòa nhà' }]}>
            <Select options={buildings.map((b) => ({ value: b._id, label: b.name }))} placeholder="Chọn tòa" />
          </Form.Item>
          <Form.Item name="location" label="Vị trí" style={flex1}>
            <Input maxLength={200} placeholder="vd Sảnh chính" />
          </Form.Item>
        </Flex>
        <Flex gap={12} wrap>
          <Form.Item name="manufacturer" label="Hãng sản xuất" style={flex1}>
            <Input maxLength={150} />
          </Form.Item>
          <Form.Item name="installDate" label="Ngày lắp đặt" style={flex1}>
            <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="warrantyEnd"
            label="Hết bảo hành"
            style={flex1}
            dependencies={['installDate']}
            rules={[({ getFieldValue }) => ({
              validator: (_, v) => (!v || !getFieldValue('installDate') || !v.isBefore(getFieldValue('installDate'), 'day')
                ? Promise.resolve()
                : Promise.reject(new Error('Phải sau ngày lắp đặt'))),
            })]}
          >
            <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
          </Form.Item>
        </Flex>
        <Flex gap={12} wrap>
          <Form.Item name="vendorName" label="Nhà cung cấp / bảo trì" style={{ flex: '2 1 260px', minWidth: 0 }}>
            <Input maxLength={150} />
          </Form.Item>
          <Form.Item name="vendorPhone" label="Liên hệ nhà cung cấp" style={flex1} rules={[{ pattern: /^[0-9+().\s-]*$/, message: 'Số điện thoại không hợp lệ' }]}>
            <Input maxLength={30} />
          </Form.Item>
        </Flex>

        <Divider titlePlacement="start" plain>Chu kỳ bảo trì</Divider>
        <Flex gap={12} wrap>
          <Form.Item label="Chu kỳ" required style={flex1}>
            <Flex gap={8}>
              <Form.Item name="cycleValue" noStyle rules={[{ required: true, message: 'Nhập chu kỳ' }]}>
                <InputNumber min={1} max={3650} precision={0} style={{ width: 110 }} />
              </Form.Item>
              <Form.Item name="cycleUnit" noStyle rules={[{ required: true, message: 'Chọn đơn vị chu kỳ' }]}>
                <Select options={enumOptions(CYCLE_UNITS)} style={{ width: 110 }} />
              </Form.Item>
            </Flex>
          </Form.Item>
          <Form.Item name="lastMaintenanceDate" label="Ngày bảo trì gần nhất" style={flex1} extra="Để trống: tính từ hôm nay.">
            <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
          </Form.Item>
        </Flex>

        <Divider titlePlacement="start" plain>Mẫu checklist kiểm tra</Divider>
        <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
          Mục đo: nhập đơn vị và khoảng cho phép. Mục kiểm tra: để trống các ô đó. Sửa mẫu không ảnh hưởng phiếu bảo trì đã tạo.
        </Typography.Paragraph>
        <Form.List
          name="checklist"
          rules={[{ validator: (_, rows) => (cleanChecklist(rows).length ? Promise.resolve() : Promise.reject(new Error('Cần ít nhất 1 mục'))) }]}
        >
          {(rows, { add, remove }, { errors }) => (
            <Flex vertical gap={8}>
              {rows.map(({ key, name }) => (
                <Flex key={key} gap={8} wrap align="start" style={{ padding: 8, border: '1px solid var(--ant-color-border-secondary)', borderRadius: 8 }}>
                  <Form.Item
                    name={[name, 'label']}
                    style={{ flex: '3 1 220px', margin: 0, minWidth: 0 }}
                    dependencies={rows.filter((r) => r.name !== name).map((r) => ['checklist', r.name, 'label'])}
                    rules={[
                      { required: true, message: 'Nhập tên mục' },
                      ({ getFieldValue }) => ({
                        validator: (_, v) => (isDuplicateLabel(getFieldValue('checklist'), name, v)
                          ? Promise.reject(new Error('Trùng tên mục khác'))
                          : Promise.resolve()),
                      }),
                    ]}
                  >
                    <Input placeholder="Tên mục, vd Điện áp tủ điều khiển" maxLength={200} />
                  </Form.Item>
                  <Form.Item name={[name, 'unit']} style={{ flex: '0 1 90px', margin: 0 }}>
                    <Input placeholder="Đơn vị" maxLength={20} />
                  </Form.Item>
                  <Form.Item name={[name, 'minValue']} style={{ flex: '0 1 100px', margin: 0 }}>
                    <InputNumber placeholder="Từ" style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item
                    name={[name, 'maxValue']}
                    style={{ flex: '0 1 100px', margin: 0 }}
                    dependencies={[['checklist', name, 'minValue']]}
                    rules={[({ getFieldValue }) => ({
                      validator: (_, v) => {
                        const min = getFieldValue(['checklist', name, 'minValue']);
                        return v == null || min == null || v >= min ? Promise.resolve() : Promise.reject(new Error('≥ giá trị Từ'));
                      },
                    })]}
                  >
                    <InputNumber placeholder="Đến" style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name={[name, 'required']} valuePropName="checked" style={{ margin: 0, paddingTop: 5 }}>
                    <Checkbox>Bắt buộc</Checkbox>
                  </Form.Item>
                  <Button type="text" danger icon={<DeleteOutlined />} aria-label="Xóa mục" disabled={rows.length <= 1} onClick={() => remove(name)} />
                </Flex>
              ))}
              <Button type="dashed" icon={<PlusOutlined />} onClick={() => add(EMPTY_ITEM)} disabled={rows.length >= 50}>
                Thêm mục
              </Button>
              <Form.ErrorList errors={errors} />
            </Flex>
          )}
        </Form.List>

        <Form.Item name="note" label="Ghi chú" style={{ marginTop: 16 }}>
          <Input.TextArea rows={2} maxLength={1000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

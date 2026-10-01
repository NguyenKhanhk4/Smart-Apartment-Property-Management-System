import { useState } from 'react';
import {
  App,
  Button,
  Card,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import { complaintCategoryApi, systemConfigApi } from '../../api/moduleE.api';
import { useAction, useApi } from '../../hooks/useApi';
import EnumTag from '../../components/EnumTag';
import { PRIORITIES, enumOptions } from '../../constants/enums';
import { formatDateTime } from '../../utils/format';

function CategoryModal({ category, open, onClose, onDone }) {
  const [form] = Form.useForm();
  const [save, saving] = useAction(
    (v) => (category ? complaintCategoryApi.update(category._id, v) : complaintCategoryApi.create(v)),
    { onDone: () => (onClose(), onDone()) },
  );
  return (
    <Modal
      title={category ? 'Sửa loại phản ánh' : 'Thêm loại phản ánh'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={saving}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={category ?? { defaultPriority: 'MEDIUM', slaHours: 168, isActive: true }}
        onFinish={(v) => save(v).catch(() => {})}
      >
        <Form.Item name="name" label="Tên loại" rules={[{ required: true, message: 'Nhập tên loại' }]}>
          <Input maxLength={100} />
        </Form.Item>
        <Form.Item name="description" label="Mô tả">
          <Input.TextArea rows={2} maxLength={500} />
        </Form.Item>
        <Flex gap={12}>
          <Form.Item name="defaultPriority" label="Ưu tiên mặc định" style={{ flex: 1 }}>
            <Select options={enumOptions(PRIORITIES)} />
          </Form.Item>
          <Form.Item
            name="slaHours"
            label="SLA (giờ)"
            style={{ flex: 1 }}
            rules={[{ required: true, type: 'number', min: 1, message: 'SLA phải > 0' }]}
          >
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
        </Flex>
        {category && (
          <Form.Item name="isActive" label="Đang sử dụng" valuePropName="checked">
            <Switch />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

function ConfigValueEditor({ config, onSaved }) {
  const { message } = App.useApp();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(config.value);
  const isArray = Array.isArray(config.value);

  const save = async () => {
    try {
      const next = isArray
        ? String(value).split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n))
        : value;
      await systemConfigApi.update(config.key, next);
      message.success('Đã cập nhật tham số');
      setEditing(false);
      onSaved();
    } catch (e) {
      message.error(e.message);
    }
  };

  if (!editing) {
    return (
      <Flex align="center" gap={8}>
        <Typography.Text strong>{isArray ? config.value.join(', ') : String(config.value)}</Typography.Text>
        <Button size="small" type="text" icon={<EditOutlined />} onClick={() => setEditing(true)} />
      </Flex>
    );
  }
  return (
    <Flex gap={8}>
      {isArray ? (
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="vd 1, 7, 15" style={{ width: 160 }} />
      ) : (
        <InputNumber value={value} onChange={setValue} min={0} step={config.value < 1 ? 0.05 : 1} style={{ width: 160 }} />
      )}
      <Button size="small" type="primary" onClick={save}>
        Lưu
      </Button>
      <Button size="small" onClick={() => (setValue(config.value), setEditing(false))}>
        Hủy
      </Button>
    </Flex>
  );
}

// UC-E01 — Danh mục phản ánh & tham số nghiệp vụ (Manager). Mọi thay đổi ghi audit log ở backend.
export default function ComplaintSettingsPage() {
  const [editing, setEditing] = useState(undefined); // undefined = đóng, null = thêm mới
  const cats = useApi(() => complaintCategoryApi.list({ includeInactive: true }), []);
  const configs = useApi(() => systemConfigApi.list(), []);
  const [remove] = useAction((id) => complaintCategoryApi.remove(id), {
    success: (r) => (r.data.deleted ? 'Đã xóa' : 'Loại đã có phản ánh nên chỉ ẩn đi'),
    onDone: cats.reload,
  });

  return (
    <Flex vertical gap={16}>
      <Card
        title="Danh mục loại phản ánh"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing(null)}>
            Thêm loại
          </Button>
        }
      >
        <Table
          rowKey="_id"
          loading={cats.loading}
          dataSource={cats.data}
          pagination={false}
          scroll={{ x: 640 }}
          columns={[
            { title: 'Tên', dataIndex: 'name', render: (v, r) => <Flex vertical><b>{v}</b><Typography.Text type="secondary">{r.description}</Typography.Text></Flex> },
            { title: 'Ưu tiên mặc định', dataIndex: 'defaultPriority', width: 150, render: (v) => <EnumTag map={PRIORITIES} value={v} /> },
            { title: 'SLA', dataIndex: 'slaHours', width: 100, render: (v) => `${v} giờ` },
            { title: 'Trạng thái', dataIndex: 'isActive', width: 110, render: (v) => (v ? <Tag color="green">Đang dùng</Tag> : <Tag>Đã ẩn</Tag>) },
            {
              title: '',
              width: 140,
              render: (_, r) => (
                <Flex gap={4}>
                  <Button size="small" onClick={() => setEditing(r)}>Sửa</Button>
                  <Popconfirm title="Xóa loại phản ánh này?" onConfirm={() => remove(r._id).catch(() => {})}>
                    <Button size="small" danger>Xóa</Button>
                  </Popconfirm>
                </Flex>
              ),
            },
          ]}
        />
      </Card>

      <Card title="Tham số nghiệp vụ" extra={<Typography.Text type="secondary">Áp dụng ngay cho nghiệp vụ phát sinh sau khi lưu</Typography.Text>}>
        <Table
          rowKey="key"
          loading={configs.loading}
          dataSource={configs.data}
          pagination={false}
          scroll={{ x: 640 }}
          columns={[
            { title: 'Tham số', dataIndex: 'key', render: (v, r) => <Flex vertical><Typography.Text code>{v}</Typography.Text><Typography.Text type="secondary">{r.description}</Typography.Text></Flex> },
            { title: 'Giá trị', width: 280, render: (_, r) => <ConfigValueEditor key={`${r.key}-${r.updatedAt}`} config={r} onSaved={configs.reload} /> },
            { title: 'Cập nhật', dataIndex: 'updatedAt', width: 160, render: formatDateTime },
          ]}
        />
      </Card>

      {editing !== undefined && (
        <CategoryModal category={editing} open onClose={() => setEditing(undefined)} onDone={cats.reload} />
      )}
    </Flex>
  );
}

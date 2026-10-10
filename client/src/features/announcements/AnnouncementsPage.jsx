import { useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Button,
  Card,
  Checkbox,
  Empty,
  Flex,
  Form,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Select,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined, PushpinFilled } from '@ant-design/icons';
import { announcementApi, lookupApi } from '../../api/moduleE.api';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import EnumTag from '../../components/EnumTag';
import { ANNOUNCEMENT_SCOPES, enumOptions } from '../../constants/enums';
import { formatDateTime } from '../../utils/format';

function TargetSelect({ scope, ...props }) {
  const [q, setQ] = useState('');
  const isBuilding = scope === 'BUILDING';
  const { data = [], loading } = useApi(
    () => (isBuilding ? lookupApi.buildings() : lookupApi.apartments({ q })),
    [isBuilding, q],
  );
  return (
    <Select
      loading={loading}
      placeholder={isBuilding ? 'Chọn tòa' : 'Gõ mã căn hộ'}
      showSearch={isBuilding ? undefined : { filterOption: false, onSearch: setQ }}
      options={data.map((x) => ({
        value: x._id,
        label: isBuilding ? x.name : `${x.code} · ${x.buildingId?.name ?? ''}`,
      }))}
      {...props}
    />
  );
}

function PublishModal({ open, onClose, onDone }) {
  const [form] = Form.useForm();
  const scope = Form.useWatch('targetScope', form);
  const [publish, publishing] = useAction((v) => announcementApi.create(v), {
    success: (r) => `Đã đăng, gửi thông báo tới ${r.data.recipientCount} người`,
    onDone: () => (onClose(), onDone()),
  });
  return (
    <Modal
      title="Đăng bảng tin"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Đăng"
      confirmLoading={publishing}
      width={640}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{ targetScope: 'ALL', isPinned: false, sendEmail: false }}
        onFinish={(v) => publish(v).catch(() => {})}
      >
        <Form.Item name="title" label="Tiêu đề" rules={[{ required: true, min: 3, message: 'Nhập tiêu đề' }]}>
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item name="content" label="Nội dung" rules={[{ required: true, min: 3, message: 'Nhập nội dung' }]}>
          <Input.TextArea rows={6} maxLength={10000} showCount />
        </Form.Item>
        <Flex gap={12} wrap>
          <Form.Item name="targetScope" label="Phạm vi" style={{ width: 180 }}>
            <Select options={enumOptions(ANNOUNCEMENT_SCOPES)} onChange={() => form.setFieldValue('targetId', undefined)} />
          </Form.Item>
          {scope && scope !== 'ALL' && (
            <Form.Item
              name="targetId"
              label={scope === 'BUILDING' ? 'Tòa' : 'Căn hộ'}
              style={{ flex: 1, minWidth: 200 }}
              rules={[{ required: true, message: 'Chọn đối tượng nhận' }]}
            >
              <TargetSelect scope={scope} />
            </Form.Item>
          )}
        </Flex>
        <Flex gap={24}>
          <Form.Item name="isPinned" valuePropName="checked" noStyle>
            <Checkbox>Ghim lên đầu</Checkbox>
          </Form.Item>
          <Form.Item name="sendEmail" valuePropName="checked" noStyle>
            <Checkbox>Gửi kèm email (thông báo quan trọng)</Checkbox>
          </Form.Item>
        </Flex>
      </Form>
    </Modal>
  );
}

// UC-E09 — Bảng tin: Manager/Lễ tân đăng bài; mọi người xem bài thuộc phạm vi của mình
export default function AnnouncementsPage() {
  const { user, hasRole } = useAuth();
  const canPublish = hasRole('MANAGER', 'STAFF:RECEPTIONIST');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState();
  const [searchParams] = useSearchParams();
  const [open, setOpen] = useState(() => canPublish && searchParams.get('new') === '1'); // từ nút "Đăng bảng tin" ở trang chủ lễ tân
  const [expanded, setExpanded] = useState({});
  const { data = [], pagination, loading, reload } = useApi(
    () => announcementApi.list({ page, limit: 10, q }),
    [page, q],
  );
  const [togglePin] = useAction((a) => announcementApi.update(a._id, { isPinned: !a.isPinned }), { onDone: reload });
  const [remove] = useAction((id) => announcementApi.remove(id), { success: 'Đã xóa bài', onDone: reload });

  return (
    <Flex vertical gap={12}>
      <Flex justify="space-between" align="center" gap={8} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Bảng tin
        </Typography.Title>
        <Flex gap={8}>
          <Input.Search placeholder="Tìm tiêu đề" allowClear onSearch={(v) => (setQ(v || undefined), setPage(1))} style={{ width: 200 }} />
          {canPublish && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
              Đăng tin
            </Button>
          )}
        </Flex>
      </Flex>
      <Spin spinning={loading}>
        <Flex vertical gap={8}>
          {!loading && !data.length && <Empty description="Chưa có bài đăng" />}
          {data.map((a) => {
            const canEdit = hasRole('MANAGER') || a.createdBy?._id === user.id;
            return (
              <Card
                key={a._id}
                size="small"
                title={
                  <Flex align="center" gap={8}>
                    {a.isPinned && <PushpinFilled style={{ color: '#fa8c16' }} />}
                    <span style={{ whiteSpace: 'normal' }}>{a.title}</span>
                  </Flex>
                }
                extra={<EnumTag map={ANNOUNCEMENT_SCOPES} value={a.targetScope} />}
              >
                <Typography.Paragraph
                  style={{ whiteSpace: 'pre-wrap', marginBottom: 8 }}
                  ellipsis={expanded[a._id] ? false : { rows: 3, expandable: true, symbol: 'Xem thêm', onExpand: () => setExpanded((e) => ({ ...e, [a._id]: true })) }}
                >
                  {a.content}
                </Typography.Paragraph>
                <Flex justify="space-between" align="center" wrap gap={8}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {a.createdBy?.fullName} · {formatDateTime(a.createdAt)}
                    {canPublish && ` · ${a.recipientCount} người nhận`}
                    {a.sendEmail && canPublish && <Tag style={{ marginLeft: 8 }}>Email</Tag>}
                  </Typography.Text>
                  {canPublish && canEdit && (
                    <Flex gap={4}>
                      <Button size="small" type="text" onClick={() => togglePin(a).catch(() => {})}>
                        {a.isPinned ? 'Bỏ ghim' : 'Ghim'}
                      </Button>
                      <Popconfirm title="Xóa bài đăng này?" onConfirm={() => remove(a._id).catch(() => {})}>
                        <Button size="small" type="text" danger>
                          Xóa
                        </Button>
                      </Popconfirm>
                    </Flex>
                  )}
                </Flex>
              </Card>
            );
          })}
        </Flex>
      </Spin>
      {pagination?.total > pagination?.limit && (
        <Pagination align="center" current={page} pageSize={pagination.limit} total={pagination.total} onChange={setPage} />
      )}
      <PublishModal open={open} onClose={() => setOpen(false)} onDone={reload} />
    </Flex>
  );
}

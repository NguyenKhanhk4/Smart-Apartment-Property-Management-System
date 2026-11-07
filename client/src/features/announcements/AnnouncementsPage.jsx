// Module 8: bảng tin, tệp đính kèm, bình luận và khảo sát theo căn; tái dùng màn hình và modal có sẵn.
import { useContext, useState } from 'react';
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
  DatePicker, Upload, Radio, Progress, Alert,
} from 'antd';
import { PlusOutlined, PushpinFilled } from '@ant-design/icons';
import { announcementApi, lookupApi } from '../../api/moduleE.api';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import EnumTag from '../../components/EnumTag';
import { ANNOUNCEMENT_SCOPES, enumOptions } from '../../constants/enums';
import { formatDateTime } from '../../utils/format';
import { ResidentContext } from '../../layouts/resident/ResidentContext';
import { usePolling } from '../../hooks/usePolling';

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
  const isPoll = Form.useWatch('isPoll', form);
  const [files, setFiles] = useState([]);
  const [publish, publishing] = useAction((v) => {
    const body = new FormData();
    const { isPoll: survey, optionsText, audience, closesAt, ...fields } = v;
    Object.entries(fields).forEach(([key, value]) => { if (value !== undefined) body.append(key, String(value)); });
    if (survey) body.append('poll', JSON.stringify({ audience, closesAt: closesAt.toISOString(), options: optionsText.split('\n').map((s) => s.trim()).filter(Boolean) }));
    files.forEach((f) => body.append('attachments', f.originFileObj));
    return announcementApi.create(body);
  }, {
    success: (r) => `Đã đăng, gửi thông báo tới ${r.data.recipientCount} người`,
    onDone: () => (setFiles([]), onClose(), onDone()),
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
        initialValues={{ targetScope: 'ALL', isPinned: false, sendEmail: false, audience: 'OWNER' }}
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
          <Form.Item name="isPoll" valuePropName="checked" noStyle><Checkbox>Tạo khảo sát</Checkbox></Form.Item>
          <Form.Item name="isPinned" valuePropName="checked" noStyle>
            <Checkbox>Ghim lên đầu</Checkbox>
          </Form.Item>
          <Form.Item name="sendEmail" valuePropName="checked" noStyle>
            <Checkbox>Gửi kèm email (thông báo quan trọng)</Checkbox>
          </Form.Item>
        </Flex>
        {isPoll && <>
          <Alert type="info" title="Mỗi căn một phiếu. Chỉ người đã bỏ phiếu được sửa trước khi đóng. Kết quả mang tính tham khảo." />
          <Form.Item name="audience" label="Người được bỏ phiếu" rules={[{ required: true }]}><Select options={[{ value: 'OWNER', label: 'Chủ hộ' }, { value: 'ACTIVE_RESIDENT', label: 'Thành viên đang hoạt động' }]} /></Form.Item>
          <Form.Item name="optionsText" label="Phương án (mỗi dòng một phương án, từ 2–10)" rules={[{ required: true }]}><Input.TextArea rows={4} maxLength={2010} /></Form.Item>
          <Form.Item name="closesAt" label="Hạn đóng khảo sát" rules={[{ required: true }]}><DatePicker showTime format="DD/MM/YYYY HH:mm" /></Form.Item>
        </>}
        <Form.Item label="Đính kèm PDF/ảnh (tối đa 5 tệp)"><Upload accept=".pdf,.png,.jpg,.jpeg" beforeUpload={() => false} fileList={files} onChange={({ fileList }) => setFiles(fileList)} maxCount={5}><Button>Chọn tệp</Button></Upload></Form.Item>
      </Form>
    </Modal>
  );
}

// UC-E09 — Bảng tin: Manager/Lễ tân đăng bài; mọi người xem bài thuộc phạm vi của mình
export default function AnnouncementsPage() {
  const { user, hasRole } = useAuth();
  const canPublish = hasRole('MANAGER');
  const resident = useContext(ResidentContext);
  const apartmentId = resident?.apartmentId;
  const isResident = hasRole('RESIDENT');
  const [detail, setDetail] = useState(null);
  const [commentPage, setCommentPage] = useState(1);
  const [commentText, setCommentText] = useState('');
  const [choice, setChoice] = useState();
  const comments = useApi(() => announcementApi.comments(detail._id, { page: commentPage, limit: 10 }), [detail?._id, commentPage], { enabled: Boolean(detail) });
  const poll = useApi(() => announcementApi.poll(detail._id, apartmentId), [detail?._id, apartmentId], { enabled: Boolean(detail?.poll) && (!isResident || Boolean(apartmentId)) });
  usePolling(() => { if (detail?.poll && (!isResident || apartmentId)) poll.reload(); }, 10000);
  const [submitComment, commenting] = useAction(() => announcementApi.comment(detail._id, commentText), { success: 'Đã gửi bình luận', onDone: () => { setCommentText(''); comments.reload(); } });
  const [hide] = useAction((id) => announcementApi.hideComment(detail._id, id), { success: 'Đã ẩn bình luận', onDone: comments.reload });
  const [vote, voting] = useAction(() => announcementApi.vote(detail._id, { apartmentId, option: choice ?? poll.data?.myOption }), { success: 'Đã lưu phiếu', onDone: poll.reload });
  const [closePoll, closing] = useAction(() => announcementApi.closePoll(detail._id), { success: 'Đã đóng khảo sát', onDone: poll.reload });
  const [page, setPage] = useState(1);
  const [q, setQ] = useState();
  const [searchParams] = useSearchParams();
  const [open, setOpen] = useState(() => canPublish && searchParams.get('new') === '1'); // từ nút "Đăng bảng tin" ở trang chủ lễ tân
  const [expanded, setExpanded] = useState({});
  const { data = [], pagination, loading, reload } = useApi(
    () => announcementApi.list({ page, limit: 10, q, ...(isResident && apartmentId && { apartmentId }) }),
    [page, q, apartmentId, isResident],
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
                  <Button onClick={() => { setDetail(a); setCommentPage(1); setChoice(undefined); setCommentText(''); }}> {a.poll ? 'Tham gia / kết quả khảo sát' : 'Xem và bình luận'} </Button>
                  {a.attachments?.map((f) => <a key={f.url} href={f.url} target="_blank" rel="noopener noreferrer">{f.name}</a>)}
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
      <Modal open={Boolean(detail)} title={detail?.title} onCancel={() => setDetail(null)} footer={null} destroyOnHidden>
        <p style={{ whiteSpace: 'pre-wrap' }}>{detail?.content}</p>
        {detail?.poll && <>
          <Alert type="info" title="Khảo sát tham khảo, mỗi căn một phiếu; không thay thế biểu quyết tại hội nghị nhà chung cư." />
          {poll.error && <Alert type="error" title={poll.error.message} />}
          <p>{poll.data?.closed ? 'Đã đóng' : 'Đang mở'} · Hạn: {formatDateTime(detail.poll.closesAt)} · {poll.data?.total ?? 0} phiếu</p>
          {poll.data?.options?.map((o) => <div key={o.option}><span>{o.label}: {o.count} phiếu</span><Progress percent={o.percentage} /></div>)}
          {isResident && <><Radio.Group value={choice ?? poll.data?.myOption} onChange={(e) => setChoice(e.target.value)} disabled={poll.data?.closed || !poll.data?.canEdit} options={detail.poll.options.map((label, value) => ({ label, value }))} />
            <Button loading={voting} disabled={!apartmentId || !poll.data || poll.data.closed || !poll.data.canEdit || (choice ?? poll.data.myOption) === undefined} onClick={() => vote().catch(() => {})}>Lưu phiếu của căn</Button>
            {poll.data && !poll.data.canEdit && <p>{!poll.data.eligible ? 'Bạn không thuộc nhóm được bỏ phiếu của khảo sát này.' : 'Phiếu của căn do một thành viên khác gửi; chỉ người đó được sửa.'}</p>}</>}
          {canPublish && !poll.data?.closed && <Popconfirm title="Đóng khảo sát ngay?" onConfirm={() => closePoll().catch(() => {})}><Button loading={closing}>Đóng khảo sát</Button></Popconfirm>}
        </>}
        <Typography.Title level={5}>Bình luận</Typography.Title>
        {comments.error && <Alert type="error" title={comments.error.message} />}
        <Spin spinning={comments.loading}>{comments.data?.map((c) => <div key={c._id} style={{ marginBottom: 12 }}><strong>{c.createdBy?.fullName}</strong> · {formatDateTime(c.createdAt)}
          <p style={{ whiteSpace: 'pre-wrap' }}>{c.hidden ? 'Bình luận đã ẩn' : c.content}</p>
          {canPublish && !c.hidden && <Button danger onClick={() => hide(c._id).catch(() => {})}>Ẩn vi phạm</Button>}</div>)}</Spin>
        <Pagination current={commentPage} pageSize={10} total={comments.pagination?.total ?? 0} onChange={setCommentPage} hideOnSinglePage />
        {isResident && <><Input.TextArea value={commentText} onChange={(e) => setCommentText(e.target.value)} maxLength={2000} rows={3} placeholder="Viết bình luận" /><Button loading={commenting} disabled={!commentText.trim()} onClick={() => submitComment().catch(() => {})}>Gửi bình luận</Button></>}
      </Modal>
    </Flex>
  );
}

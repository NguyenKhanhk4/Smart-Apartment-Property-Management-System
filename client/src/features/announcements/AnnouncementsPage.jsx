// Module 8: bảng tin, tệp đính kèm, bình luận và khảo sát theo căn; tái dùng màn hình và modal có sẵn.
import { useContext, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Button,
  Checkbox,
  Empty,
  Flex,
  Form,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Select,
  Skeleton,
  Spin,
  Tag,
  DatePicker, Upload, Radio, Progress, Alert,
} from 'antd';
import {
  CommentOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  PaperClipOutlined,
  PlusOutlined,
  PushpinFilled,
  SearchOutlined,
} from '@ant-design/icons';
import { announcementApi, lookupApi } from '../../api/moduleE.api';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import EnumTag from '../../components/EnumTag';
import { ANNOUNCEMENT_SCOPES, enumOptions } from '../../constants/enums';
import { formatDateTime, fromNow } from '../../utils/format';
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
      width="min(640px, 94vw)"
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{ targetScope: 'ALL', isPinned: false, sendEmail: false, audience: 'OWNER' }}
        onFinish={(v) => publish(v).catch(() => {})}
        className="pt-2"
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
        <Flex gap={24} wrap className="mb-5">
          <Form.Item name="isPoll" valuePropName="checked" noStyle><Checkbox>Tạo khảo sát</Checkbox></Form.Item>
          <Form.Item name="isPinned" valuePropName="checked" noStyle>
            <Checkbox>Ghim lên đầu</Checkbox>
          </Form.Item>
          <Form.Item name="sendEmail" valuePropName="checked" noStyle>
            <Checkbox>Gửi kèm email (thông báo quan trọng)</Checkbox>
          </Form.Item>
        </Flex>
        {isPoll && <>
          <Alert className="mb-4" type="info" title="Mỗi căn một phiếu. Chỉ người đã bỏ phiếu được sửa trước khi đóng. Kết quả mang tính tham khảo." />
          <Form.Item name="audience" label="Người được bỏ phiếu" rules={[{ required: true }]}><Select options={[{ value: 'OWNER', label: 'Chủ hộ' }, { value: 'ACTIVE_RESIDENT', label: 'Thành viên đang hoạt động' }]} /></Form.Item>
          <Form.Item name="optionsText" label="Phương án (mỗi dòng một phương án, từ 2–10)" rules={[{ required: true }]}><Input.TextArea rows={4} maxLength={2010} /></Form.Item>
          <Form.Item name="closesAt" label="Hạn đóng khảo sát" rules={[{ required: true }]}><DatePicker showTime format="DD/MM/YYYY HH:mm" /></Form.Item>
        </>}
        <Form.Item label="Đính kèm PDF/ảnh (tối đa 5 tệp)"><Upload accept=".pdf,.png,.jpg,.jpeg" beforeUpload={() => false} fileList={files} onChange={({ fileList }) => setFiles(fileList)} maxCount={5}><Button>Chọn tệp</Button></Upload></Form.Item>
      </Form>
    </Modal>
  );
}

const initials = (name = '') => name.split(' ').filter(Boolean).slice(-2).map((w) => w[0]).join('').toUpperCase() || '?';
const fileIcon = (name = '') => (/\.pdf$/i.test(name) ? <FilePdfOutlined /> : <FileImageOutlined />);

/** Một bài trong danh sách: ghim / khảo sát, tiêu đề, 2 dòng trích, người đăng + thời gian + số tệp */
function PostItem({ post, active, onOpen, admin }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? 'true' : undefined}
      className={`w-full text-left cursor-pointer rounded-xl border px-4 py-3.5 transition-colors flex flex-col gap-1.5 ${
        active ? 'border-navy bg-navy-bg/60 ring-2 ring-navy/10' : 'border-line bg-white hover:border-line-strong hover:bg-surface-alt/50'
      } ${post.isPinned ? 'border-l-[3px] border-l-navy' : ''}`}
    >
      {(post.isPinned || post.poll || admin) && (
        <span className="flex flex-wrap items-center gap-1.5">
          {post.isPinned && (
            <Tag color="blue" className="m-0" icon={<PushpinFilled />}>
              Ghim
            </Tag>
          )}
          {post.poll && <Tag color="purple" className="m-0">Khảo sát</Tag>}
          {admin && <EnumTag map={ANNOUNCEMENT_SCOPES} value={post.targetScope} />}
        </span>
      )}
      <span className="text-[14.5px] font-semibold text-ink leading-snug line-clamp-2">{post.title}</span>
      <span className="text-[13px] text-ink-2 leading-relaxed line-clamp-2 whitespace-pre-line">{post.content}</span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3 mt-0.5">
        <span>
          {post.createdBy?.fullName ?? 'Ban quản lý'} · <span title={formatDateTime(post.createdAt)}>{fromNow(post.createdAt)}</span>
        </span>
        {post.attachments?.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <PaperClipOutlined /> {post.attachments.length} tệp
          </span>
        )}
        {admin && <span>{post.recipientCount} người nhận{post.sendEmail ? ' · có email' : ''}</span>}
      </span>
    </button>
  );
}

// UC-E09 / UC58–59 — Bảng tin: Trưởng BQL đăng bài, ghim, xóa, ẩn bình luận, đóng khảo sát; mọi người xem bài thuộc phạm vi
// của mình, bình luận, bỏ phiếu khảo sát (mỗi căn một phiếu). Máy tính (≥1200px): danh sách bên trái + chi tiết bên phải;
// màn hẹp: bấm bài mở chi tiết trong hộp thoại.
export default function AnnouncementsPage() {
  const { user, hasRole } = useAuth();
  const canPublish = hasRole('MANAGER');
  const resident = useContext(ResidentContext);
  const apartmentId = resident?.apartmentId;
  const isResident = hasRole('RESIDENT');
  const split = useMediaQuery('(min-width: 1200px)');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState();
  const { data = [], pagination, loading, reload } = useApi(
    () => announcementApi.list({ page, limit: 10, q, ...(isResident && apartmentId && { apartmentId }) }),
    [page, q, apartmentId, isResident],
  );
  // Bài đang mở. Máy tính: chưa chọn (hoặc bài đã chọn không còn trong trang) thì hiện bài đầu tiên ở khung bên phải
  const [picked, setDetail] = useState(null);
  const detail = split ? (data.find((a) => a._id === picked?._id) ? picked : (data[0] ?? null)) : picked;
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
  const [searchParams] = useSearchParams();
  const [open, setOpen] = useState(() => canPublish && searchParams.get('new') === '1'); // từ nút "Đăng bảng tin" ở trang chủ lễ tân
  const [togglePin] = useAction((a) => announcementApi.update(a._id, { isPinned: !a.isPinned }), { onDone: reload });
  const [remove] = useAction((id) => announcementApi.remove(id), { success: 'Đã xóa bài', onDone: () => { setDetail(null); reload(); } });

  const openPost = (a) => {
    setDetail(a);
    setCommentPage(1);
    setChoice(undefined);
    setCommentText('');
  };

  const canEdit = (a) => canPublish && (hasRole('MANAGER') || a.createdBy?._id === user.id);
  const myOption = choice ?? poll.data?.myOption;

  const detailBody = detail && (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        {(detail.isPinned || detail.poll || canPublish) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {detail.isPinned && <Tag color="blue" className="m-0" icon={<PushpinFilled />}>Ghim</Tag>}
            {detail.poll && <Tag color="purple" className="m-0">Khảo sát</Tag>}
            {canPublish && <EnumTag map={ANNOUNCEMENT_SCOPES} value={detail.targetScope} />}
          </div>
        )}
        <h2 className="m-0 text-lg font-semibold leading-snug text-ink pr-6">{detail.title}</h2>
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
          <span className="w-6 h-6 rounded-full bg-navy text-white text-[10px] font-semibold flex items-center justify-center">{initials(detail.createdBy?.fullName)}</span>
          <span>{detail.createdBy?.fullName ?? 'Ban quản lý'}</span>
          <span aria-hidden>·</span>
          <span>{formatDateTime(detail.createdAt)}</span>
          {canPublish && <span>· {detail.recipientCount} người nhận</span>}
        </div>
        {canEdit(detail) && (
          <div className="flex gap-2 mt-1">
            <Button size="small" icon={<PushpinFilled />} onClick={() => togglePin(detail).then(() => setDetail({ ...detail, isPinned: !detail.isPinned })).catch(() => {})}>
              {detail.isPinned ? 'Bỏ ghim' : 'Ghim lên đầu'}
            </Button>
            <Popconfirm title="Xóa bài đăng này?" okText="Xóa" cancelText="Hủy" onConfirm={() => remove(detail._id).catch(() => {})}>
              <Button size="small" danger>Xóa bài</Button>
            </Popconfirm>
          </div>
        )}
      </div>

      <div className="text-[14px] leading-[1.7] text-ink whitespace-pre-wrap">{detail.content}</div>

      {detail.attachments?.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-[13px] font-medium text-ink-2">Tệp đính kèm</div>
          <div className="flex flex-wrap gap-2">
            {detail.attachments.map((f) => (
              <a
                key={f.url}
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 max-w-full rounded-lg border border-line bg-surface-alt px-3 py-2 text-[13px] text-ink no-underline hover:border-navy"
              >
                <span className="text-navy">{fileIcon(f.name)}</span>
                <span className="truncate">{f.name}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {detail.poll && (
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-alt/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[14px] font-semibold text-ink">Khảo sát</div>
            <Tag color={poll.data?.closed ? 'default' : 'green'} className="m-0">{poll.data?.closed ? 'Đã đóng' : 'Đang mở'}</Tag>
          </div>
          <div className="text-[12.5px] text-ink-3">
            Hạn: {formatDateTime(detail.poll.closesAt)} · {poll.data?.total ?? 0} phiếu · Mỗi căn một phiếu, kết quả mang tính tham khảo, không thay thế biểu quyết tại hội nghị nhà chung cư.
          </div>
          {poll.error && <Alert type="error" title={poll.error.message} />}
          {poll.data?.options?.map((o) => (
            <div key={o.option} className="flex flex-col gap-1">
              <div className="flex justify-between gap-3 text-[13px] text-ink">
                <span>{o.label}</span>
                <span className="text-ink-3 whitespace-nowrap">{o.count} phiếu · {o.percentage}%</span>
              </div>
              <Progress percent={o.percentage} size="small" showInfo={false} />
            </div>
          ))}
          {isResident && (
            <div className="flex flex-col gap-3 pt-3 border-t border-line">
              <Radio.Group
                value={myOption}
                onChange={(e) => setChoice(e.target.value)}
                disabled={poll.data?.closed || !poll.data?.canEdit}
                className="flex flex-col gap-2"
                options={detail.poll.options.map((label, value) => ({ label, value }))}
              />
              {poll.data && !poll.data.canEdit && (
                <div className="text-[12.5px] text-ink-3">
                  {!poll.data.eligible ? 'Bạn không thuộc nhóm được bỏ phiếu của khảo sát này.' : 'Phiếu của căn do một thành viên khác gửi; chỉ người đó được sửa.'}
                </div>
              )}
              <div>
                <Button
                  type="primary"
                  loading={voting}
                  disabled={!apartmentId || !poll.data || poll.data.closed || !poll.data.canEdit || myOption === undefined}
                  onClick={() => vote().catch(() => {})}
                >
                  Lưu phiếu của căn
                </Button>
              </div>
            </div>
          )}
          {canPublish && !poll.data?.closed && (
            <div>
              <Popconfirm title="Đóng khảo sát ngay?" onConfirm={() => closePoll().catch(() => {})}>
                <Button loading={closing}>Đóng khảo sát</Button>
              </Popconfirm>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3 pt-5 border-t border-line">
        <div className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          <CommentOutlined /> Bình luận
          {comments.pagination?.total > 0 && <span className="font-normal text-ink-3">({comments.pagination.total})</span>}
        </div>
        {comments.error && <Alert type="error" title={comments.error.message} />}
        <Spin spinning={comments.loading}>
          {comments.data?.length ? (
            <div className="flex flex-col gap-3">
              {comments.data.map((c) => (
                <div key={c._id} className="flex gap-3">
                  <span className="w-8 h-8 shrink-0 rounded-full bg-surface-alt border border-line text-[11px] font-semibold text-ink-2 flex items-center justify-center">
                    {initials(c.createdBy?.fullName)}
                  </span>
                  <div className="flex-1 min-w-0 rounded-xl bg-surface-alt px-3.5 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold text-ink">{c.createdBy?.fullName}</span>
                      <span className="text-[11.5px] text-ink-3">{formatDateTime(c.createdAt)}</span>
                    </div>
                    <div className={`mt-1 text-[13.5px] leading-relaxed whitespace-pre-wrap ${c.hidden ? 'italic text-ink-3' : 'text-ink'}`}>
                      {c.hidden ? 'Bình luận đã bị ẩn' : c.content}
                    </div>
                    {canPublish && !c.hidden && (
                      <Button size="small" type="link" danger className="px-0! mt-1" onClick={() => hide(c._id).catch(() => {})}>
                        Ẩn vì vi phạm
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            !comments.loading && <div className="text-[13px] text-ink-3">Chưa có bình luận.</div>
          )}
        </Spin>
        <Pagination size="small" align="center" current={commentPage} pageSize={10} total={comments.pagination?.total ?? 0} onChange={setCommentPage} hideOnSinglePage />
        {isResident && (
          <div className="flex flex-col gap-2.5 rounded-xl border border-line-strong p-3 focus-within:border-navy transition-colors">
            <Input.TextArea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              maxLength={2000}
              autoSize={{ minRows: 2, maxRows: 6 }}
              variant="borderless"
              placeholder="Viết bình luận…"
              className="px-1!"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] text-ink-3">{commentText.length}/2000</span>
              <Button type="primary" loading={commenting} disabled={!commentText.trim()} onClick={() => submitComment().catch(() => {})}>
                Gửi bình luận
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 mb-5">
        <div>
          <h1 className="m-0 text-xl font-semibold leading-tight text-ink">Bảng tin</h1>
          <p className="mt-1 mb-0 text-[13px] text-ink-2">Thông báo, lịch cắt điện nước, họp cư dân và khảo sát của Ban quản lý.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            allowClear
            prefix={<SearchOutlined className="text-ink-3" />}
            placeholder="Tìm theo tiêu đề, nhấn Enter"
            onPressEnter={(e) => (setQ(e.target.value || undefined), setPage(1))}
            onChange={(e) => !e.target.value && q && (setQ(undefined), setPage(1))}
            className="w-[min(260px,100%)]"
          />
          {canPublish && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
              Đăng tin
            </Button>
          )}
        </div>
      </div>

      <div className={split ? 'grid grid-cols-[minmax(340px,420px)_minmax(0,1fr)] gap-5 items-start' : ''}>
        <div className="flex flex-col gap-2.5">
          {loading && !data.length && <Skeleton active paragraph={{ rows: 4 }} />}
          {!loading && !data.length && <Empty className="py-10" description={q ? 'Không có bài nào khớp từ khóa' : 'Chưa có bài đăng'} />}
          {data.map((a) => (
            <PostItem key={a._id} post={a} admin={canPublish} active={split && detail?._id === a._id} onOpen={() => openPost(a)} />
          ))}
          {pagination?.total > pagination?.limit && (
            <Pagination className="mt-2" align="center" current={page} pageSize={pagination.limit} total={pagination.total} onChange={setPage} />
          )}
        </div>

        {split && detail && (
          <section
            className="sticky top-[84px] rounded-2xl border border-line bg-white p-6 max-h-[calc(100vh-108px)] overflow-y-auto"
            aria-label="Chi tiết bài đăng"
          >
            {detailBody}
          </section>
        )}
      </div>

      <PublishModal open={open} onClose={() => setOpen(false)} onDone={reload} />
      {!split && (
        <Modal open={Boolean(picked)} title={null} onCancel={() => setDetail(null)} footer={null} width="min(680px, 94vw)" destroyOnHidden>
          <div className="pt-2">{detailBody}</div>
        </Modal>
      )}
    </div>
  );
}

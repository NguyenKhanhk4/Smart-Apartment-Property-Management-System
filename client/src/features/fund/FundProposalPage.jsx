import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import dayjs from 'dayjs';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Radio,
  Skeleton,
  Table,
  Tag,
  Typography,
} from 'antd';
import { fundApi } from '../../api/moduleB.api';
import EnumTag from '../../components/EnumTag';
import EvidencePhotos from '../../components/EvidencePhotos';
import EvidencePhotosField from '../../components/EvidencePhotosField';
import PageHeader from '../../components/PageHeader';
import ReasonModal from '../../components/ReasonModal';
import { BOARD_TITLES, FUND_PLAN_TYPES, FUND_PROPOSAL_STATUS, VOTE_DECISIONS, WORK_ORDER_STATUS } from '../../constants/enums';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { formatDate, formatDateTime, formatMoney, moneyInputProps } from '../../utils/format';
import { toFiles } from '../../utils/upload';

// Mô đun 4 — UC34: chi tiết đề xuất chi quỹ. Ban quản trị biểu quyết (1 phiếu, không sửa); đủ tỷ lệ thì tự chốt.
// Đã duyệt: (sửa chữa lớn) Trưởng BQL nghiệm thu → Kế toán lập phiếu chi kèm hóa đơn.
// Đề xuất gắn phiếu bảo trì (UC10): nghiệm thu trên phiếu bảo trì (có biên bản nhà thầu); đã duyệt thì không rút được.
export default function FundProposalPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { hasRole } = useAuth();
  const [modal, setModal] = useState(null);
  const { data: p, loading, reload } = useApi(() => fundApi.proposal(id), [id]);
  const [acceptWork, accepting] = useAction(() => fundApi.acceptWork(id), { onDone: reload });

  if (loading && !p) return <Skeleton active />;
  if (!p) return <Empty description="Không tìm thấy đề xuất" />;

  const { tally } = p;
  const isBoard = hasRole('BOARD');
  const isAccountant = hasRole('ACCOUNTANT');
  const isManager = hasRole('MANAGER');
  const pending = p.status === 'PENDING';
  const approved = p.status === 'APPROVED';
  const canVote = isBoard && pending && !p.myVote;
  const wo = p.workOrderId; // phiếu bảo trì gắn kèm (đã populate) hoặc null
  const canAccept = isManager && approved && p.largeRepair && !p.workAcceptedAt && !wo;
  const canPay = isAccountant && approved && (!p.largeRepair || p.workAcceptedAt);
  const canCancel = isAccountant && (pending || (approved && !wo));

  return (
    <>
      <PageHeader
        title={p.title}
        subtitle={p.code}
        breadcrumb={[
          { label: 'Trang chủ', path: '/app/home' },
          { label: 'Quỹ bảo trì', path: '/app/fund' },
          { label: p.code ?? 'Đề xuất chi' },
        ]}
        extra={
          <Flex gap={8} wrap>
            {canVote && (
              <Button type="primary" onClick={() => setModal('vote')}>
                Biểu quyết
              </Button>
            )}
            {canAccept && (
              <Popconfirm title="Xác nhận đã nghiệm thu hạng mục sửa chữa?" onConfirm={() => acceptWork().catch(() => {})}>
                <Button type="primary" loading={accepting}>
                  Nghiệm thu
                </Button>
              </Popconfirm>
            )}
            {canPay && (
              <Button type="primary" onClick={() => setModal('expense')}>
                Lập phiếu chi
              </Button>
            )}
            {canCancel && (
              <Button danger onClick={() => setModal('cancel')}>
                Rút đề xuất
              </Button>
            )}
          </Flex>
        }
      />
      <Flex vertical gap={16}>
        {approved && p.largeRepair && !p.workAcceptedAt && (
          <Alert
            type="info"
            showIcon
            message={
              wo
                ? 'Phiếu bảo trì đang sửa. Nhà thầu sửa xong, Trưởng BQL nghiệm thu trên phiếu bảo trì rồi Kế toán mới lập phiếu chi.'
                : 'Sửa chữa lớn: chờ Trưởng BQL nghiệm thu rồi Kế toán mới lập phiếu chi.'
            }
          />
        )}
        {approved && p.amount > p.fundBalance && (
          <Alert type="warning" showIcon message={`Số dư quỹ hiện tại ${formatMoney(p.fundBalance)} không đủ chi ${formatMoney(p.amount)}`} />
        )}
        <Card>
          <Descriptions size="small" column={{ xs: 1, md: 2 }}>
            <Descriptions.Item label="Trạng thái">
              <EnumTag map={FUND_PROPOSAL_STATUS} value={p.status} />
            </Descriptions.Item>
            <Descriptions.Item label="Số tiền đề xuất">
              <b>{formatMoney(p.amount)}</b>
            </Descriptions.Item>
            <Descriptions.Item label="Loại">
              <EnumTag map={FUND_PLAN_TYPES} value={p.planType} />
              {p.largeRepair && <Tag color="volcano">Sửa chữa lớn</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label={p.planType === 'UNSCHEDULED' ? 'Lý do đột xuất' : 'Kế hoạch'}>
              {p.planType === 'UNSCHEDULED' ? p.urgentReason : (p.planRef ?? '—')}
            </Descriptions.Item>
            {wo && (
              <Descriptions.Item label="Phiếu bảo trì">
                <Flex gap={8} wrap align="center">
                  {isManager ? (
                    <Typography.Link onClick={() => navigate('/app/work-orders')}>
                      {wo.assetId ? `${wo.assetId.code} – ${wo.assetId.name}` : 'Thiết bị'}
                    </Typography.Link>
                  ) : (
                    <span>{wo.assetId ? `${wo.assetId.code} – ${wo.assetId.name}` : 'Thiết bị'}</span>
                  )}
                  <EnumTag map={WORK_ORDER_STATUS} value={wo.status} />
                </Flex>
              </Descriptions.Item>
            )}
            <Descriptions.Item label="Người lập">{p.proposedBy?.fullName}</Descriptions.Item>
            <Descriptions.Item label="Ngày lập">{formatDateTime(p.createdAt)}</Descriptions.Item>
            <Descriptions.Item label="Số dư quỹ hiện tại">{formatMoney(p.fundBalance)}</Descriptions.Item>
            {p.finalNote && <Descriptions.Item label="Kết quả biểu quyết">{p.finalNote}</Descriptions.Item>}
            {p.workAcceptedAt && (
              <Descriptions.Item label="Nghiệm thu">
                {p.workAcceptedBy?.fullName} · {formatDateTime(p.workAcceptedAt)}
              </Descriptions.Item>
            )}
            {p.cancelReason && <Descriptions.Item label="Lý do rút">{p.cancelReason}</Descriptions.Item>}
          </Descriptions>
          <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginTop: 12 }}>{p.description}</Typography.Paragraph>
          {p.attachmentUrls?.length > 0 && (
            <>
              <Typography.Text strong>Báo giá</Typography.Text>
              <div className="mt-2">
                <EvidencePhotos urls={p.attachmentUrls} />
              </div>
            </>
          )}
        </Card>

        <Card title="Biểu quyết của Ban quản trị">
          <Flex vertical gap={12}>
            <Flex gap={24} align="center" wrap>
              <Progress
                type="circle"
                size={88}
                percent={Math.round((tally.agree / Math.max(tally.needed, 1)) * 100)}
                format={() => `${tally.agree}/${tally.needed}`}
                status={p.status === 'REJECTED' ? 'exception' : undefined}
              />
              <Typography.Text>
                Cần ít nhất <b>{tally.needed}</b>/{tally.boardSize} thành viên đồng ý (trên {Math.round(tally.ratio * 100)}%). Hiện có{' '}
                <b>{tally.agree}</b> đồng ý, <b>{tally.disagree}</b> không đồng ý.
                {pending && tally.notVoted.length > 0 && ` Chưa biểu quyết: ${tally.notVoted.map((m) => m.fullName).join(', ')}.`}
              </Typography.Text>
            </Flex>
            {p.myVote && (
              <Alert type="success" showIcon message={`Bạn đã biểu quyết: ${VOTE_DECISIONS[p.myVote.decision].label}`} />
            )}
            <Table
              rowKey={(v) => v.memberId?._id ?? v.votedAt}
              size="small"
              pagination={false}
              dataSource={p.votes}
              locale={{ emptyText: 'Chưa có phiếu nào' }}
              columns={[
                {
                  title: 'Thành viên',
                  render: (_, v) => (
                    <>
                      {v.memberId?.fullName} {v.memberId?.boardTitle && <Tag>{BOARD_TITLES[v.memberId.boardTitle]?.label}</Tag>}
                    </>
                  ),
                },
                { title: 'Quyết định', dataIndex: 'decision', width: 140, render: (d) => <EnumTag map={VOTE_DECISIONS} value={d} /> },
                { title: 'Ý kiến', dataIndex: 'comment', render: (c) => c ?? '—' },
                { title: 'Thời điểm', dataIndex: 'votedAt', width: 150, render: formatDateTime },
              ]}
            />
          </Flex>
        </Card>

        {p.expenseTxId && (
          <Card title="Phiếu chi">
            <Descriptions size="small" column={{ xs: 1, md: 2 }}>
              <Descriptions.Item label="Số phiếu">
                <Typography.Text code>{p.expenseTxId.code}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="Số tiền chi">{formatMoney(p.expenseTxId.amount)}</Descriptions.Item>
              <Descriptions.Item label="Ngày chi">{formatDate(p.expenseTxId.occurredAt)}</Descriptions.Item>
              <Descriptions.Item label="Số hóa đơn / chứng từ">{p.expenseTxId.documentNo ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Diễn giải">{p.expenseTxId.description}</Descriptions.Item>
            </Descriptions>
            <EvidencePhotos urls={p.expenseTxId.attachmentUrls} />
          </Card>
        )}
      </Flex>

      <VoteModal open={modal === 'vote'} id={id} onClose={() => setModal(null)} onDone={reload} />
      <ExpenseModal open={modal === 'expense'} proposal={p} onClose={() => setModal(null)} onDone={reload} />
      <ReasonModal
        open={modal === 'cancel'}
        title={`Rút đề xuất ${p.code ?? ''}`}
        okText="Rút đề xuất"
        minLength={5}
        action={(reason) => fundApi.cancel(id, reason)}
        onClose={() => setModal(null)}
        onDone={() => (setModal(null), reload())}
      />
    </>
  );
}

function VoteModal({ open, id, onClose, onDone }) {
  const [form] = Form.useForm();
  const decision = Form.useWatch('decision', form);
  const [run, loading] = useAction((v) => fundApi.vote(id, v), { onDone: async () => (onClose(), await onDone?.()) });
  return (
    <Modal open={open} title="Biểu quyết đề xuất chi quỹ" okText="Gửi biểu quyết" confirmLoading={loading} onCancel={onClose} onOk={() => form.submit()} destroyOnHidden>
      <Alert className="mb-3" type="info" showIcon message="Mỗi thành viên bỏ 1 phiếu, gửi rồi không sửa được." />
      <Form form={form} layout="vertical" preserve={false} initialValues={{ decision: 'AGREE' }} onFinish={(v) => run(v).catch(() => {})}>
        <Form.Item name="decision" label="Quyết định">
          <Radio.Group options={Object.entries(VOTE_DECISIONS).map(([value, m]) => ({ value, label: m.label }))} />
        </Form.Item>
        <Form.Item
          name="comment"
          label="Ý kiến"
          rules={[{ required: decision === 'DISAGREE', message: 'Không đồng ý thì ghi rõ ý kiến' }]}
        >
          <Input.TextArea rows={3} maxLength={1000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function ExpenseModal({ open, proposal, onClose, onDone }) {
  const [form] = Form.useForm();
  const [run, loading] = useAction(
    ({ images, occurredAt, ...v }) => fundApi.recordExpense(proposal._id, { ...v, occurredAt: occurredAt?.toISOString() }, toFiles(images)),
    { onDone: async () => (onClose(), await onDone?.()) },
  );
  return (
    <Modal open={open} title={`Lập phiếu chi — ${proposal.code ?? proposal.title}`} okText="Lập phiếu chi" confirmLoading={loading} onCancel={onClose} onOk={() => form.submit()} destroyOnHidden>
      <Form form={form} layout="vertical" preserve={false} initialValues={{ amount: proposal.amount }} onFinish={(v) => run(v).catch(() => {})}>
        <Form.Item
          name="amount"
          label="Số tiền chi thực tế"
          extra={`Không vượt số được duyệt ${formatMoney(proposal.amount)}; vượt thì lập đề xuất bổ sung.`}
          rules={[{ required: true, message: 'Nhập số tiền' }]}
        >
          <InputNumber {...moneyInputProps} min={1} max={proposal.amount} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="documentNo" label="Số hóa đơn / chứng từ" rules={[{ required: true, message: 'Nhập số hóa đơn' }]}>
          <Input maxLength={100} />
        </Form.Item>
        <Form.Item name="occurredAt" label="Ngày chi">
          <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d && d.isAfter(dayjs(), 'day')} />
        </Form.Item>
        <Form.Item name="description" label="Diễn giải">
          <Input.TextArea rows={2} maxLength={500} />
        </Form.Item>
        <EvidencePhotosField name="images" label="Ảnh hóa đơn, chứng từ" required={false} />
      </Form>
    </Modal>
  );
}

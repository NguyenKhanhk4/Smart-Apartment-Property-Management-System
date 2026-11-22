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
  Steps,
  Table,
  Tag,
  Timeline,
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

// Mô đun 4 — UC33/UC34: chi tiết đề xuất chi quỹ.
//   Trưởng BQL lập → Ban quản trị biểu quyết (1 phiếu, không sửa; đủ tỷ lệ và số dư khả dụng đủ thì tự chốt) → sửa chữa lớn: Trưởng BQL nghiệm thu kỹ thuật + Ban quản trị xác nhận
//   → Kế toán lập phiếu chi kèm hóa đơn. Đề xuất gắn phiếu bảo trì (UC10): nghiệm thu trên phiếu (biên bản nhà thầu, kiểm định).
// RETURNED / RESUBMITTED / VERIFIED: chỉ còn ở lịch sử đề xuất cũ (luồng trước có bước Kế toán xác nhận)
const HISTORY_LABEL = {
  SUBMITTED: 'Trưởng BQL gửi đề xuất',
  RETURNED: 'Kế toán trả lại',
  RESUBMITTED: 'Trưởng BQL sửa và gửi lại',
  VERIFIED: 'Kế toán xác nhận tài chính',
  APPROVAL_BLOCKED_BALANCE: 'Đủ phiếu nhưng số dư khả dụng không đủ',
  APPROVED: 'Ban quản trị duyệt',
  REJECTED: 'Ban quản trị không duyệt',
  CANCELLED: 'Rút đề xuất',
  WORK_ACCEPTED: 'Trưởng BQL nghiệm thu',
  BOARD_ACCEPTED: 'Ban quản trị xác nhận nghiệm thu',
  BOARD_RETURNED: 'Ban quản trị trả về nghiệm thu',
  PAID: 'Kế toán lập phiếu chi',
};
const HISTORY_COLOR = { RETURNED: 'orange', REJECTED: 'red', CANCELLED: 'gray', BOARD_RETURNED: 'red', APPROVAL_BLOCKED_BALANCE: 'orange', APPROVED: 'green', PAID: 'green', BOARD_ACCEPTED: 'green' };

/** Thanh tiến trình 4 bước: Đề xuất → Biểu quyết → Nghiệm thu / chờ chi → Đã chi */
function progressOf(p) {
  const { status } = p;
  const items = [
    { title: 'Đề xuất' },
    { title: 'Ban quản trị biểu quyết' },
    { title: p.largeRepair ? 'Nghiệm thu (BQL + Ban quản trị)' : 'Chờ chi' },
    { title: 'Đã chi' },
  ];
  if (status === 'PENDING') return { items, current: 1, status: 'process' };
  if (status === 'REJECTED') {
    items[1] = { title: 'Ban quản trị không duyệt' };
    return { items, current: 1, status: 'error' };
  }
  // Sửa chữa lớn: Ban quản trị đã xác nhận nghiệm thu → xong bước 3, đang chờ Kế toán chi
  if (status === 'APPROVED') return { items, current: p.largeRepair && p.boardAcceptedAt ? 3 : 2, status: 'process' };
  if (status === 'PAID') return { items, current: 3, status: 'finish' };
  // CANCELLED: Trưởng BQL rút — ghi rõ ở bước bị dừng (không để hiểu nhầm là Ban quản trị từ chối)
  const at = p.finalizedAt ? 2 : 1;
  items[at] = { title: 'Trưởng BQL đã rút đề xuất', description: p.cancelReason ?? undefined };
  return { items, current: at, status: 'error' };
}

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
  const wo = p.workOrderId; // phiếu bảo trì gắn kèm (đã populate) hoặc null
  const canVote = isBoard && pending && !p.myVote;
  const canAccept = isManager && approved && p.largeRepair && !p.workAcceptedAt && !wo;
  // BR-E09: Ban quản trị xác nhận nghiệm thu — phiếu gắn kèm đang chờ, hoặc đề xuất không gắn phiếu đã được Trưởng BQL nghiệm thu
  const boardAccepting = approved && p.largeRepair && !p.boardAcceptedAt
    && (wo ? wo.status === 'AWAITING_BOARD_ACCEPTANCE' : Boolean(p.workAcceptedAt));
  const canBoardAccept = isBoard && boardAccepting;
  const canPay = isAccountant && approved && (!p.largeRepair || (p.workAcceptedAt && p.boardAcceptedAt));
  const canCancel = isManager && (pending || (approved && !wo));
  const progress = progressOf(p);

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
            {canVote && <Button type="primary" onClick={() => setModal('vote')}>Biểu quyết</Button>}
            {canAccept && (
              <Popconfirm title="Xác nhận đã nghiệm thu hạng mục sửa chữa?" onConfirm={() => acceptWork().catch(() => {})}>
                <Button type="primary" loading={accepting}>Nghiệm thu</Button>
              </Popconfirm>
            )}
            {canBoardAccept && (
              <>
                <Button type="primary" onClick={() => setModal('boardAccept')}>Xác nhận nghiệm thu</Button>
                {wo && <Button danger onClick={() => setModal('boardReturn')}>Trả về</Button>}
              </>
            )}
            {canPay && <Button type="primary" onClick={() => setModal('expense')}>Lập phiếu chi</Button>}
            {canCancel && <Button danger onClick={() => setModal('cancel')}>Rút đề xuất</Button>}
          </Flex>
        }
      />
      <Flex vertical gap={16}>
        <Card size="small">
          <Steps size="small" current={progress.current} status={progress.status} items={progress.items} responsive />
        </Card>
        {pending && p.approvalBlockedAt && (
          <Alert
            type="warning"
            showIcon
            message="Đủ tỷ lệ đồng ý nhưng số dư khả dụng không đủ"
            description={`Số dư khả dụng hiện tại ${formatMoney(p.available)}, đề xuất ${formatMoney(p.amount)}. Hệ thống tự chốt duyệt khi số dư đủ (thu thêm quỹ, rút đề xuất khác).`}
          />
        )}
        {approved && p.largeRepair && !p.workAcceptedAt && (
          <Alert
            type="info"
            showIcon
            message={
              wo
                ? 'Phiếu bảo trì đang sửa. Nhà thầu sửa xong, Trưởng BQL nghiệm thu kỹ thuật trên phiếu, Ban quản trị xác nhận, rồi Kế toán mới lập phiếu chi.'
                : 'Sửa chữa lớn: chờ Trưởng BQL nghiệm thu và Ban quản trị xác nhận rồi Kế toán mới lập phiếu chi.'
            }
          />
        )}
        {wo?.status === 'AWAITING_BOARD_ACCEPTANCE' && pending && (
          // Sửa khẩn cấp: phiếu đã sửa xong và nghiệm thu kỹ thuật trước khi đề xuất được duyệt
          <Alert
            type="warning"
            showIcon
            message="Phiếu bảo trì đã sửa xong và được Trưởng BQL nghiệm thu kỹ thuật"
            description="Đây là sửa chữa khẩn cấp (sửa trước, hồ sơ sau). Đề xuất phải được Ban quản trị biểu quyết duyệt, sau đó Ban quản trị mới xác nhận nghiệm thu."
          />
        )}
        {boardAccepting && !isBoard && (
          <Alert type="info" showIcon message="Trưởng BQL đã nghiệm thu kỹ thuật, đang chờ Ban quản trị xác nhận nghiệm thu." />
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
              {wo?.repair?.isEmergency && <Tag color="red">Khẩn cấp</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label={p.planType === 'UNSCHEDULED' ? 'Lý do đột xuất' : 'Kế hoạch'}>
              {p.planType === 'UNSCHEDULED' ? p.urgentReason : (p.planRef ?? '—')}
            </Descriptions.Item>
            {wo && (
              <Descriptions.Item label="Phiếu bảo trì">
                <Flex gap={8} wrap align="center">
                  {isManager ? (
                    <Typography.Link onClick={() => navigate('/app/repair-approvals')}>
                      {wo.assetId ? `${wo.assetId.code} – ${wo.assetId.name}` : 'Thiết bị'}
                    </Typography.Link>
                  ) : (
                    <span>{wo.assetId ? `${wo.assetId.code} – ${wo.assetId.name}` : 'Thiết bị'}</span>
                  )}
                  <EnumTag map={WORK_ORDER_STATUS} value={wo.status} />
                </Flex>
              </Descriptions.Item>
            )}
            {p.contractNo && <Descriptions.Item label="Số hợp đồng / báo giá">{p.contractNo}</Descriptions.Item>}
            <Descriptions.Item label="Người lập">{p.proposedBy?.fullName}</Descriptions.Item>
            <Descriptions.Item label="Ngày lập">{formatDateTime(p.createdAt)}</Descriptions.Item>
            {p.verifiedAt && ( // dữ liệu cũ: luồng trước có bước Kế toán xác nhận
              <Descriptions.Item label="Kế toán xác nhận">
                {p.verifiedBy?.fullName} · {formatDateTime(p.verifiedAt)}
                {p.balanceAtVerify != null && <> · số dư khả dụng lúc đó {formatMoney(p.balanceAtVerify)}</>}
              </Descriptions.Item>
            )}
            {p.verifyNote && <Descriptions.Item label="Nhận xét của Kế toán">{p.verifyNote}</Descriptions.Item>}
            <Descriptions.Item label="Số dư quỹ / khả dụng">{formatMoney(p.fundBalance)} / {formatMoney(p.available)}</Descriptions.Item>
            {p.finalNote && <Descriptions.Item label="Kết quả biểu quyết">{p.finalNote}</Descriptions.Item>}
            {p.workAcceptedAt && (
              <Descriptions.Item label="Trưởng BQL nghiệm thu">
                {p.workAcceptedBy?.fullName} · {formatDateTime(p.workAcceptedAt)}
              </Descriptions.Item>
            )}
            {p.boardAcceptedAt && (
              <Descriptions.Item label="Ban quản trị xác nhận">
                {p.boardAcceptedBy?.fullName} · {formatDateTime(p.boardAcceptedAt)}
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

        {wo && (wo.repair?.acceptanceImages?.length > 0 || wo.repair?.inspectionCertUrls?.length > 0) && (
          <Card title="Biên bản nghiệm thu">
            <Descriptions size="small" column={1}>
              <Descriptions.Item label="Biên bản nhà thầu">
                {wo.repair.acceptanceImages?.length ? <EvidencePhotos urls={wo.repair.acceptanceImages} /> : '—'}
              </Descriptions.Item>
              {wo.repair.inspectionCertUrls?.length > 0 && (
                <Descriptions.Item label="Biên bản kiểm định"><EvidencePhotos urls={wo.repair.inspectionCertUrls} /></Descriptions.Item>
              )}
              {wo.repair.acceptanceNote && <Descriptions.Item label="Ghi chú">{wo.repair.acceptanceNote}</Descriptions.Item>}
            </Descriptions>
          </Card>
        )}

        {['PENDING', 'APPROVED', 'REJECTED', 'PAID'].includes(p.status) && (
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
              {p.myVote && <Alert type="success" showIcon message={`Bạn đã biểu quyết: ${VOTE_DECISIONS[p.myVote.decision].label}`} />}
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
        )}

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
              {p.expenseTxId.varianceReason && <Descriptions.Item label="Lý do chênh lệch">{p.expenseTxId.varianceReason}</Descriptions.Item>}
            </Descriptions>
            <EvidencePhotos urls={p.expenseTxId.attachmentUrls} />
          </Card>
        )}

        {p.history?.length > 0 && (
          <Card title="Lịch sử xử lý">
            <Timeline
              items={p.history.map((h) => ({
                color: HISTORY_COLOR[h.action] ?? 'blue',
                content: (
                  <>
                    <Typography.Text strong>{HISTORY_LABEL[h.action] ?? h.action}</Typography.Text>
                    <Typography.Text type="secondary"> · {h.by?.fullName ? `${h.by.fullName} · ` : ''}{formatDateTime(h.at)}</Typography.Text>
                    {h.note && <div style={{ whiteSpace: 'pre-wrap' }}>{h.note}</div>}
                  </>
                ),
              }))}
            />
          </Card>
        )}
      </Flex>

      <VoteModal open={modal === 'vote'} id={id} onClose={() => setModal(null)} onDone={reload} />
      <BoardAcceptModal open={modal === 'boardAccept'} proposal={p} onClose={() => setModal(null)} onDone={reload} />
      <ReasonModal
        open={modal === 'boardReturn'}
        title="Trả về: chưa đồng ý nghiệm thu"
        okText="Trả về"
        minLength={5}
        action={(comment) => fundApi.boardReturn(id, comment)}
        onClose={() => setModal(null)}
        onDone={() => (setModal(null), reload())}
      />
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

/** BR-E09: Ban quản trị xác nhận nghiệm thu sau Trưởng BQL */
function BoardAcceptModal({ open, proposal, onClose, onDone }) {
  const [form] = Form.useForm();
  const [run, loading] = useAction((v) => fundApi.boardAccept(proposal._id, v.note?.trim() || null), { onDone: async () => (onClose(), await onDone?.()) });
  return (
    <Modal open={open} title="Xác nhận nghiệm thu" okText="Xác nhận nghiệm thu" confirmLoading={loading} onCancel={onClose} onOk={() => form.submit()} destroyOnHidden>
      <Alert
        className="mb-3"
        type="info"
        showIcon
        message={proposal.workOrderId
          ? 'Phiếu bảo trì hoàn thành, thiết bị hoạt động lại; Kế toán được lập phiếu chi.'
          : 'Kế toán được lập phiếu chi cho hạng mục này.'}
      />
      <Form form={form} layout="vertical" preserve={false} onFinish={(v) => run(v).catch(() => {})}>
        <Form.Item name="note" label="Ghi chú">
          <Input.TextArea rows={2} maxLength={1000} placeholder="Vd: đã xem biên bản kiểm định" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function ExpenseModal({ open, proposal, onClose, onDone }) {
  const [form] = Form.useForm();
  const amount = Form.useWatch('amount', form);
  const [run, loading] = useAction(
    ({ images, occurredAt, ...v }) => fundApi.recordExpense(proposal._id, { ...v, occurredAt: occurredAt?.toISOString() }, toFiles(images)),
    { onDone: async () => (onClose(), await onDone?.()) },
  );
  const lower = amount != null && amount < proposal.amount;
  return (
    <Modal open={open} title={`Lập phiếu chi — ${proposal.code ?? proposal.title}`} okText="Lập phiếu chi" confirmLoading={loading} onCancel={onClose} onOk={() => form.submit()} destroyOnHidden>
      <Form form={form} layout="vertical" preserve={false} initialValues={{ amount: proposal.amount }} onFinish={(v) => run(v).catch(() => {})}>
        <Form.Item
          name="amount"
          label="Số tiền chi thực tế"
          extra={`Không vượt số được duyệt ${formatMoney(proposal.amount)}; vượt thì lập đề xuất bổ sung.`}
          rules={[
            { required: true, message: 'Nhập số tiền' },
            // Không dùng max của InputNumber: nó tự hạ số về mức duyệt khi rời ô mà không báo → báo lỗi rõ thay vì sửa ngầm
            {
              validator: (_, v) => (v == null || v <= proposal.amount
                ? Promise.resolve()
                : Promise.reject(new Error(`Vượt số được duyệt ${formatMoney(proposal.amount)} (${formatMoney(v - proposal.amount)}). Phần vượt phải lập đề xuất bổ sung.`))),
            },
          ]}
        >
          <InputNumber {...moneyInputProps} min={1} style={{ width: '100%' }} />
        </Form.Item>
        {lower && (
          <Form.Item
            name="varianceReason"
            label={`Lý do chênh lệch (thấp hơn ${formatMoney(proposal.amount - amount)})`}
            rules={[{ required: true, whitespace: true, min: 5, message: 'Ghi lý do tối thiểu 5 ký tự' }]}
          >
            <Input.TextArea rows={2} maxLength={1000} placeholder="Vd: nhà thầu giảm giá, bớt hạng mục" />
          </Form.Item>
        )}
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

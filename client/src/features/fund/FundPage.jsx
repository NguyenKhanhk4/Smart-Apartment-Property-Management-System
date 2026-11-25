import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import dayjs from 'dayjs';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { workOrderApi } from '../../api/equipment.api';
import { fundApi } from '../../api/moduleB.api';
import { systemConfigApi } from '../../api/moduleE.api';
import ReasonModal from '../../components/ReasonModal';
import EnumTag from '../../components/EnumTag';
import EvidencePhotosField from '../../components/EvidencePhotosField';
import PageHeader from '../../components/PageHeader';
import { FUND_INCOME_SOURCES, FUND_PLAN_TYPES, FUND_PROPOSAL_STATUS, FUND_TX_TYPES } from '../../constants/enums';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { formatDate, formatMoney, moneyInputProps } from '../../utils/format';
import { toFiles } from '../../utils/upload';
import EvidencePhotos from '../../components/EvidencePhotos';
import { ExportButton } from '../reports/components';

// Mô đun 4 — Quỹ bảo trì 2% (UC33, UC34). Hệ thống chỉ theo dõi, quỹ thuộc Ban quản trị.
// Trưởng BQL: lập / sửa / rút đề xuất chi (kể cả từ phiếu bảo trì duyệt bằng Quỹ). Kế toán: thu quỹ, xác nhận / trả lại đề xuất,
// lập phiếu chi, ghi chi phí vận hành sửa chữa. Ban quản trị: biểu quyết, xác nhận nghiệm thu, xác nhận đổi tham số tài chính.
/** Đề xuất chờ Trưởng ban quản trị chọn nhà thầu (cùng quy tắc isAwaitingVendor ở server) */
const isAwaitingVendor = (p) => p.status === 'PENDING' && !p.vendor && !p.votes?.some((v) => v.decision === 'AGREE');
const enumOpts = (map) => Object.entries(map).map(([value, m]) => ({ value, label: m.label }));

export default function FundPage() {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const isAccountant = hasRole('ACCOUNTANT');
  const isManager = hasRole('MANAGER');
  const isBoard = hasRole('BOARD');
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(isBoard || isAccountant ? 'proposals' : 'transactions');
  const [modal, setModal] = useState(null);
  const [prefill, setPrefill] = useState(null); // UC10: dữ liệu điền sẵn từ phiếu bảo trì
  const [txType, setTxType] = useState();
  const [txPage, setTxPage] = useState(1);
  // Mặc định lọc việc của mình: Ban quản trị chờ biểu quyết, Kế toán chờ xác nhận
  const [status, setStatus] = useState(isBoard ? ['PENDING'] : []);
  const [expenseOf, setExpenseOf] = useState(null); // phiếu vận hành đang ghi chi
  const [rejecting, setRejecting] = useState(null); // tham số Ban quản trị từ chối
  const [pPage, setPPage] = useState(1);

  const overview = useApi(() => fundApi.overview(), []);
  const txParams = useMemo(() => ({ page: txPage, limit: 15, type: txType }), [txPage, txType]);
  const txs = useApi(() => fundApi.transactions(txParams), [txParams]);
  const pParams = useMemo(() => ({ page: pPage, limit: 15, status: status.length ? status.join(',') : undefined }), [pPage, status]);
  const proposals = useApi(() => fundApi.proposals(pParams), [pParams]);
  const awaiting = useApi(() => fundApi.awaitingWorkOrders(), [], { enabled: isAccountant || isManager });
  const expenses = useApi(() => workOrderApi.expenses(), [], { enabled: isAccountant });
  // Đề xuất đã duyệt, đủ nghiệm thu (sửa chữa lớn): Kế toán lập phiếu chi được ngay
  const readyToPay = useApi(() => fundApi.proposals({ readyToPay: true, limit: 50 }), [], { enabled: isAccountant });
  const acceptances = useApi(() => fundApi.acceptances(), [], { enabled: isBoard || isManager });
  const pendingConfigs = useApi(() => systemConfigApi.pending(), [], { enabled: isBoard || isManager });
  const o = overview.data;
  const reloadAll = () => Promise.all([overview.reload(), txs.reload(), proposals.reload()]);
  const openProposal = (data = null) => (setPrefill(data), setModal('proposal'));
  const [startFromWorkOrder, loadingPrefill] = useAction(async (id) => openProposal((await fundApi.workOrderPrefill(id)).data));
  const [approveConfig, approvingConfig] = useAction((key) => systemConfigApi.approve(key), { onDone: () => pendingConfigs.reload() });

  // Từ màn Duyệt sửa chữa: /app/fund?createFrom=<phiếu> → mở form đề xuất điền sẵn (Trưởng BQL)
  const createFrom = searchParams.get('createFrom');
  const opened = useRef(null);
  useEffect(() => {
    if (!createFrom || !isManager || opened.current === createFrom) return;
    opened.current = createFrom;
    startFromWorkOrder(createFrom).catch(() => {});
    setSearchParams({}, { replace: true });
  }, [createFrom, isManager, startFromWorkOrder, setSearchParams]);

  return (
    <>
      <PageHeader
        title="Quỹ bảo trì 2%"
        subtitle="Quỹ thuộc Ban quản trị, hệ thống ghi nhận thu chi có chứng từ. Chi quỹ phải được Ban quản trị biểu quyết đủ tỷ lệ."
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Quỹ bảo trì' }]}
        extra={
          <Flex gap={8} wrap>
            <ExportButton
              type="fund"
              label="Xuất sổ thu chi"
              roles={['ACCOUNTANT', 'MANAGER', 'BOARD']}
              params={{ from: dayjs().startOf('year').toISOString(), to: dayjs().toISOString() }}
            />
            {isAccountant && <Button onClick={() => setModal('income')}>Ghi nhận thu quỹ</Button>}
            {isManager && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => openProposal()}>
                Lập đề xuất chi
              </Button>
            )}
          </Flex>
        }
      />
      <Flex vertical gap={16}>
        {o?.lowBalance && (
          <Alert type="warning" showIcon message={`Số dư quỹ dưới ngưỡng cảnh báo ${formatMoney(o.lowBalanceThreshold)}`} />
        )}

        {awaiting.data?.length > 0 && (
          <Card
            title={`Sửa chữa thiết bị chờ lập đề xuất chi (${awaiting.data.length})`}
            extra={<Typography.Text type="secondary">Trưởng BQL đã chọn Quỹ bảo trì, chưa có đề xuất</Typography.Text>}
          >
            <Table
              rowKey="_id"
              size="small"
              pagination={false}
              scroll={{ x: 'max-content' }}
              dataSource={awaiting.data}
              columns={[
                {
                  title: 'Thiết bị',
                  render: (_, r) => (
                    <>
                      {r.assetId ? `${r.assetId.code} – ${r.assetId.name}` : r.title}
                      {r.repair?.isEmergency && <Tag color="red" style={{ marginLeft: 6 }}>Khẩn cấp</Tag>}
                    </>
                  ),
                },
                { title: 'Hư hỏng', render: (_, r) => r.repair?.faultDesc },
                { title: 'Chi phí dự kiến', width: 140, align: 'right', render: (_, r) => formatMoney(r.repair?.estimatedCost) },
                { title: 'Duyệt ngày', width: 110, render: (_, r) => formatDate(r.repair?.decidedAt) },
                ...(isManager
                  ? [
                      {
                        title: '',
                        width: 130,
                        render: (_, r) => (
                          <Button size="small" type="primary" loading={loadingPrefill} onClick={() => startFromWorkOrder(r._id).catch(() => {})}>
                            Lập đề xuất
                          </Button>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </Card>
        )}

        {isAccountant && readyToPay.data?.length > 0 && (
          <Card
            title={`Đề xuất chờ lập phiếu chi (${readyToPay.data.length})`}
            extra={<Typography.Text type="secondary">Đã duyệt; sửa chữa lớn đã được Trưởng BQL và Ban quản trị nghiệm thu</Typography.Text>}
          >
            <Table
              rowKey="_id"
              size="small"
              pagination={false}
              scroll={{ x: 'max-content' }}
              dataSource={readyToPay.data}
              onRow={(r) => ({ onClick: () => navigate(`/app/fund/proposals/${r._id}`), style: { cursor: 'pointer' } })}
              columns={[
                { title: 'Mã', dataIndex: 'code', width: 160, render: (v) => (v ? <Typography.Text code>{v}</Typography.Text> : 'Chưa có mã') },
                { title: 'Hạng mục', dataIndex: 'title' },
                { title: 'Số tiền duyệt', dataIndex: 'amount', width: 150, align: 'right', render: (v) => <b>{formatMoney(v)}</b> },
                { title: 'Duyệt ngày', dataIndex: 'finalizedAt', width: 110, render: formatDate },
                { title: '', width: 120, render: () => <Button size="small" type="primary">Lập phiếu chi</Button> },
              ]}
            />
          </Card>
        )}

        {isAccountant && expenses.data?.length > 0 && (
          <Card
            title={`Sửa chữa chi phí vận hành chờ ghi chi (${expenses.data.length})`}
            extra={<Typography.Text type="secondary">Ghi số tiền thực tế và hóa đơn</Typography.Text>}
          >
            <Table
              rowKey="_id"
              size="small"
              pagination={false}
              scroll={{ x: 'max-content' }}
              dataSource={expenses.data}
              columns={[
                { title: 'Thiết bị', render: (_, r) => (r.assetId ? `${r.assetId.code} – ${r.assetId.name}` : r.title) },
                { title: 'Dự kiến', width: 140, align: 'right', render: (_, r) => formatMoney(r.repair?.estimatedCost) },
                { title: 'Hoàn thành', width: 110, render: (_, r) => formatDate(r.completedAt) },
                { title: '', width: 110, render: (_, r) => <Button size="small" type="primary" onClick={() => setExpenseOf(r)}>Ghi chi</Button> },
              ]}
            />
          </Card>
        )}

        {(isBoard || isManager) && (acceptances.data?.workOrders?.length > 0 || acceptances.data?.proposals?.length > 0) && (
          <Card
            title={(() => {
              const ready = acceptances.data.readyCount ?? 0;
              const waiting = (acceptances.data.workOrders?.length ?? 0) + (acceptances.data.proposals?.length ?? 0) - ready;
              return `Chờ Ban quản trị xác nhận nghiệm thu (${ready})${waiting > 0 ? ` · ${waiting} chờ duyệt đề xuất` : ''}`;
            })()}
            extra={<Typography.Text type="secondary">Trưởng BQL đã nghiệm thu kỹ thuật</Typography.Text>}
          >
            <Table
              rowKey="_id"
              size="small"
              pagination={false}
              scroll={{ x: 'max-content' }}
              dataSource={[
                ...(acceptances.data.workOrders ?? []).map((w) => ({
                  _id: w._id,
                  item: w.assetId ? `${w.assetId.code} – ${w.assetId.name}` : w.title,
                  proposal: w.proposal,
                  acceptedAt: w.repair?.acceptedAt,
                  emergency: w.repair?.isEmergency,
                  ready: w.ready,
                })),
                ...(acceptances.data.proposals ?? []).map((p) => ({ _id: p._id, item: p.title, proposal: p, acceptedAt: p.workAcceptedAt, ready: true })),
              ]}
              columns={[
                { title: 'Hạng mục', render: (_, r) => <>{r.item}{r.emergency && <Tag color="red" style={{ marginLeft: 6 }}>Khẩn cấp</Tag>}</> },
                {
                  title: 'Đề xuất',
                  render: (_, r) => (
                    <Flex vertical gap={2}>
                      <span>{r.proposal ? `${r.proposal.code} · ${formatMoney(r.proposal.amount)}` : 'Chưa lập đề xuất chi quỹ'}</span>
                      {!r.ready && (
                        // Sửa khẩn cấp (sửa trước, hồ sơ sau): đề xuất phải qua Kế toán và biểu quyết rồi mới xác nhận nghiệm thu được
                        <Typography.Text type="warning" style={{ fontSize: 12 }}>
                          {r.proposal ? <>Đề xuất <EnumTag map={FUND_PROPOSAL_STATUS} value={r.proposal.status} />, chưa xác nhận được</> : 'Trưởng BQL cần lập đề xuất'}
                        </Typography.Text>
                      )}
                    </Flex>
                  ),
                },
                { title: 'Nghiệm thu kỹ thuật', width: 150, render: (_, r) => formatDate(r.acceptedAt) },
                {
                  title: '',
                  width: 110,
                  render: (_, r) => r.proposal && (
                    <Button size="small" type={isBoard && r.ready ? 'primary' : 'default'} onClick={() => navigate(`/app/fund/proposals/${r.proposal._id}`)}>
                      {isBoard && r.ready ? 'Xem, xác nhận' : 'Xem'}
                    </Button>
                  ),
                },
              ]}
            />
          </Card>
        )}

        {(isBoard || isManager) && pendingConfigs.data?.length > 0 && (
          <Card title="Thay đổi tham số tài chính chờ Ban quản trị xác nhận">
            <Table
              rowKey="key"
              size="small"
              pagination={false}
              scroll={{ x: 'max-content' }}
              dataSource={pendingConfigs.data}
              columns={[
                { title: 'Tham số', render: (_, c) => (c.description ? c.description.split(/[.(—]/)[0] : c.key) },
                { title: 'Đang dùng', width: 140, align: 'right', render: (_, c) => configValue(c.key, c.value) },
                { title: 'Đề nghị', width: 140, align: 'right', render: (_, c) => <b>{configValue(c.key, c.pendingValue)}</b> },
                { title: 'Người đề nghị', width: 170, render: (_, c) => <>{c.pendingBy?.fullName ?? 'Không rõ'} · {formatDate(c.pendingAt)}</> },
                ...(isBoard
                  ? [
                      {
                        title: '',
                        width: 170,
                        render: (_, c) => (
                          <Flex gap={6}>
                            <Popconfirm title="Xác nhận áp dụng giá trị mới?" onConfirm={() => approveConfig(c.key).catch(() => {})}>
                              <Button size="small" type="primary" loading={approvingConfig}>Xác nhận</Button>
                            </Popconfirm>
                            <Button size="small" danger onClick={() => setRejecting(c)}>Từ chối</Button>
                          </Flex>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </Card>
        )}

        <Card>
          <Tabs
            activeKey={tab}
            onChange={setTab}
            items={[
              {
                key: 'transactions',
                label: 'Sổ thu chi',
                children: (
                  <Flex vertical gap={12}>
                    <Select
                      allowClear
                      placeholder="Thu và chi"
                      style={{ width: 160 }}
                      value={txType}
                      onChange={(v) => (setTxType(v), setTxPage(1))}
                      options={enumOpts(FUND_TX_TYPES)}
                    />
                    <Table
                      rowKey="_id"
                      size="middle"
                      loading={txs.loading}
                      dataSource={txs.data ?? []}
                      scroll={{ x: 1100 }}
                      expandable={{
                        rowExpandable: (r) => r.attachmentUrls?.length > 0,
                        expandedRowRender: (r) => <EvidencePhotos urls={r.attachmentUrls} size={80} />,
                      }}
                      pagination={{ current: txPage, pageSize: 15, total: txs.pagination?.total ?? 0, onChange: setTxPage }}
                      columns={[
                        { title: 'Ngày', dataIndex: 'occurredAt', width: 110, render: formatDate },
                        { title: 'Số phiếu', dataIndex: 'code', width: 160, render: (v) => (v ? <Typography.Text code>{v}</Typography.Text> : 'Chưa có số') },
                        { title: 'Loại', dataIndex: 'type', width: 80, render: (v) => <EnumTag map={FUND_TX_TYPES} value={v} /> },
                        {
                          title: 'Nội dung',
                          render: (_, r) => (
                            <Flex vertical>
                              {/* Không có diễn giải: phiếu thu lấy nguồn thu làm dòng chính (trước đây hiện "— Lãi tiền gửi") */}
                              {r.description ? (
                                <span>{r.description}</span>
                              ) : !r.incomeSource && !r.proposalId && (
                                <Typography.Text type="secondary">Không có diễn giải</Typography.Text>
                              )}
                              {r.incomeSource && (
                                <Typography.Text type={r.description ? 'secondary' : undefined}>{FUND_INCOME_SOURCES[r.incomeSource]?.label}</Typography.Text>
                              )}
                              {r.proposalId && (
                                <Typography.Link onClick={() => navigate(`/app/fund/proposals/${r.proposalId._id}`)}>
                                  {r.proposalId.code ?? 'Đề xuất'} — {r.proposalId.title}
                                </Typography.Link>
                              )}
                            </Flex>
                          ),
                        },
                        { title: 'Chứng từ', dataIndex: 'documentNo', width: 140, render: (v) => v ?? 'Không có' },
                        {
                          title: 'Số tiền',
                          width: 150,
                          align: 'right',
                          render: (_, r) => (
                            <Typography.Text type={r.type === 'INCOME' ? 'success' : 'danger'}>
                              {r.type === 'INCOME' ? '+' : '−'}
                              {formatMoney(r.amount)}
                            </Typography.Text>
                          ),
                        },
                        { title: 'Số dư sau', dataIndex: 'balanceAfter', width: 150, align: 'right', render: formatMoney },
                        { title: 'Người ghi', width: 150, render: (_, r) => r.createdBy?.fullName ?? 'Hệ thống' },
                      ]}
                    />
                  </Flex>
                ),
              },
              {
                key: 'proposals',
                label: `Đề xuất chi${o?.pendingCount ? ` (${o.pendingCount} chờ duyệt)` : ''}`,
                children: (
                  <Flex vertical gap={12}>
                    <Select
                      mode="multiple"
                      allowClear
                      placeholder="Mọi trạng thái"
                      style={{ minWidth: 260 }}
                      value={status}
                      onChange={(v) => (setStatus(v), setPPage(1))}
                      options={enumOpts(FUND_PROPOSAL_STATUS)}
                    />
                    <Table
                      rowKey="_id"
                      size="middle"
                      loading={proposals.loading}
                      dataSource={proposals.data ?? []}
                      scroll={{ x: 1000 }}
                      onRow={(r) => ({ onClick: () => navigate(`/app/fund/proposals/${r._id}`), style: { cursor: 'pointer' } })}
                      pagination={{ current: pPage, pageSize: 15, total: proposals.pagination?.total ?? 0, onChange: setPPage }}
                      columns={[
                        { title: 'Mã', dataIndex: 'code', width: 160, render: (v) => (v ? <Typography.Text code>{v}</Typography.Text> : 'Chưa có mã') },
                        { title: 'Hạng mục', dataIndex: 'title' },
                        { title: 'Loại', dataIndex: 'planType', width: 180, render: (v) => <EnumTag map={FUND_PLAN_TYPES} value={v} /> },
                        { title: 'Số tiền', dataIndex: 'amount', width: 150, align: 'right', render: (v) => <b>{formatMoney(v)}</b> },
                        { title: 'Phiếu', width: 90, align: 'center', render: (_, r) => r.votes?.length ?? 0 },
                        { title: 'Lập ngày', dataIndex: 'createdAt', width: 110, render: formatDate },
                        { title: 'Trạng thái', dataIndex: 'status', width: 210, render: (v, r) => (isAwaitingVendor(r) ? <Tag color="gold">Chờ Trưởng ban chọn nhà thầu</Tag> : <EnumTag map={FUND_PROPOSAL_STATUS} value={v} />) },
                      ]}
                    />
                  </Flex>
                ),
              },
            ]}
          />
        </Card>
      </Flex>

      <IncomeModal open={modal === 'income'} onClose={() => setModal(null)} onDone={reloadAll} />
      {expenseOf && <OperatingExpenseModal workOrder={expenseOf} onClose={() => setExpenseOf(null)} onDone={expenses.reload} />}
      <ReasonModal
        open={Boolean(rejecting)}
        title="Từ chối thay đổi tham số"
        okText="Từ chối"
        minLength={5}
        action={(reason) => systemConfigApi.reject(rejecting.key, reason)}
        onClose={() => setRejecting(null)}
        onDone={() => (setRejecting(null), pendingConfigs.reload())}
      />
      <ProposalModal
        open={modal === 'proposal'}
        available={o?.available}
        prefill={prefill}
        onClose={() => setModal(null)}
        onDone={(res) => navigate(`/app/fund/proposals/${res.data._id}`)}
      />
    </>
  );
}

function IncomeModal({ open, onClose, onDone }) {
  const [form] = Form.useForm();
  const [run, loading] = useAction(
    ({ images, occurredAt, ...v }) => fundApi.recordIncome({ ...v, occurredAt: occurredAt?.toISOString() }, toFiles(images)),
    { onDone: async () => (onClose(), await onDone?.()) },
  );
  return (
    <Modal open={open} title="Ghi nhận thu quỹ" okText="Ghi nhận" confirmLoading={loading} onCancel={onClose} onOk={() => form.submit()} destroyOnHidden>
      <Form form={form} layout="vertical" preserve={false} initialValues={{ incomeSource: 'INTEREST' }} onFinish={(v) => run(v).catch(() => {})}>
        <Form.Item name="incomeSource" label="Nguồn thu" rules={[{ required: true }]}>
          <Radio.Group options={enumOpts(FUND_INCOME_SOURCES)} />
        </Form.Item>
        <Form.Item name="amount" label="Số tiền" rules={[{ required: true, message: 'Nhập số tiền' }]}>
          <InputNumber {...moneyInputProps} min={1} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="documentNo" label="Số chứng từ" rules={[{ required: true, message: 'Nhập số chứng từ (biên bản bàn giao, sao kê lãi...)' }]}>
          <Input maxLength={100} placeholder="Vd: BB-BG-001, SK-LAI-Q3" />
        </Form.Item>
        <Form.Item name="occurredAt" label="Ngày thu">
          <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d && d.isAfter(dayjs(), 'day')} />
        </Form.Item>
        <Form.Item name="description" label="Diễn giải">
          <Input.TextArea rows={2} maxLength={500} />
        </Form.Item>
        <EvidencePhotosField name="images" label="Ảnh chứng từ" required={false} />
      </Form>
    </Modal>
  );
}

const configValue = (key, v) => (key === 'FUND_APPROVAL_RATIO' ? `${Math.round(Number(v) * 100)}%` : key === 'REPAIR_FUND_THRESHOLD' ? formatMoney(v) : `${v} ngày`);

/** Kế toán ghi chi phí vận hành thực tế của sửa chữa đã xong (số tiền, số hóa đơn, ảnh hóa đơn) */
function OperatingExpenseModal({ workOrder, onClose, onDone }) {
  const [form] = Form.useForm();
  const [run, loading] = useAction(({ images, ...v }) => workOrderApi.recordExpense(workOrder._id, v, toFiles(images)), {
    onDone: async () => (onClose(), await onDone?.()),
  });
  const actual = Form.useWatch('actualCost', form);
  const estimated = workOrder.repair?.estimatedCost;
  const diff = actual != null && estimated != null ? actual - estimated : 0;
  return (
    <Modal open title={`Ghi chi phí vận hành — ${workOrder.assetId?.code ?? workOrder.title}`} okText="Ghi chi" confirmLoading={loading} onCancel={onClose} onOk={() => form.submit()} destroyOnHidden>
      <Alert className="mb-3" type="info" showIcon message={`Chi phí dự kiến khi duyệt: ${formatMoney(workOrder.repair?.estimatedCost)}`} />
      <Form form={form} layout="vertical" preserve={false} initialValues={{ actualCost: workOrder.repair?.estimatedCost }} onFinish={(v) => run(v).catch(() => {})}>
        <Form.Item name="actualCost" label="Số tiền thực tế" rules={[{ required: true, message: 'Nhập số tiền' }]}>
          <InputNumber {...moneyInputProps} min={1} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="invoiceNo" label="Số hóa đơn" rules={[{ required: true, whitespace: true, message: 'Nhập số hóa đơn' }]}>
          <Input maxLength={100} />
        </Form.Item>
        {/* Thực tế khác dự kiến → ghi chú thành lý do chênh lệch bắt buộc (server cũng chặn) */}
        <Form.Item
          name="note"
          label={diff ? `Lý do chênh lệch (${diff > 0 ? 'cao' : 'thấp'} hơn dự kiến ${formatMoney(Math.abs(diff))})` : 'Ghi chú'}
          rules={diff ? [{ required: true, whitespace: true, min: 5, message: 'Ghi lý do chênh lệch tối thiểu 5 ký tự' }] : []}
        >
          <Input.TextArea rows={2} maxLength={1000} placeholder={diff ? 'Vd: phát sinh thay thêm bạc đạn, nhà thầu giảm giá' : undefined} />
        </Form.Item>
        <EvidencePhotosField name="images" label="Ảnh hóa đơn" message="Tải lên ít nhất 1 ảnh hóa đơn" />
      </Form>
    </Modal>
  );
}

/**
 * Trưởng BQL lập đề xuất → chờ Trưởng ban quản trị chọn nhà thầu → Ban quản trị biểu quyết.
 * prefill (UC10): { workOrderId, title, description, amount, estimatedCost, attachmentUrls, isEmergency, planType?, urgentReason? }
 */
function ProposalModal({ open, available, prefill, onClose, onDone }) {
  const [form] = Form.useForm();
  const planType = Form.useWatch('planType', form);
  const [run, loading] = useAction(({ images, ...v }) => fundApi.createProposal(v, toFiles(images)), {
    onDone: async (res) => (onClose(), await onDone?.(res)),
  });
  const initialValues = prefill
    ? {
        planType: 'UNSCHEDULED', // hư hỏng phát hiện khi kiểm tra định kỳ — thường là bảo trì đột xuất
        urgentReason: prefill.urgentReason, // sửa khẩn cấp: lý do khẩn cấp
        largeRepair: true,
        workOrderId: prefill.workOrderId,
        title: prefill.title,
        description: prefill.description,
        amount: prefill.amount,
      }
    : { planType: 'ANNUAL_PLAN', largeRepair: false };
  return (
    <Modal
      open={open}
      title="Lập đề xuất chi quỹ"
      okText="Gửi Ban quản trị"
      width="min(640px, 94vw)"
      confirmLoading={loading}
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnHidden
    >
      {available != null && <Alert className="mb-3" type="info" showIcon message={`Còn có thể đề xuất chi tối đa ${formatMoney(available)}`} />}
      {prefill && (
        <Alert
          className="mb-3"
          type={prefill.isEmergency ? 'warning' : 'success'}
          showIcon
          message={prefill.isEmergency ? 'Hồ sơ cho sửa chữa khẩn cấp (đã sửa trước)' : 'Lập từ phiếu bảo trì đã chọn Quỹ bảo trì'}
          description={`Chi phí kỹ thuật viên dự kiến ${formatMoney(prefill.estimatedCost)}, Trưởng ban quản trị chọn nhà thầu và nhập giá báo. ${prefill.attachmentUrls?.length ? `${prefill.attachmentUrls.length} ảnh hư hỏng tự đính kèm. ` : ''}Ban quản trị biểu quyết; nghiệm thu làm trên phiếu bảo trì.`}
        />
      )}
      <Form form={form} layout="vertical" preserve={false} initialValues={initialValues} onFinish={(v) => run(v).catch(() => {})}>
        <Form.Item name="workOrderId" hidden>
          <Input />
        </Form.Item>
        <Form.Item name="title" label="Hạng mục" rules={[{ required: true, min: 3, message: 'Hạng mục tối thiểu 3 ký tự' }]}>
          <Input maxLength={200} placeholder="Vd: Thay cáp thang máy Block A" />
        </Form.Item>
        <Form.Item name="description" label="Mô tả, lý do cần chi" rules={[{ required: true, min: 3, message: 'Mô tả tối thiểu 3 ký tự' }]}>
          <Input.TextArea rows={3} maxLength={2000} />
        </Form.Item>
        <Form.Item name="amount" label="Chi phí dự kiến" extra="Số tiền cuối là giá báo của nhà thầu Trưởng ban quản trị chọn." rules={[{ required: true, message: 'Nhập số tiền' }]}>
          <InputNumber {...moneyInputProps} min={1} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="planType" label="Loại kế hoạch">
          <Radio.Group options={enumOpts(FUND_PLAN_TYPES)} disabled={Boolean(prefill?.isEmergency)} />
        </Form.Item>
        {planType === 'UNSCHEDULED' ? (
          <Form.Item name="urgentReason" label="Lý do bảo trì đột xuất" rules={[{ required: true, message: 'Bảo trì đột xuất phải ghi lý do' }]}>
            <Input.TextArea rows={2} maxLength={1000} />
          </Form.Item>
        ) : (
          <Form.Item name="planRef" label="Kế hoạch bảo trì năm đã được Hội nghị nhà chung cư thông qua" rules={[{ required: true, message: 'Ghi tên / số kế hoạch' }]}>
            <Input maxLength={200} placeholder="Vd: KH bảo trì 2026 — Nghị quyết Hội nghị 03/2026" />
          </Form.Item>
        )}
        <Form.Item name="largeRepair" valuePropName="checked" extra="Sửa chữa lớn (thiết bị, kết cấu): Kế toán chỉ lập phiếu chi sau khi Trưởng BQL nghiệm thu và Ban quản trị xác nhận.">
          <Checkbox disabled={Boolean(prefill)}>Sửa chữa lớn</Checkbox>
        </Form.Item>
        <EvidencePhotosField name="images" label="Ảnh hiện trạng, hồ sơ kèm theo" required={false} />
      </Form>
    </Modal>
  );
}

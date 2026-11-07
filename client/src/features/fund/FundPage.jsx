import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
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
  Radio,
  Select,
  Statistic,
  Table,
  Tabs,
  Typography,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { fundApi } from '../../api/moduleB.api';
import EnumTag from '../../components/EnumTag';
import EvidencePhotosField from '../../components/EvidencePhotosField';
import PageHeader from '../../components/PageHeader';
import { FUND_INCOME_SOURCES, FUND_PLAN_TYPES, FUND_PROPOSAL_STATUS, FUND_TX_TYPES } from '../../constants/enums';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { formatDate, formatMoney, moneyInputProps } from '../../utils/format';
import { toFiles } from '../../utils/upload';
import EvidencePhotos from '../../components/EvidencePhotos';

// Mô đun 4 — Quỹ bảo trì 2% (UC33, UC34). Hệ thống chỉ theo dõi, quỹ thuộc Ban quản trị.
// Kế toán: ghi nhận thu quỹ, lập đề xuất chi. Ban quản trị: biểu quyết ở trang chi tiết đề xuất. Trưởng BQL: theo dõi, nghiệm thu.
const enumOpts = (map) => Object.entries(map).map(([value, m]) => ({ value, label: m.label }));

export default function FundPage() {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const isAccountant = hasRole('ACCOUNTANT');
  const [tab, setTab] = useState(hasRole('BOARD') ? 'proposals' : 'transactions');
  const [modal, setModal] = useState(null);
  const [txType, setTxType] = useState();
  const [txPage, setTxPage] = useState(1);
  const [status, setStatus] = useState(hasRole('BOARD') ? ['PENDING'] : []);
  const [pPage, setPPage] = useState(1);

  const overview = useApi(() => fundApi.overview(), []);
  const txParams = useMemo(() => ({ page: txPage, limit: 15, type: txType }), [txPage, txType]);
  const txs = useApi(() => fundApi.transactions(txParams), [txParams]);
  const pParams = useMemo(() => ({ page: pPage, limit: 15, status: status.length ? status.join(',') : undefined }), [pPage, status]);
  const proposals = useApi(() => fundApi.proposals(pParams), [pParams]);
  const o = overview.data;
  const reloadAll = () => Promise.all([overview.reload(), txs.reload(), proposals.reload()]);

  return (
    <>
      <PageHeader
        title="Quỹ bảo trì 2%"
        subtitle="Quỹ thuộc Ban quản trị, hệ thống ghi nhận thu chi có chứng từ. Chi quỹ phải được Ban quản trị biểu quyết đủ tỷ lệ."
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Quỹ bảo trì' }]}
        extra={
          isAccountant && (
            <Flex gap={8} wrap>
              <Button onClick={() => setModal('income')}>Ghi nhận thu quỹ</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setModal('proposal')}>
                Lập đề xuất chi
              </Button>
            </Flex>
          )
        }
      />
      <Flex vertical gap={16}>
        <Card loading={overview.loading && !o}>
          {o && (
            <Flex vertical gap={12}>
              {o.lowBalance && (
                <Alert type="warning" showIcon message={`Số dư quỹ dưới ngưỡng cảnh báo ${formatMoney(o.lowBalanceThreshold)}`} />
              )}
              <Flex gap={32} wrap>
                <Statistic title="Số dư quỹ" value={formatMoney(o.balance)} />
                <Statistic title="Đã duyệt chưa chi" value={formatMoney(o.committed)} />
                <Statistic title="Còn có thể đề xuất chi" value={formatMoney(o.available)} />
                <Statistic title="Thu từ đầu năm" value={formatMoney(o.yearIncome)} valueStyle={{ color: '#389e0d' }} />
                <Statistic title="Chi từ đầu năm" value={formatMoney(o.yearExpense)} valueStyle={{ color: '#cf1322' }} />
                <Statistic title="Đề xuất chờ duyệt" value={o.pendingCount} />
              </Flex>
            </Flex>
          )}
        </Card>

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
                        { title: 'Số phiếu', dataIndex: 'code', width: 160, render: (v) => (v ? <Typography.Text code>{v}</Typography.Text> : '—') },
                        { title: 'Loại', dataIndex: 'type', width: 80, render: (v) => <EnumTag map={FUND_TX_TYPES} value={v} /> },
                        {
                          title: 'Nội dung',
                          render: (_, r) => (
                            <Flex vertical>
                              <span>{r.description ?? '—'}</span>
                              {r.incomeSource && <Typography.Text type="secondary">{FUND_INCOME_SOURCES[r.incomeSource]?.label}</Typography.Text>}
                              {r.proposalId && (
                                <Typography.Link onClick={() => navigate(`/app/fund/proposals/${r.proposalId._id}`)}>
                                  {r.proposalId.code ?? 'Đề xuất'} — {r.proposalId.title}
                                </Typography.Link>
                              )}
                            </Flex>
                          ),
                        },
                        { title: 'Chứng từ', dataIndex: 'documentNo', width: 140, render: (v) => v ?? '—' },
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
                        { title: 'Người ghi', width: 150, render: (_, r) => r.createdBy?.fullName ?? '—' },
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
                        { title: 'Mã', dataIndex: 'code', width: 160, render: (v) => (v ? <Typography.Text code>{v}</Typography.Text> : '—') },
                        { title: 'Hạng mục', dataIndex: 'title' },
                        { title: 'Loại', dataIndex: 'planType', width: 180, render: (v) => <EnumTag map={FUND_PLAN_TYPES} value={v} /> },
                        { title: 'Số tiền', dataIndex: 'amount', width: 150, align: 'right', render: (v) => <b>{formatMoney(v)}</b> },
                        { title: 'Phiếu', width: 90, align: 'center', render: (_, r) => r.votes?.length ?? 0 },
                        { title: 'Lập ngày', dataIndex: 'createdAt', width: 110, render: formatDate },
                        { title: 'Trạng thái', dataIndex: 'status', width: 190, render: (v) => <EnumTag map={FUND_PROPOSAL_STATUS} value={v} /> },
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
      <ProposalModal
        open={modal === 'proposal'}
        available={o?.available}
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

function ProposalModal({ open, available, onClose, onDone }) {
  const [form] = Form.useForm();
  const planType = Form.useWatch('planType', form);
  const [run, loading] = useAction(({ images, ...v }) => fundApi.createProposal(v, toFiles(images)), {
    onDone: async (res) => (onClose(), await onDone?.(res)),
  });
  return (
    <Modal open={open} title="Lập đề xuất chi quỹ" okText="Gửi Ban quản trị" width={640} confirmLoading={loading} onCancel={onClose} onOk={() => form.submit()} destroyOnHidden>
      {available != null && <Alert className="mb-3" type="info" showIcon message={`Còn có thể đề xuất chi tối đa ${formatMoney(available)}`} />}
      <Form form={form} layout="vertical" preserve={false} initialValues={{ planType: 'ANNUAL_PLAN', largeRepair: false }} onFinish={(v) => run(v).catch(() => {})}>
        <Form.Item name="title" label="Hạng mục" rules={[{ required: true, min: 3, message: 'Nhập hạng mục' }]}>
          <Input maxLength={200} placeholder="Vd: Thay cáp thang máy Block A" />
        </Form.Item>
        <Form.Item name="description" label="Mô tả, lý do cần chi" rules={[{ required: true, min: 3, message: 'Nhập mô tả' }]}>
          <Input.TextArea rows={3} maxLength={2000} />
        </Form.Item>
        <Form.Item name="amount" label="Số tiền đề xuất" rules={[{ required: true, message: 'Nhập số tiền' }]}>
          <InputNumber {...moneyInputProps} min={1} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="planType" label="Loại kế hoạch">
          <Radio.Group options={enumOpts(FUND_PLAN_TYPES)} />
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
        <Form.Item name="largeRepair" valuePropName="checked" extra="Sửa chữa lớn (thiết bị, kết cấu): Kế toán chỉ lập phiếu chi sau khi Trưởng BQL nghiệm thu.">
          <Checkbox>Sửa chữa lớn</Checkbox>
        </Form.Item>
        <EvidencePhotosField name="images" label="Ảnh báo giá" required={false} />
      </Form>
    </Modal>
  );
}

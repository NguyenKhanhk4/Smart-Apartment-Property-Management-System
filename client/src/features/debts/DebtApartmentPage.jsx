import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Alert, App, Button, Card, Descriptions, Empty, Flex, Skeleton, Statistic, Table, Tag, Timeline, Typography } from 'antd';
import { EditOutlined, FilePdfOutlined } from '@ant-design/icons';
import { debtApi } from '../../api/moduleB.api';
import { contractsApi } from '../../api/moduleA.api';
import EnumTag from '../../components/EnumTag';
import PageHeader from '../../components/PageHeader';
import { CONTACT_METHODS, DEBT_STATUS, INVOICE_STATUS, PREPAID_TX_TYPES } from '../../constants/enums';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { formatDate, formatDateTime, formatMoney } from '../../utils/format';
import { periodLabel } from '../invoices/invoiceShared';
import DebtActivityModal from './DebtActivityModal';
import { caseHint } from './debtShared';

// Mô đun 4 — UC31/UC23: sổ công nợ của 1 căn. Tách theo Người nộp phí (X1): nợ của Người nộp phí cũ vẫn ở đây.
// Trưởng BQL ghi kết quả xử lý nợ, ngày hẹn trả; tải PDF Thông báo nợ quá hạn.
export default function DebtApartmentPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { hasRole } = useAuth();
  const isAccountant = hasRole('ACCOUNTANT');
  const [recording, setRecording] = useState(null); // { caseId, payerName }
  const [downloading, setDownloading] = useState(null);
  const { data, loading, reload } = useApi(() => debtApi.apartment(id), [id]);
  const { data: transferReview, reload: reloadTransferReview } = useApi(
    () => contractsApi.transferDebtReview(id), [id],
  );
  const [acknowledgeTransfer, acknowledging] = useAction(
    () => contractsApi.acknowledgeTransferDebt(id, transferReview._id),
    { success: 'Đã ghi nhận công nợ đổi chủ', onDone: reloadTransferReview },
  );

  if (loading && !data) return <Skeleton active />;
  if (!data) return <Empty description="Không tải được sổ công nợ" />;

  const { apartment, debt, payers, cases, prepaidTransactions, reconcilePayments } = data;
  const apt = [apartment.buildingId?.code, apartment.code].filter(Boolean).join('-');
  const caseById = Object.fromEntries(cases.map((c) => [c._id, c]));

  const download = async (caseId) => {
    setDownloading(caseId);
    try {
      message.success(`Đã tải ${await debtApi.downloadNotice(caseId)}`);
    } catch (err) {
      message.error(err.message);
    } finally {
      setDownloading(null);
    }
  };

  const invoiceColumns = [
    { title: 'Kỳ', dataIndex: 'period', width: 90, render: periodLabel },
    { title: 'Mã thông báo', dataIndex: 'code', render: (v) => <Typography.Text code>{v}</Typography.Text> },
    { title: 'Hạn đóng', dataIndex: 'dueDate', width: 110, render: formatDate },
    { title: 'Phải trả', dataIndex: 'totalAmount', width: 130, align: 'right', render: formatMoney },
    { title: 'Đã trả', dataIndex: 'paidAmount', width: 130, align: 'right', render: formatMoney },
    {
      title: 'Còn nợ',
      dataIndex: 'outstanding',
      width: 130,
      align: 'right',
      render: (v, r) => (v > 0 ? <Typography.Text type={r.overdue ? 'danger' : undefined}>{formatMoney(v)}</Typography.Text> : '—'),
    },
    { title: 'Trạng thái', dataIndex: 'status', width: 170, render: (s) => <EnumTag map={INVOICE_STATUS} value={s} /> },
  ];

  return (
    <>
      <PageHeader
        title={`Công nợ căn ${apt}`}
        subtitle={apartment.buildingId?.name}
        breadcrumb={[
          { label: 'Trang chủ', path: '/app/home' },
          { label: 'Sổ công nợ', path: '/app/debts' },
          { label: apt },
        ]}
      />
      <Flex vertical gap={16}>
        {transferReview && (
          <Alert
            type={transferReview.transferDebtAcknowledgedAt ? 'success' : 'warning'}
            showIcon
            title={transferReview.transferDebtAcknowledgedAt
              ? 'Đã ghi nhận công nợ đổi chủ'
              : 'Chờ ghi nhận công nợ đổi chủ'}
            description={`Yêu cầu từ ${formatDateTime(transferReview.transferDebtRequestedAt)}`}
            action={isAccountant && !transferReview.transferDebtAcknowledgedAt && (
              <Button loading={acknowledging} onClick={() => acknowledgeTransfer().catch(() => {})}>
                Đã ghi nhận công nợ
              </Button>
            )}
          />
        )}
        <Card>
          <Flex gap={32} wrap>
            <Statistic title="Tổng nợ (đã trừ số dư)" value={formatMoney(debt.amount)} />
            <Statistic title="Trong đó quá hạn" value={formatMoney(debt.overdueAmount)} valueStyle={{ color: debt.overdueAmount ? '#cf1322' : undefined }} />
            <Statistic title="Số dư trả trước" value={formatMoney(debt.prepaidBalance)} />
            {debt.credit > 0 && <Statistic title="Số dư vượt nợ (cần hoàn khi chuyển nhượng)" value={formatMoney(debt.credit)} />}
          </Flex>
        </Card>

        {reconcilePayments.length > 0 && (
          <Alert
            type="warning"
            showIcon
            message={`${reconcilePayments.length} giao dịch payOS cần đối soát`}
            description={reconcilePayments.map((p) => `${p.orderCode ?? p.reference ?? p._id} · ${formatMoney(p.amount)} · ${formatDateTime(p.createdAt)}`).join('; ')}
            action={
              <Button size="small" onClick={() => navigate('/app/payments')}>
                Xem giao dịch
              </Button>
            }
          />
        )}

        {payers.length === 0 && (
          <Card>
            <Empty description="Căn chưa có thông báo phí đã phát hành" />
          </Card>
        )}
        {payers.map((p) => {
          const openCase = p.caseId ? caseById[p.caseId] : null;
          return (
            <Card
              key={p.payerId}
              title={
                <Flex gap={8} align="center" wrap>
                  <span>{p.fullName ?? 'Người nộp phí'}</span>
                  {p.isCurrentPayer ? <Tag color="blue">Người nộp phí hiện tại</Tag> : <Tag>Người nộp phí cũ</Tag>}
                  {openCase && <EnumTag map={DEBT_STATUS} value={openCase.status} />}
                </Flex>
              }
              extra={
                openCase && (
                  <Flex gap={8} wrap>
                    {isAccountant && (
                      <Button icon={<EditOutlined />} onClick={() => setRecording({ caseId: openCase._id, payerName: p.fullName })}>
                        Ghi kết quả xử lý
                      </Button>
                    )}
                    {p.outstanding > 0 && (
                      <Button icon={<FilePdfOutlined />} loading={downloading === openCase._id} onClick={() => download(openCase._id)}>
                        PDF thông báo nợ
                      </Button>
                    )}
                  </Flex>
                )
              }
            >
              <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }} className="mb-3">
                <Descriptions.Item label="Điện thoại">{p.phone ?? '—'}</Descriptions.Item>
                <Descriptions.Item label="Đã phát hành">{formatMoney(p.billed)}</Descriptions.Item>
                <Descriptions.Item label="Đã trả">{formatMoney(p.paid)}</Descriptions.Item>
                <Descriptions.Item label="Còn nợ">
                  <b>{formatMoney(p.outstanding)}</b>
                </Descriptions.Item>
                <Descriptions.Item label="Quá hạn">
                  <Typography.Text type={p.overdueAmount ? 'danger' : undefined}>{formatMoney(p.overdueAmount)}</Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="Số dư trả trước">{formatMoney(p.prepaidBalance)}</Descriptions.Item>
                {openCase && <Descriptions.Item label="Nhắc nợ">{caseHint(openCase)}</Descriptions.Item>}
              </Descriptions>
              <Table
                rowKey="_id"
                size="small"
                dataSource={p.invoices}
                columns={invoiceColumns}
                scroll={{ x: 850 }}
                pagination={p.invoices.length > 6 ? { pageSize: 6 } : false}
                onRow={(r) => ({ onClick: () => navigate(`/app/invoices/${r._id}`), style: { cursor: 'pointer' } })}
              />
            </Card>
          );
        })}

        <Card title="Lịch sử nhắc & xử lý nợ">
          {cases.length === 0 ? (
            <Empty description="Chưa có hồ sơ nợ quá hạn" />
          ) : (
            <Flex vertical gap={24}>
              {cases.map((c) => (
                <div key={c._id}>
                  <Flex gap={8} align="center" wrap className="mb-3">
                    <b>{c.payerId?.fullName}</b>
                    <EnumTag map={DEBT_STATUS} value={c.status} />
                    <Typography.Text type="secondary">
                      Mở {formatDate(c.openedAt)}
                      {c.resolvedAt && ` · trả hết ${formatDate(c.resolvedAt)}`}
                    </Typography.Text>
                  </Flex>
                  <Timeline items={timelineOf(c)} />
                </div>
              ))}
            </Flex>
          )}
        </Card>

        <Card title="Sổ số dư trả trước">
          <Table
            rowKey="_id"
            size="small"
            dataSource={prepaidTransactions}
            scroll={{ x: 800 }}
            pagination={prepaidTransactions.length > 10 ? { pageSize: 10 } : false}
            locale={{ emptyText: 'Chưa có giao dịch số dư' }}
            columns={[
              { title: 'Thời điểm', dataIndex: 'createdAt', width: 150, render: formatDateTime },
              { title: 'Người nộp phí', render: (_, t) => t.payerId?.fullName ?? '—' },
              { title: 'Loại', dataIndex: 'type', width: 200, render: (v) => <EnumTag map={PREPAID_TX_TYPES} value={v} /> },
              {
                title: 'Số tiền',
                dataIndex: 'amount',
                width: 130,
                align: 'right',
                render: (v, t) => `${t.type === 'DEPOSIT' ? '+' : '−'}${formatMoney(v)}`,
              },
              { title: 'Số dư sau', dataIndex: 'balanceAfter', width: 130, align: 'right', render: formatMoney },
              { title: 'Ghi chú', dataIndex: 'note', render: (v) => v ?? '—' },
            ]}
          />
        </Card>
      </Flex>

      <DebtActivityModal
        open={Boolean(recording)}
        caseId={recording?.caseId}
        payerName={recording?.payerName}
        onClose={() => setRecording(null)}
        onDone={reload}
      />
    </>
  );
}

/** Gộp các lần nhắc tự động và nhật ký xử lý của 1 hồ sơ, theo thời gian */
function timelineOf(c) {
  const events = [
    ...(c.reminders ?? []).map((r, i) => ({
      at: r.at,
      color: 'orange',
      children: (
        <>
          <b>Nhắc nợ tự động lần {i + 1}</b> (Web + Email) · nợ quá hạn {formatMoney(r.amount)}
          <br />
          <Typography.Text type="secondary">{formatDateTime(r.at)}</Typography.Text>
        </>
      ),
    })),
    ...(c.longOverdueAt
      ? [
          {
            at: c.longOverdueAt,
            color: 'red',
            children: (
              <>
                <b>Chuyển Nợ quá hạn dài</b>, đã báo Trưởng BQL
                <br />
                <Typography.Text type="secondary">{formatDateTime(c.longOverdueAt)}</Typography.Text>
              </>
            ),
          },
        ]
      : []),
    ...(c.activities ?? []).map((a) => ({
      at: a.at,
      color: a.by ? 'blue' : 'gray',
      children: (
        <>
          {a.by ? (
            <>
              <b>{a.by.fullName}</b> · <EnumTag map={CONTACT_METHODS} value={a.method} />
            </>
          ) : (
            <b>Hệ thống</b>
          )}
          {a.response && <div>Phản hồi: {a.response}</div>}
          {a.promisedDate && <div>Hẹn trả: {formatDate(a.promisedDate)}</div>}
          {a.measures && <div>Biện pháp: {a.measures}</div>}
          {a.note && <div>{a.note}</div>}
          <Typography.Text type="secondary">{formatDateTime(a.at)}</Typography.Text>
        </>
      ),
    })),
  ];
  return events.sort((x, y) => new Date(x.at) - new Date(y.at)).map(({ color, children }) => ({ color, children }));
}

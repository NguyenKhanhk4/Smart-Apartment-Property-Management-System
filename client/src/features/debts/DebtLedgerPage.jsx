import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Card, Checkbox, Flex, Input, Segmented, Select, Statistic, Table, Typography } from 'antd';
import { debtApi } from '../../api/moduleB.api';
import { lookupApi } from '../../api/moduleE.api';
import EnumTag from '../../components/EnumTag';
import PageHeader from '../../components/PageHeader';
import { LEDGER_STATUS } from '../../constants/enums';
import { useApi } from '../../hooks/useApi';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { formatMoney } from '../../utils/format';
import { periodLabel } from '../invoices/invoiceShared';
import { ExportButton } from '../reports/components';
import { caseHint } from './debtShared';

// Mô đun 4 — UC31 Sổ công nợ: mỗi dòng là 1 Người nộp phí tại 1 căn. Bấm dòng → sổ công nợ của căn.
// Tình trạng lấy từ ?status= để link trong thông báo (vd /app/debts?status=LONG_OVERDUE) mở đúng bộ lọc.
const TABS = ['ALL', 'LONG_OVERDUE', 'OVERDUE', 'PARTIALLY_PAID', 'UNPAID', 'PAID'];

export default function DebtLedgerPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const status = TABS.includes(search.get('status')) ? search.get('status') : 'ALL';
  const [buildingId, setBuildingId] = useState();
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 400);
  const [hasBalance, setHasBalance] = useState(false);
  const [sort, setSort] = useState('-outstanding');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data: buildings = [] } = useApi(() => lookupApi.buildings(), []);
  const params = useMemo(
    () => ({
      page,
      limit: pageSize,
      sort,
      buildingId,
      q: debouncedQ || undefined,
      status: status === 'ALL' ? undefined : status,
      hasBalance: hasBalance || undefined,
    }),
    [page, pageSize, sort, buildingId, debouncedQ, status, hasBalance],
  );
  const list = useApi(() => debtApi.ledger(params), [params]);
  const summary = list.raw?.summary;
  const countOf = (s) =>
    s === 'ALL' ? Object.values(summary?.byStatus ?? {}).reduce((a, b) => a + b, 0) : (summary?.byStatus?.[s] ?? 0);

  const setStatus = (s) => {
    const next = new URLSearchParams(search);
    if (s === 'ALL') next.delete('status');
    else next.set('status', s);
    setSearch(next, { replace: true });
    setPage(1);
  };
  const reset = (fn) => (v) => (fn(v), setPage(1));

  const columns = [
    {
      title: 'Căn hộ',
      width: 100,
      render: (_, r) => <b>{[r.buildingCode, r.apartmentCode].filter(Boolean).join('-')}</b>,
    },
    {
      title: 'Người nộp phí',
      render: (_, r) => (
        <Flex vertical>
          <span>{r.payerName ?? '—'}</span>
          {r.payerPhone && <Typography.Text type="secondary">{r.payerPhone}</Typography.Text>}
        </Flex>
      ),
    },
    { title: 'Kỳ gần nhất', dataIndex: 'lastPeriod', width: 110, render: periodLabel },
    { title: 'Đã phát hành', dataIndex: 'billed', width: 140, align: 'right', render: formatMoney },
    { title: 'Đã trả', dataIndex: 'paid', width: 140, align: 'right', render: formatMoney },
    {
      title: 'Còn nợ',
      dataIndex: 'outstanding',
      width: 140,
      align: 'right',
      render: (v) => (v > 0 ? <b>{formatMoney(v)}</b> : '—'),
    },
    {
      title: 'Quá hạn',
      dataIndex: 'overdueAmount',
      width: 140,
      align: 'right',
      render: (v) => (v > 0 ? <Typography.Text type="danger">{formatMoney(v)}</Typography.Text> : '—'),
    },
    {
      title: 'Số dư trả trước',
      dataIndex: 'prepaidBalance',
      width: 140,
      align: 'right',
      render: (v) => (v > 0 ? <Typography.Text type="success">{formatMoney(v)}</Typography.Text> : '—'),
    },
    {
      title: 'Tình trạng',
      width: 210,
      render: (_, r) => (
        <Flex vertical gap={2}>
          <span>
            <EnumTag map={LEDGER_STATUS} value={r.ledgerStatus} />
          </span>
          {r.case && <Typography.Text type="secondary">{caseHint(r.case)}</Typography.Text>}
          {r.reconcileCount > 0 && <Typography.Text type="warning">{r.reconcileCount} giao dịch cần đối soát</Typography.Text>}
        </Flex>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Sổ công nợ"
        subtitle="Công nợ theo căn và Người nộp phí. Hệ thống tự nhắc nợ; nhắc đủ số lần mà chưa trả thì chuyển Nợ quá hạn dài để Trưởng BQL xử lý."
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Sổ công nợ' }]}
        extra={
          <ExportButton
            type="ledger"
            label="Xuất sổ công nợ"
            params={{ buildingId, status: status === 'ALL' ? undefined : status }}
          />
        }
      />
      <Card>
        <Flex vertical gap={12}>
          {summary && (
            <Flex gap={32} wrap>
              <Statistic title="Tổng còn nợ" value={formatMoney(summary.outstanding)} />
              <Statistic title="Trong đó quá hạn" value={formatMoney(summary.overdueAmount)} valueStyle={{ color: '#cf1322' }} />
              <Statistic title="Số dư trả trước" value={formatMoney(summary.prepaidBalance)} />
              <Statistic title="Nợ quá hạn dài" value={summary.byStatus?.LONG_OVERDUE ?? 0} suffix="dòng" />
              <Statistic title="Giao dịch cần đối soát" value={summary.reconcileCount ?? 0} />
            </Flex>
          )}
          <Segmented
            value={status}
            onChange={setStatus}
            options={TABS.map((s) => ({
              value: s,
              label: `${s === 'ALL' ? 'Tất cả' : LEDGER_STATUS[s].label} (${countOf(s)})`,
            }))}
            style={{ overflowX: 'auto', maxWidth: '100%' }}
          />
          <Flex gap={8} wrap align="center">
            <Select
              allowClear
              placeholder="Mọi tòa"
              style={{ width: 180 }}
              value={buildingId}
              onChange={reset(setBuildingId)}
              options={buildings.map((b) => ({ value: b._id, label: b.name ?? b.code }))}
            />
            <Input.Search
              allowClear
              placeholder="Mã căn"
              style={{ width: 180 }}
              value={q}
              onChange={(e) => (setQ(e.target.value), setPage(1))}
            />
            <Select
              style={{ width: 200 }}
              value={sort}
              onChange={reset(setSort)}
              options={[
                { value: '-outstanding', label: 'Còn nợ nhiều nhất' },
                { value: '-overdueAmount', label: 'Quá hạn nhiều nhất' },
                { value: 'apartmentCode', label: 'Theo mã căn' },
              ]}
            />
            <Checkbox checked={hasBalance} onChange={(e) => reset(setHasBalance)(e.target.checked)}>
              Có số dư trả trước
            </Checkbox>
          </Flex>
          <Table
            rowKey={(r) => `${r.apartmentId}:${r.payerId}`}
            size="middle"
            loading={list.loading}
            dataSource={list.data ?? []}
            columns={columns}
            scroll={{ x: 1250 }}
            onRow={(r) => ({ onClick: () => navigate(`/app/debts/apartments/${r.apartmentId}`), style: { cursor: 'pointer' } })}
            pagination={{
              current: page,
              pageSize,
              total: list.pagination?.total ?? 0,
              showSizeChanger: true,
              showTotal: (t) => `${t} dòng`,
              onChange: (p, s) => (setPage(p), setPageSize(s)),
            }}
          />
        </Flex>
      </Card>
    </>
  );
}

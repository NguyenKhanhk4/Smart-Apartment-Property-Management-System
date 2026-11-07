import { useMemo, useState } from 'react';
import { Alert, App, Button, Card, DatePicker, Descriptions, Drawer, Dropdown, Flex, Input, Select, Table, Tag, Typography } from 'antd';
import { DownloadOutlined, FileExcelOutlined, FilePdfOutlined, ReloadOutlined } from '@ant-design/icons';
import { auditLogApi } from '../../api/moduleC.api';
import PageHeader from '../../components/PageHeader';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { formatDateTime } from '../../utils/format';
import { fieldLabel, formatAuditValue, ipLabel, statusOf, targetText, visibleMetadata } from './auditFormat';

const NO_DATA = 'Không có dữ liệu cho bộ lọc đã chọn'; // MSG-D01

/** Một giá trị: trạng thái hiện thẻ màu như các trang khác, còn lại hiện chữ */
function AuditValue({ field, value, targetType, strong = false }) {
  const status = statusOf(field, value, targetType);
  if (status) return <Tag color={status.color}>{status.label}</Tag>;
  const text = formatAuditValue(field, value, targetType);
  return strong ? <Typography.Text strong>{text}</Typography.Text> : <Typography.Text type="secondary">{text}</Typography.Text>;
}

/** Bản ghi: mã dễ đọc (rê chuột thấy ID); không tra được mã thì ID rút gọn, copy được */
function TargetCell({ log }) {
  const text = targetText(log);
  if (text) return <span title={log.targetId ?? undefined}>{text}</span>;
  if (!log.targetId) return '—';
  return <Typography.Text copyable={{ text: log.targetId }} title={log.targetId}>{log.targetId.slice(0, 8)}…</Typography.Text>;
}

/** UC06 bước 4: bảng giá trị cũ / mới (BR-S10) */
function ChangesTable({ changes, targetType }) {
  if (!changes?.length) return <Typography.Text type="secondary">Hành động này không ghi giá trị cũ / mới.</Typography.Text>;
  return (
    <Table
      size="small"
      bordered
      pagination={false}
      rowKey={(c) => c.field}
      dataSource={changes}
      scroll={{ x: 480 }}
      columns={[
        { title: 'Trường', dataIndex: 'field', width: 160, render: fieldLabel },
        { title: 'Giá trị cũ', dataIndex: 'before', render: (v, c) => <AuditValue field={c.field} value={v} targetType={targetType} /> },
        { title: 'Giá trị mới', dataIndex: 'after', render: (v, c) => <AuditValue field={c.field} value={v} targetType={targetType} strong /> },
      ]}
    />
  );
}

/** Thông tin kèm theo khác (mã phiếu, lý do...) */
function AuditMetadata({ metadata, targetType }) {
  const items = visibleMetadata(metadata).map(([key, value]) => ({
    key,
    label: fieldLabel(key),
    children: <span style={{ overflowWrap: 'anywhere' }}><AuditValue field={key} value={value} targetType={targetType} strong /></span>,
  }));
  return items.length ? <Descriptions bordered size="small" column={1} items={items} /> : null;
}

/** UC06 bước 5 (UC65): xuất đúng bộ lọc đang xem (BR-D02), xong báo MSG-G06 */
function ExportButton({ params }) {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const download = async ({ key: format }) => {
    setLoading(true);
    try {
      const name = await auditLogApi.download({ ...params, format });
      message.success(`Đã xuất file ${name}`);
    } catch (e) {
      message.error(e.message || 'Xuất file thất bại, vui lòng thử lại');
    } finally {
      setLoading(false);
    }
  };
  return (
    <Dropdown
      menu={{
        items: [
          { key: 'xlsx', icon: <FileExcelOutlined style={{ color: '#217346' }} />, label: 'Excel (.xlsx)' },
          { key: 'pdf', icon: <FilePdfOutlined style={{ color: '#d4380d' }} />, label: 'PDF' },
        ],
        onClick: download,
      }}
    >
      <Button icon={<DownloadOutlined />} loading={loading}>Xuất file</Button>
    </Dropdown>
  );
}

export default function AuditLogsPage() {
  const { hasRole } = useAuth();
  const isBoard = hasRole('BOARD');
  const [filters, setFilters] = useState({});
  const [name, setName] = useState('');
  const q = useDebouncedValue(name, 350);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [selected, setSelected] = useState(null);
  const options = useApi(() => auditLogApi.options(), []);
  const exportParams = useMemo(() => ({ ...filters, q: q || undefined }), [filters, q]);
  const params = useMemo(() => ({ ...exportParams, page, limit }), [exportParams, page, limit]);
  const list = useApi(() => auditLogApi.list(params), [params]);
  const change = (key, value) => {
    setFilters((old) => ({ ...old, [key]: value || undefined }));
    setPage(1);
  };
  const title = isBoard ? 'Nhật ký hoạt động tài chính' : 'Nhật ký hoạt động';

  const columns = [
    { title: 'Thời điểm', dataIndex: 'createdAt', width: 165, render: formatDateTime },
    { title: 'Người thực hiện', width: 180, render: (_, r) => r.performedBy?.fullName ?? 'Hệ thống' },
    { title: 'Hành động', dataIndex: 'actionLabel', width: 240 },
    { title: 'Đối tượng', dataIndex: 'targetType', render: (v, r) => <Tag>{r.targetLabel ?? v ?? '—'}</Tag> },
    { title: 'Bản ghi', dataIndex: 'targetId', width: 220, render: (_, r) => <TargetCell log={r} /> },
    { title: '', width: 80, render: (_, r) => <Button type="link" onClick={() => setSelected(r)} aria-label={`Xem nhật ký ${r.actionLabel}`}>Xem</Button> },
  ];

  return (
    <Flex vertical gap={16}>
      <PageHeader title={title} subtitle="Lịch sử thao tác được lưu theo thời gian, chỉ dùng để tra cứu, không sửa hoặc xóa được."
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: title }]}
        extra={(
          <Flex gap={8} wrap>
            <ExportButton params={exportParams} />
            <Button icon={<ReloadOutlined />} onClick={list.reload} loading={list.loading}>Làm mới</Button>
          </Flex>
        )} />
      {isBoard ? <Alert type="info" showIcon title="Ban quản trị chỉ xem nhật ký tài chính. Thông tin nhạy cảm được ẩn." /> : null}
      <Card size="small">
        <Flex wrap gap={12}>
          <DatePicker.RangePicker aria-label="Khoảng ngày nhật ký" format="DD/MM/YYYY" style={{ maxWidth: '100%' }}
            onChange={(v) => {
              setFilters((old) => ({ ...old, from: v?.[0].format('YYYY-MM-DD'), to: v?.[1].format('YYYY-MM-DD') }));
              setPage(1);
            }} />
          <Select allowClear showSearch optionFilterProp="label" aria-label="Lọc hành động" placeholder="Tất cả hành động"
            style={{ width: 260, maxWidth: '100%' }} value={filters.action} options={options.data?.actions}
            loading={options.loading} onChange={(v) => change('action', v)} />
          <Select allowClear showSearch optionFilterProp="label" aria-label="Lọc đối tượng" placeholder="Tất cả đối tượng"
            style={{ width: 220, maxWidth: '100%' }} value={filters.targetType} options={options.data?.targets}
            onChange={(v) => change('targetType', v)} />
          <Input allowClear aria-label="Tên người thực hiện" placeholder="Tìm tên người thực hiện"
            style={{ width: 240, maxWidth: '100%' }} value={name} onChange={(e) => { setName(e.target.value); setPage(1); }} />
        </Flex>
      </Card>
      {list.error || options.error ? (
        <Alert type="error" showIcon title={list.error?.message ?? options.error?.message}
          action={<Button onClick={() => { list.reload(); options.reload(); }}>Thử lại</Button>} />
      ) : null}
      <Card size="small" title="Lịch sử hoạt động">
        <Table rowKey="_id" dataSource={list.data ?? []} columns={columns} loading={list.loading} scroll={{ x: 1100 }}
          locale={{ emptyText: NO_DATA }}
          pagination={{ current: page, pageSize: limit, total: list.pagination?.total ?? 0, showSizeChanger: true,
            showTotal: (total) => `${total} nhật ký`,
            onChange: (next, size) => { setPage(size === limit ? next : 1); setLimit(size); } }} />
      </Card>
      <Drawer title="Chi tiết nhật ký" open={Boolean(selected)} onClose={() => setSelected(null)} size="large">
        {selected ? (
          <Flex vertical gap={20}>
            <Descriptions bordered size="small" column={1} items={[
              { key: 'time', label: 'Thời điểm', children: formatDateTime(selected.createdAt) },
              { key: 'user', label: 'Người thực hiện', children: selected.performedBy?.fullName ?? 'Hệ thống' },
              { key: 'action', label: 'Hành động', children: selected.actionLabel },
              { key: 'target', label: 'Đối tượng', children: selected.targetLabel ?? selected.targetType ?? '—' },
              { key: 'name', label: 'Bản ghi', children: targetText(selected) ?? '—' },
              ...(selected.targetId ? [{ key: 'id', label: 'ID hệ thống', children: <Typography.Text copyable type="secondary">{selected.targetId}</Typography.Text> }] : []),
              ...(isBoard ? [] : [{ key: 'ip', label: 'Địa chỉ IP', children: ipLabel(selected) }]),
            ]} />
            <div>
              <Typography.Title level={5}>Giá trị cũ và mới</Typography.Title>
              <ChangesTable changes={selected.changes} targetType={selected.targetType} />
            </div>
            {visibleMetadata(selected.metadata).length ? (
              <div>
                <Typography.Title level={5}>Thông tin thêm</Typography.Title>
                <AuditMetadata metadata={selected.metadata} targetType={selected.targetType} />
              </div>
            ) : null}
          </Flex>
        ) : null}
      </Drawer>
    </Flex>
  );
}

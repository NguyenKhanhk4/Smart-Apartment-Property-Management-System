import { useCallback, useEffect, useState } from 'react';
import { Avatar, Button, Card, DatePicker, Flex, Form, Input, Modal, Progress, Select, Table, Tag, Tooltip, Typography } from 'antd';
import { ReloadOutlined, UserOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { amenityApi, amenityVisitApi } from '../../api/moduleD.api';
import EnumTag from '../../components/EnumTag';
import PageHeader from '../../components/PageHeader';
import { AGE_GROUPS, VISIT_CHARGE_TYPES, VISIT_STATUS, enumOptions } from '../../constants/enums';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { formatMoney } from '../../utils/format';
import ResidentPanel from './ResidentPanel';

const AUTO_REFRESH_MS = 60 * 1000;

/** Thẻ "Đang trong bể bơi: 12/40" cho từng tiện ích WALK_IN */
function OccupancyCards({ items, windowMinutes }) {
  if (!items?.length) return null;
  return (
    <Flex gap={12} wrap>
      {items.map((a) => {
        const percent = a.max ? Math.min(100, Math.round((a.current / a.max) * 100)) : 0;
        return (
          <Card key={a.amenityId} size="small" style={{ minWidth: 220, flex: '1 1 220px', maxWidth: 320 }}>
            <Typography.Text type="secondary">Đang trong {a.name.toLowerCase()}</Typography.Text>
            <div style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.3 }}>
              {a.current}
              {a.max ? `/${a.max}` : ''}
            </div>
            {a.max ? <Progress percent={percent} showInfo={false} size="small" status={percent >= 90 ? 'exception' : 'normal'} /> : <Typography.Text type="secondary">Không giới hạn</Typography.Text>}
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              Tính các lượt trong {windowMinutes} phút gần nhất
            </Typography.Text>
          </Card>
        );
      })}
    </Flex>
  );
}

// UC-D10 — Quầy tiện ích. Lễ tân: tra mã cư dân, ghi lượt vào, hủy lượt. Trưởng BQL: chỉ xem lượt vào và số người đang trong tiện ích.
export default function AmenityDeskPage() {
  const { hasRole } = useAuth();
  const isReception = hasRole('STAFF:RECEPTIONIST');
  const [date, setDate] = useState(() => dayjs());
  const [amenityId, setAmenityId] = useState();
  const [chargeType, setChargeType] = useState();
  const [page, setPage] = useState(1);
  const [silent, setSilent] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [cancelForm] = Form.useForm();

  const dateText = date.format('YYYY-MM-DD');
  const { data: occupancy, reload: reloadOccupancy } = useApi(() => amenityVisitApi.occupancy(), []);
  const { data: walkIns = [] } = useApi(() => amenityApi.list({ accessMode: 'WALK_IN', limit: 100 }), []);
  const { data: visits = [], pagination, loading, reload: reloadVisits } = useApi(
    () => amenityVisitApi.list({ date: dateText, amenityId, chargeType, page, limit: 20 }),
    [dateText, amenityId, chargeType, page],
  );

  const refresh = useCallback(() => {
    setSilent(true);
    Promise.all([reloadVisits(), reloadOccupancy()]).finally(() => setSilent(false));
  }, [reloadVisits, reloadOccupancy]);

  useEffect(() => {
    const timer = setInterval(() => !document.hidden && refresh(), AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const [cancel, cancelling$] = useAction((v) => amenityVisitApi.cancel(cancelling._id, v.reason.trim()), {
    success: 'Đã hủy lượt vào',
    onDone: () => {
      setCancelling(null);
      cancelForm.resetFields();
      refresh();
    },
  });

  const columns = [
    { title: 'Giờ', dataIndex: 'visitedAt', width: 80, render: (v) => dayjs(v).format('HH:mm') },
    {
      title: 'Người vào',
      dataIndex: 'person',
      width: 230,
      render: (p, r) => (
        <Flex gap={8} align="center">
          <Avatar size={36} src={p?.avatarUrl} icon={<UserOutlined />} />
          <Flex vertical>
            <Typography.Text strong>{p?.fullName}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              <span style={{ fontFamily: 'monospace' }}>{p?.memberCode ?? '—'}</span> · {AGE_GROUPS[r.ageGroup]?.label}
            </Typography.Text>
          </Flex>
        </Flex>
      ),
    },
    { title: 'Căn hộ', dataIndex: 'apartment', width: 130, render: (a) => (a ? `${a.code} · ${a.building?.name ?? ''}` : '—') },
    { title: 'Tiện ích', dataIndex: ['amenity', 'name'], width: 130 },
    { title: 'Loại', dataIndex: 'chargeType', width: 110, render: (v) => <EnumTag map={VISIT_CHARGE_TYPES} value={v} /> },
    { title: 'Phí', dataIndex: 'fee', width: 110, align: 'right', render: (v) => (v > 0 ? formatMoney(v) : '—') },
    {
      title: 'Đi kèm / người chịu phí',
      width: 200,
      render: (_, r) => (
        <Flex vertical>
          {r.accompaniedBy && <span>Người lớn: {r.accompaniedBy.fullName}</span>}
          {r.accompaniedChildren > 0 && <span>+{r.accompaniedChildren} trẻ nhỏ</span>}
          {r.chargedTo && r.fee > 0 && <Typography.Text type="secondary">Chịu phí: {r.chargedTo.fullName}</Typography.Text>}
          {!r.accompaniedBy && !r.accompaniedChildren && !(r.chargedTo && r.fee > 0) && '—'}
        </Flex>
      ),
    },
    { title: 'Ghi bởi', dataIndex: ['recordedBy', 'fullName'], width: 130 },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 150,
      render: (v, r) => (
        <Flex gap={4} wrap>
          <EnumTag map={VISIT_STATUS} value={v} />
          {r.invoiceId && <Tag>Đã vào hóa đơn</Tag>}
          {r.cancelReason && (
            <Tooltip title={r.cancelReason}>
              <Tag color="orange">Lý do</Tag>
            </Tooltip>
          )}
        </Flex>
      ),
    },
    ...(isReception
      ? [
          {
            title: '',
            width: 80,
            fixed: 'right',
            render: (_, r) =>
              r.status === 'VALID' &&
              !r.invoiceId && (
                <Button size="small" danger onClick={() => setCancelling(r)}>
                  Hủy
                </Button>
              ),
          },
        ]
      : []),
  ];

  return (
    <Flex vertical gap={16}>
      <PageHeader
        title="Quầy tiện ích"
        subtitle="Tra mã cư dân, đối chiếu ảnh rồi ghi lượt vào tiện ích Vào cửa (gói tháng, vé lẻ hoặc miễn phí). Không thu tiền tại quầy: phí vé lẻ tháng này được cộng vào hóa đơn đầu tháng sau."
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Quầy tiện ích' }]}
        extra={
          <Button icon={<ReloadOutlined />} onClick={refresh}>
            Làm mới
          </Button>
        }
      />

      <OccupancyCards items={occupancy?.items} windowMinutes={occupancy?.windowMinutes} />
      {isReception && <ResidentPanel onRecorded={refresh} />}

      <Card title="Lượt vào">
        <Flex gap={8} wrap style={{ marginBottom: 12 }}>
          <DatePicker allowClear={false} format="DD/MM/YYYY" value={date} onChange={(d) => (setDate(d), setPage(1))} />
          <Select
            allowClear
            placeholder="Tất cả tiện ích"
            style={{ width: 200 }}
            value={amenityId}
            onChange={(v) => (setAmenityId(v), setPage(1))}
            options={walkIns.map((a) => ({ value: a._id, label: a.name }))}
          />
          <Select
            allowClear
            placeholder="Mọi loại"
            style={{ width: 150 }}
            value={chargeType}
            onChange={(v) => (setChargeType(v), setPage(1))}
            options={enumOptions(VISIT_CHARGE_TYPES)}
          />
        </Flex>
        <Table
          rowKey="_id"
          size="middle"
          loading={loading && !silent}
          dataSource={visits}
          columns={columns}
          scroll={{ x: 1300 }}
          locale={{ emptyText: 'Chưa có lượt vào nào' }}
          pagination={{ current: page, pageSize: 20, total: pagination?.total, onChange: setPage, showSizeChanger: false }}
        />
      </Card>

      <Modal
        title="Hủy lượt vào"
        open={Boolean(cancelling)}
        onCancel={() => setCancelling(null)}
        onOk={() => cancelForm.submit()}
        okText="Hủy lượt"
        okButtonProps={{ danger: true }}
        cancelText="Đóng"
        confirmLoading={cancelling$}
        destroyOnHidden
      >
        {cancelling && (
          <Typography.Paragraph type="secondary">
            {cancelling.person?.fullName} · {cancelling.amenity?.name} · {dayjs(cancelling.visitedAt).format('HH:mm')}
            {cancelling.fee > 0 ? ` · ${formatMoney(cancelling.fee)} sẽ không còn tính vào hóa đơn` : ''}. Thao tác được ghi nhật ký.
          </Typography.Paragraph>
        )}
        <Form form={cancelForm} layout="vertical" preserve={false} onFinish={(v) => cancel(v).catch(() => {})}>
          <Form.Item name="reason" label="Lý do hủy" rules={[{ required: true, whitespace: true, min: 5, max: 500, message: 'Nhập lý do 5–500 ký tự' }]}>
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </Flex>
  );
}

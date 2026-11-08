import { useState } from 'react';
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tag,
} from 'antd';
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  IdcardOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { apartmentsApi, parkingCardsApi, residentsApi } from '../../api/moduleA.api';
import EnumTag from '../../components/EnumTag';
import PageHeader from '../../components/PageHeader';
import { PARKING_CARD_STATUS, VEHICLE_TYPES } from '../../constants/enums';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { formatDateTime } from '../../utils/format';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

function IssueCardModal({ replacing, onClose, onDone }) {
  const [form] = Form.useForm();
  const [apartmentId, setApartmentId] = useState();
  const [apartmentSearch, setApartmentSearch] = useState('');
  const query = useDebouncedValue(apartmentSearch.trim());
  const { data: apartments, loading: loadingApartments } = useApi(
    () => apartmentsApi.list({ q: query || undefined, limit: 30 }),
    [query],
    { enabled: !replacing },
  );
  const { data: residents, loading: loadingResidents } = useApi(
    () => residentsApi.listByApartment(apartmentId),
    [apartmentId],
    { enabled: Boolean(apartmentId) && !replacing },
  );
  const [issue, issuing] = useAction(
    (values) => parkingCardsApi.issue({
      cardNumber: values.cardNumber,
      residentId: replacing?.residentId._id ?? values.residentId,
      replacesId: replacing?._id,
    }),
    { onDone },
  );

  return (
    <Modal
      title={replacing ? 'Cấp lại thẻ cư dân' : 'Cấp thẻ cư dân'}
      open
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={issuing}
      okText={replacing ? 'Cấp lại' : 'Cấp thẻ'}
      cancelText="Hủy"
    >
      {replacing && (
        <p>
          Cấp mã mới cho <b>{replacing.residentId.userId?.fullName}</b> tại căn{' '}
          <b>{replacing.apartmentId?.code}</b>. Mã <b>{replacing.cardNumber}</b> sẽ hết hiệu lực.
        </p>
      )}
      <Form form={form} layout="vertical" onFinish={(values) => issue(values).catch(() => {})}>
        {!replacing && (
          <>
            <Form.Item label="Căn hộ" name="apartmentId" rules={[{ required: true, message: 'Chọn căn hộ' }]}>
              <Select
                showSearch={{ filterOption: false, onSearch: setApartmentSearch }}
                placeholder="Tìm theo mã căn hộ"
                loading={loadingApartments}
                onChange={(id) => {
                  setApartmentId(id);
                  form.setFieldValue('residentId', undefined);
                }}
                options={(apartments ?? []).map((apartment) => ({
                  value: apartment._id,
                  label: [apartment.code, apartment.buildingId?.name].filter(Boolean).join(' · '),
                }))}
              />
            </Form.Item>
            <Form.Item label="Cư dân" name="residentId" rules={[{ required: true, message: 'Chọn cư dân' }]}>
              <Select
                disabled={!apartmentId || loadingResidents}
                loading={loadingResidents}
                placeholder="Chọn cư dân có tài khoản"
                options={(residents ?? []).filter((resident) => resident.userId).map((resident) => ({
                  value: resident._id,
                  label: [resident.fullName, resident.phone].filter(Boolean).join(' · '),
                }))}
              />
            </Form.Item>
          </>
        )}
        <Form.Item
          label="Mã thẻ cư dân"
          name="cardNumber"
          rules={[
            { required: true, whitespace: true, message: 'Nhập mã thẻ cư dân' },
            { pattern: /^[A-Z0-9]+(?:[-_][A-Z0-9]+)*$/i, message: 'Dùng chữ, số, dấu gạch ngang hoặc gạch dưới' },
          ]}
        >
          <Input placeholder="Ví dụ: CD-A101-01" maxLength={50} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default function ParkingCardsPage() {
  const { hasRole } = useAuth();
  const isReceptionist = hasRole('STAFF:RECEPTIONIST');
  const isManager = hasRole('MANAGER');

  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [issueTarget, setIssueTarget] = useState(null);
  const [search, setSearch] = useState('');
  const searchQuery = useDebouncedValue(search.trim());
  const [lostTarget, setLostTarget] = useState(null);
  const [lostForm] = Form.useForm();

  const {
    data: listData,
    pagination,
    loading,
    reload,
  } = useApi(
    () =>
      parkingCardsApi.list({
        status: statusFilter || undefined,
        q: searchQuery || undefined,
        page,
        limit: 20,
      }),
    [statusFilter, searchQuery, page],
  );

  const items = Array.isArray(listData) ? listData : listData?.items || [];

  const [handOver, handingOver] = useAction(
    (id) => parkingCardsApi.handOver(id),
    { onDone: reload },
  );

  const [runCollect, collecting] = useAction(
    (id) => parkingCardsApi.collect(id, {}),
    {
      success: 'Đã xác nhận thu hồi thẻ gửi xe',
      onDone: () => reload(),
    },
  );

  const [runLost, markingLost] = useAction(
    ({ id, note }) => parkingCardsApi.lost(id, { note }),
    {
      success: 'Đã ghi nhận mất thẻ gửi xe',
      onDone: () => {
        setLostTarget(null);
        lostForm.resetFields();
        reload();
      },
    },
  );

  const handleConfirmLost = async () => {
    try {
      const values = await lostForm.validateFields();
      await runLost({ id: lostTarget._id, note: values.note });
    } catch {
      // handled
    }
  };

  const columns = [
    {
      title: 'Số thẻ',
      dataIndex: 'cardNumber',
      key: 'cardNumber',
      render: (v) => (
        <Tag icon={<IdcardOutlined />} color="blue" className="font-bold text-sm">
          {v}
        </Tag>
      ),
    },
    {
      title: 'Căn hộ',
      key: 'apartment',
      render: (_, r) => (
        <span>
          <b>{r.apartmentId?.code || '—'}</b>{' '}
          {r.apartmentId?.buildingId?.name ? `(${r.apartmentId.buildingId.name})` : ''}
        </span>
      ),
    },
    {
      title: 'Quyền sử dụng',
      key: 'vehicle',
      render: (_, r) => {
        if (r.residentId) {
          return r.elevatorAllowed ? (
            <Space size={4} wrap>
              <Tag color="blue">Thang máy</Tag>
              {r.parkingVehicleCount > 0 && <Tag color="green">Gửi xe ({r.parkingVehicleCount})</Tag>}
            </Space>
          ) : '—';
        }
        const v = r.vehicleId;
        if (!v) return '—';
        return (
          <Space size={4} wrap>
            <EnumTag map={VEHICLE_TYPES} value={v.type} />
            <b>{v.plateNumber || 'Không biển số'}</b>
            {(v.brand || v.color) && (
              <span className="text-xs text-gray-500">
                ({[v.brand, v.color].filter(Boolean).join(' - ')})
              </span>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Người giữ thẻ',
      key: 'owner',
      render: (_, r) => {
        const u = r.residentId?.userId ?? r.vehicleId?.registeredBy;
        if (!u) return '—';
        return (
          <div>
            <div>{u.fullName}</div>
            <div className="text-xs text-gray-400">{u.phone || u.email || ''}</div>
          </div>
        );
      },
    },
    {
      title: 'Trạng thái thẻ',
      dataIndex: 'status',
      key: 'status',
      render: (v, r) => (
        <EnumTag map={PARKING_CARD_STATUS} value={v === 'ACTIVE' && r.residentId && !r.handedOverAt ? 'PENDING_HANDOVER' : v} />
      ),
    },
    {
      title: 'Ngày cấp',
      dataIndex: 'issuedAt',
      key: 'issuedAt',
      render: (v, r) => (
        <div>
          {formatDateTime(v)}
          {r.handedOverAt && <div className="text-xs text-gray-500">Đã giao: {formatDateTime(r.handedOverAt)}</div>}
        </div>
      ),
    },
    {
      title: 'Ghi chú / Đóng thẻ',
      key: 'closed',
      render: (_, r) => (
        <div className="text-xs">
          {r.closedAt && <div>Đóng lúc: {formatDateTime(r.closedAt)}</div>}
          {r.note && <div className="text-gray-500">Ghi chú: {r.note}</div>}
          {!r.closedAt && !r.note && '—'}
        </div>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      render: (_, r) => {
        if (r.status === 'ACTIVE' && r.residentId?.isActive && r.residentId.parkingCardId === r._id) {
          if (isManager) {
            return <Button size="small" onClick={() => setIssueTarget(r)}>Cấp lại thẻ</Button>;
          }
          if (isReceptionist && !r.handedOverAt) {
            return (
              <Popconfirm
                title={`Xác nhận đã giao thẻ ${r.cardNumber}?`}
                onConfirm={() => handOver(r._id).catch(() => {})}
                okText="Đã bàn giao"
                cancelText="Hủy"
              >
                <Button size="small" type="primary" loading={handingOver}>Bàn giao thẻ</Button>
              </Popconfirm>
            );
          }
        }
        if (r.status !== 'DISABLED_TO_COLLECT') {
          return <span className="text-xs text-gray-400">—</span>;
        }
        if (!isReceptionist) {
          return <Tag>Chỉ Lễ tân thao tác</Tag>;
        }
        return (
          <Space wrap>
            <Popconfirm
              title={`Xác nhận đã thu hồi thẻ ${r.cardNumber}?`}
              onConfirm={() => runCollect(r._id).catch(() => {})}
              okText="Đã thu hồi"
              cancelText="Hủy"
            >
              <Button
                type="primary"
                size="small"
                icon={<CheckCircleOutlined />}
                loading={collecting}
              >
                Đã thu hồi
              </Button>
            </Popconfirm>
            <Button
              danger
              size="small"
              icon={<ExclamationCircleOutlined />}
              onClick={() => {
                setLostTarget(r);
                lostForm.resetFields();
              }}
            >
              Mất thẻ
            </Button>
          </Space>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Thẻ cư dân"
        subtitle="Cấp, bàn giao và thu hồi thẻ dùng cho thang máy và bãi xe"
        extra={
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => reload()}>Làm mới</Button>
            {isManager && (
              <Button type="primary" icon={<IdcardOutlined />} onClick={() => setIssueTarget('new')}>
                Cấp thẻ cư dân
              </Button>
            )}
          </Space>
        }
      />

      <Card size="small">
        <Row gutter={[12, 12]}>
          <Col xs={24} sm={10} md={7}>
            <Select
              className="w-full"
              value={statusFilter}
              onChange={(value) => {
                setStatusFilter(value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'Tất cả trạng thái thẻ' },
                ...Object.entries(PARKING_CARD_STATUS).map(([k, v]) => ({
                  value: k,
                  label: v.label,
                })),
              ]}
            />
          </Col>
          <Col xs={24} sm={14} md={9}>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="Tìm theo mã thẻ..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </Col>
        </Row>
      </Card>

      <Card size="small">
        <Table
          rowKey="_id"
          loading={loading}
          columns={columns}
          dataSource={items}
          pagination={
            pagination
              ? {
                  current: pagination.page,
                  pageSize: pagination.limit,
                  total: pagination.total,
                  showSizeChanger: false,
                  onChange: setPage,
                }
              : false
          }
          scroll={{ x: 860 }}
        />
      </Card>

      {issueTarget && (
        <IssueCardModal
          replacing={issueTarget === 'new' ? null : issueTarget}
          onClose={() => setIssueTarget(null)}
          onDone={() => {
            setIssueTarget(null);
            setStatusFilter('PENDING_HANDOVER');
            setSearch('');
            setPage(1);
            reload();
          }}
        />
      )}
      <Modal
        title={`Ghi nhận mất thẻ: ${lostTarget?.cardNumber || ''}`}
        open={Boolean(lostTarget)}
        onCancel={() => setLostTarget(null)}
        onOk={handleConfirmLost}
        confirmLoading={markingLost}
        okText="Xác nhận mất thẻ"
        okButtonProps={{ danger: true }}
        cancelText="Hủy"
      >
        <Form form={lostForm} layout="vertical">
          <Form.Item name="note" label="Ghi chú (tuỳ chọn)">
            <Input.TextArea
              rows={3}
              placeholder="Ví dụ: Cư dân báo thất lạc thẻ khi bàn giao căn hộ..."
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

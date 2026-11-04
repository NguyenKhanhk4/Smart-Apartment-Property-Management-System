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
import { parkingCardsApi } from '../../api/moduleA.api';
import EnumTag from '../../components/EnumTag';
import PageHeader from '../../components/PageHeader';
import { PARKING_CARD_STATUS, VEHICLE_TYPES } from '../../constants/enums';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { formatDateTime } from '../../utils/format';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

export default function ParkingCardsPage() {
  const { hasRole } = useAuth();
  const isReceptionist = hasRole('STAFF:RECEPTIONIST');

  const [statusFilter, setStatusFilter] = useState('DISABLED_TO_COLLECT');
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
        limit: 50,
      }),
    [statusFilter, searchQuery],
  );

  const items = Array.isArray(listData) ? listData : listData?.items || [];

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
      title: 'Phương tiện',
      key: 'vehicle',
      render: (_, r) => {
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
      title: 'Chủ xe',
      key: 'owner',
      render: (_, r) => {
        const u = r.vehicleId?.registeredBy;
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
      render: (v) => <EnumTag map={PARKING_CARD_STATUS} value={v} />,
    },
    {
      title: 'Ngày cấp',
      dataIndex: 'issuedAt',
      key: 'issuedAt',
      render: (v) => formatDateTime(v),
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
        title="Thẻ gửi xe cần thu hồi (UC66)"
        subtitle="Danh sách thẻ gửi xe đã vô hiệu hóa khi hủy xe hoặc kết thúc hợp đồng, chờ Lễ tân thu hồi hoặc ghi nhận mất thẻ"
        extra={
          <Button icon={<ReloadOutlined />} onClick={() => reload()}>
            Làm mới
          </Button>
        }
      />

      <Card size="small">
        <Row gutter={[12, 12]}>
          <Col xs={24} sm={10} md={7}>
            <Select
              className="w-full"
              value={statusFilter}
              onChange={setStatusFilter}
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
              placeholder="Tìm theo số thẻ gửi xe..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
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
                }
              : false
          }
          scroll={{ x: 860 }}
        />
      </Card>

      <Modal
        title={`Ghi nhận mất thẻ gửi xe: ${lostTarget?.cardNumber || ''}`}
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

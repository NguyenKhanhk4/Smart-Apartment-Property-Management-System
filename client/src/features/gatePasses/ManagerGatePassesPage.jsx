import { useState } from 'react';
import {
  App,
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
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
  CarOutlined,
  CheckOutlined,
  CloseOutlined,
  EyeOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { gatePassesApi } from '../../api/gatePasses.api';
import EnumTag from '../../components/EnumTag';
import PageHeader from '../../components/PageHeader';
import { GATE_PASS_DIRECTIONS, GATE_PASS_STATUS, RELATION_TYPES } from '../../constants/enums';
import { useAction, useApi } from '../../hooks/useApi';
import { formatMoney, formatDate, formatDateTime } from '../../utils/format';
import ReasonModal from '../../components/ReasonModal';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

export default function ManagerGatePassesPage() {
  const { message } = App.useApp();
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [directionFilter, setDirectionFilter] = useState('');
  const [search, setSearch] = useState('');
  const searchQuery = useDebouncedValue(search.trim());
  const [detailId, setDetailId] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);

  const {
    data: listData,
    pagination,
    loading,
    reload,
  } = useApi(
    () =>
      gatePassesApi.list({
        status: statusFilter || undefined,
        direction: directionFilter || undefined,
        search: searchQuery || undefined,
        limit: 50,
      }),
    [statusFilter, directionFilter, searchQuery],
  );

  const items = Array.isArray(listData) ? listData : listData?.items || [];

  const {
    data: detailData,
    loading: loadingDetail,
    reload: reloadDetail,
  } = useApi(
    () => (detailId ? gatePassesApi.getById(detailId) : Promise.resolve({ data: null })),
    [detailId],
    { enabled: Boolean(detailId) },
  );

  const [runApprove, approving] = useAction((id) => gatePassesApi.approve(id), {
    success: 'Đã phê duyệt đơn chuyển đồ',
  });

  const handleApprove = async (id) => {
    try {
      await runApprove(id);
      reload();
      if (detailId === id) reloadDetail();
    } catch {
      // handled
    }
  };


  const columns = [
    {
      title: 'Mã đơn',
      dataIndex: 'code',
      key: 'code',
      render: (v) => <span className="font-semibold text-blue-600">{v}</span>,
    },
    {
      title: 'Căn hộ',
      key: 'apartment',
      render: (_, r) => (
        <span>
          <b>{r.apartmentId?.code}</b> ({r.apartmentId?.buildingId?.name || ''})
        </span>
      ),
    },
    {
      title: 'Người tạo',
      key: 'creator',
      render: (_, r) => (
        <Space size={4} wrap>
          <span>{r.createdBy?.fullName || '—'}</span>
          <EnumTag map={RELATION_TYPES} value={r.creatorRelation} />
        </Space>
      ),
    },
    {
      title: 'Chiều',
      dataIndex: 'direction',
      key: 'direction',
      render: (v) => <EnumTag map={GATE_PASS_DIRECTIONS} value={v} />,
    },
    {
      title: 'Thời gian',
      key: 'time',
      render: (_, r) => (
        <div>
          <div>{formatDate(r.scheduledDate)}</div>
          <div className="text-xs text-gray-500">
            {r.timeSlot?.from} – {r.timeSlot?.to}
          </div>
        </div>
      ),
    },
    {
      title: 'Biển số xe tải',
      dataIndex: 'truckPlate',
      key: 'truckPlate',
      render: (v) => <Tag icon={<CarOutlined />}>{v}</Tag>,
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      render: (v) => <EnumTag map={GATE_PASS_STATUS} value={v} />,
    },
    {
      title: 'Thao tác',
      key: 'actions',
      render: (_, r) => (
        <Space wrap>
          <Button size="small" icon={<EyeOutlined />} onClick={() => setDetailId(r._id)}>
            Chi tiết
          </Button>
          {r.status === 'PENDING' && (
            <>
              <Popconfirm
                title="Phê duyệt đơn chuyển đồ này?"
                onConfirm={() => handleApprove(r._id)}
                okText="Duyệt"
                cancelText="Hủy"
              >
                <Button
                  size="small"
                  type="primary"
                  icon={<CheckOutlined />}
                  loading={approving}
                >
                  Duyệt
                </Button>
              </Popconfirm>
              <Button
                size="small"
                danger
                icon={<CloseOutlined />}
                onClick={() => setRejectTarget(r)}
              >
                Từ chối
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ];

  const renderDebtSection = (gp) => {
    if (!gp || gp.direction !== 'OUT') return null;

    const currentDebt = gp.currentDebt;
    const isAvailable = currentDebt?.available === true;

    return (
      <Alert
        className="mb-4"
        type={isAvailable && currentDebt.amount > 0 ? 'warning' : 'info'}
        showIcon
        message="Thông tin công nợ căn hộ (Đơn chuyển đồ RA - OUT)"
        description={
          <div className="space-y-1 text-sm">
            <div>
              Công nợ hiện tại:{' '}
              {isAvailable ? (
                <b className={currentDebt.amount > 0 ? 'text-red-600' : 'text-emerald-600'}>
                  {formatMoney(currentDebt.amount)}
                </b>
              ) : (
                <span className="italic text-gray-500">Chưa có dữ liệu công nợ</span>
              )}
            </div>
            {gp.debtSnapshot?.at && (
              <div className="text-xs text-gray-500">
                Công nợ ghi nhận lúc duyệt ({formatDateTime(gp.debtSnapshot.at)}):{' '}
                <b>{formatMoney(gp.debtSnapshot.amount ?? 0)}</b>
              </div>
            )}
          </div>
        }
      />
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Duyệt Gate Pass (Đơn chuyển đồ)"
        subtitle="Xem xét, kiểm tra công nợ căn hộ đối với đơn chuyển đồ ra và phê duyệt Gate Pass"
        extra={
          <Button icon={<ReloadOutlined />} onClick={() => reload()}>
            Làm mới
          </Button>
        }
      />

      <Card size="small">
        <Row gutter={[12, 12]}>
          <Col xs={24} sm={8} md={6}>
            <Select
              className="w-full"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: '', label: 'Tất cả trạng thái' },
                ...Object.entries(GATE_PASS_STATUS).map(([k, v]) => ({
                  value: k,
                  label: v.label,
                })),
              ]}
            />
          </Col>
          <Col xs={24} sm={8} md={6}>
            <Select
              className="w-full"
              value={directionFilter}
              onChange={setDirectionFilter}
              options={[
                { value: '', label: 'Tất cả chiều (IN / OUT)' },
                { value: 'IN', label: 'Chuyển đồ vào (IN)' },
                { value: 'OUT', label: 'Chuyển đồ ra (OUT)' },
              ]}
            />
          </Col>
          <Col xs={24} sm={8} md={8}>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="Tìm theo mã đơn hoặc biển số..."
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

      {/* Modal chi tiết Gate Pass */}
      <Modal
        title={`Chi tiết Gate Pass ${detailData?.code || ''}`}
        open={Boolean(detailId)}
        onCancel={() => setDetailId(null)}
        width={680}
        footer={
          <Space>
            {detailData?.status === 'PENDING' && (
              <>
                <Popconfirm
                  title="Phê duyệt đơn chuyển đồ này?"
                  onConfirm={() => handleApprove(detailData._id)}
                  okText="Duyệt"
                  cancelText="Hủy"
                >
                  <Button
                    type="primary"
                    icon={<CheckOutlined />}
                    loading={approving}
                  >
                    Duyệt đơn
                  </Button>
                </Popconfirm>
                <Button
                  danger
                  icon={<CloseOutlined />}
                  onClick={() => setRejectTarget(detailData)}
                >
                  Từ chối
                </Button>
              </>
            )}
            <Button onClick={() => setDetailId(null)}>Đóng</Button>
          </Space>
        }
      >
        {loadingDetail ? (
          <div className="py-10 text-center">Đang tải...</div>
        ) : (
          detailData && (
            <div>
              {renderDebtSection(detailData)}
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="Mã đơn">{detailData.code}</Descriptions.Item>
                <Descriptions.Item label="Căn hộ">
                  <b>{detailData.apartmentId?.code}</b> — {detailData.apartmentId?.buildingId?.name}
                </Descriptions.Item>
                <Descriptions.Item label="Người tạo">
                  {detailData.createdBy?.fullName} ({detailData.createdBy?.phone || detailData.createdBy?.email}){' '}
                  <EnumTag map={RELATION_TYPES} value={detailData.creatorRelation} />
                </Descriptions.Item>
                <Descriptions.Item label="Chiều vận chuyển">
                  <EnumTag map={GATE_PASS_DIRECTIONS} value={detailData.direction} />
                </Descriptions.Item>
                <Descriptions.Item label="Trạng thái">
                  <EnumTag map={GATE_PASS_STATUS} value={detailData.status} />
                </Descriptions.Item>
                <Descriptions.Item label="Ngày & khung giờ">
                  {formatDate(detailData.scheduledDate)} ({detailData.timeSlot?.from} –{' '}
                  {detailData.timeSlot?.to})
                </Descriptions.Item>
                <Descriptions.Item label="Biển số xe tải">
                  <Tag icon={<CarOutlined />}>{detailData.truckPlate}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="SĐT tài xế">
                  {detailData.driverPhone || '—'}
                </Descriptions.Item>
                <Descriptions.Item label="Danh sách đồ đạc">
                  <ul className="list-disc pl-4 m-0">
                    {(detailData.items || []).map((it, idx) => (
                      <li key={`${it.name}-${idx}`}>
                        {it.name} — Số lượng: <b>{it.quantity}</b>
                      </li>
                    ))}
                  </ul>
                </Descriptions.Item>
                {detailData.ownerDecision?.at && (
                  <Descriptions.Item label="Chủ hộ xác nhận">
                    {detailData.ownerDecision.approved ? 'Đồng ý' : 'Từ chối'} bởi{' '}
                    {detailData.ownerDecision.by?.fullName || 'Chủ hộ'} lúc{' '}
                    {formatDateTime(detailData.ownerDecision.at)}
                  </Descriptions.Item>
                )}
                {detailData.reviewedAt && (
                  <Descriptions.Item label="BQL xử lý">
                    {detailData.reviewedBy?.fullName || 'Trưởng BQL'} lúc{' '}
                    {formatDateTime(detailData.reviewedAt)}
                  </Descriptions.Item>
                )}
                {detailData.rejectReason && (
                  <Descriptions.Item label="Lý do từ chối">
                    <span className="text-red-500">{detailData.rejectReason}</span>
                  </Descriptions.Item>
                )}
              </Descriptions>
            </div>
          )
        )}
      </Modal>

      <ReasonModal
        open={Boolean(rejectTarget)}
        title={`Từ chối Gate Pass ${rejectTarget?.code || ''}`}
        label="Lý do từ chối"
        placeholder="Nhập lý do từ chối đơn chuyển đồ..."
        okText="Xác nhận từ chối"
        action={(reason) => gatePassesApi.reject(rejectTarget._id, reason)}
        onClose={() => setRejectTarget(null)}
        onDone={() => {
          message.success('Đã từ chối đơn chuyển đồ');
          const id = rejectTarget._id;
          setRejectTarget(null);
          reload();
          if (detailId === id) reloadDetail();
        }}
      />
    </div>
  );
}

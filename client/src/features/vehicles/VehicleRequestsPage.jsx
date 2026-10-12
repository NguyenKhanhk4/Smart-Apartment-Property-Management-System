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
  Tabs,
  Tag,
  message,
} from 'antd';
import {
  CarOutlined,
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { vehicleApi } from '../../api/moduleA.api';
import EnumTag from '../../components/EnumTag';
import { VEHICLE_STATUS, VEHICLE_TYPES, enumOptions } from '../../constants/enums';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { formatDate } from '../../utils/format';

export default function VehicleRequestsPage() {
  const { user } = useAuth();
  const isReceptionist = user?.role === 'STAFF' && user?.roleTitle === 'RECEPTIONIST';

  const [activeTab, setActiveTab] = useState('pending');

  // Tab Chờ duyệt
  const [pendingPage, setPendingPage] = useState(1);
  const [pendingPageSize, setPendingPageSize] = useState(10);
  const {
    data: pendingData,
    pagination: pendingPagination,
    loading: loadingPending,
    reload: reloadPending,
  } = useApi(
    () => vehicleApi.list({ status: 'PENDING', page: pendingPage, limit: pendingPageSize }),
    [pendingPage, pendingPageSize, activeTab],
    { enabled: activeTab === 'pending' },
  );
  const pendingItems = Array.isArray(pendingData)
    ? pendingData
    : pendingData?.items || [];

  // Tab Yêu cầu hủy
  const [cancelPage, setCancelPage] = useState(1);
  const [cancelPageSize, setCancelPageSize] = useState(10);
  const {
    data: cancelData,
    pagination: cancelPagination,
    loading: loadingCancelRequests,
    reload: reloadCancel,
  } = useApi(
    () =>
      vehicleApi.list({
        status: 'APPROVED',
        cancelRequested: true,
        page: cancelPage,
        limit: cancelPageSize,
      }),
    [cancelPage, cancelPageSize, activeTab],
    { enabled: activeTab === 'cancel' },
  );
  const cancelItems = Array.isArray(cancelData)
    ? cancelData
    : cancelData?.items || [];

  // Tab Tất cả phương tiện
  const [allPage, setAllPage] = useState(1);
  const [allPageSize, setAllPageSize] = useState(10);
  const [allFilters, setAllFilters] = useState({ status: undefined, type: undefined, q: '' });
  const {
    data: allData,
    pagination: allPagination,
    loading: loadingAll,
    reload: reloadAll,
  } = useApi(
    () =>
      vehicleApi.list({
        page: allPage,
        limit: allPageSize,
        ...(allFilters.status ? { status: allFilters.status } : {}),
        ...(allFilters.type ? { type: allFilters.type } : {}),
        ...(allFilters.q?.trim() ? { q: allFilters.q.trim() } : {}),
      }),
    [allPage, allPageSize, allFilters, activeTab],
    { enabled: activeTab === 'all' },
  );
  const allItems = Array.isArray(allData)
    ? allData
    : allData?.items || [];

  // Modal Từ chối
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectingItem, setRejectingItem] = useState(null);
  const [rejectForm] = Form.useForm();

  // Đang thao tác duyệt/hủy
  const [actionLoadingId, setActionLoadingId] = useState(null);

  // Hành động Duyệt
  const handleApprove = async (id) => {
    setActionLoadingId(id);
    try {
      await vehicleApi.approve(id);
      message.success('Đã duyệt đăng ký xe thành công!');
      reloadPending();
    } catch (err) {
      message.error(err.response?.data?.message || 'Duyệt phương tiện thất bại');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Mở modal Từ chối
  const openRejectModal = (item) => {
    setRejectingItem(item);
    rejectForm.resetFields();
    setRejectModalOpen(true);
  };

  // Action Từ chối
  const [rejectAction, rejectSubmitting] = useAction(
    async (values) => {
      if (!rejectingItem) return null;
      return vehicleApi.reject(rejectingItem._id, { reason: values.reason });
    },
    {
      success: 'Đã từ chối đăng ký xe thành công',
      onDone: () => {
        setRejectModalOpen(false);
        reloadPending();
      },
    },
  );

  // Xác nhận Hủy
  const handleConfirmCancel = async (id) => {
    setActionLoadingId(id);
    try {
      await vehicleApi.confirmCancel(id);
      message.success('Đã xác nhận hủy vé gửi xe thành công!');
      reloadCancel();
    } catch (err) {
      message.error(err.response?.data?.message || 'Xác nhận hủy thất bại');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Cột bảng Chờ duyệt
  const pendingColumns = [
    {
      title: 'Căn hộ',
      key: 'apartment',
      width: 140,
      render: (_, r) => (
        <div>
          <span className="font-semibold text-primary">{r.apartmentId?.code || '—'}</span>
          <div className="text-xs text-gray-400">
            {r.apartmentId?.buildingId?.name || r.apartmentId?.buildingId?.code || ''}
          </div>
        </div>
      ),
    },
    {
      title: 'Loại xe',
      dataIndex: 'type',
      key: 'type',
      width: 120,
      render: (val) => <EnumTag map={VEHICLE_TYPES} value={val} />,
    },
    {
      title: 'Biển số xe',
      dataIndex: 'plateNumber',
      key: 'plateNumber',
      width: 150,
      render: (val, r) => (
        <span className="font-bold text-gray-800 dark:text-gray-100">
          {val || (r.type === 'BICYCLE' ? <i className="text-gray-400 font-normal">Không biển số</i> : '—')}
        </span>
      ),
    },
    {
      title: 'Hãng / Màu',
      key: 'details',
      width: 160,
      render: (_, r) => [r.brand, r.color].filter(Boolean).join(' • ') || '—',
    },
    {
      title: 'Người đăng ký',
      key: 'registeredBy',
      render: (_, r) => (
        <div>
          <div className="font-medium text-gray-800 dark:text-gray-200">{r.registeredBy?.fullName || '—'}</div>
          <div className="text-xs text-gray-400">
            {r.registeredBy?.phone || r.registeredBy?.email || ''}
          </div>
        </div>
      ),
    },
    {
      title: 'Ngày gửi',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 150,
      render: (val) => formatDate(val),
    },
    {
      title: 'Thao tác',
      key: 'action',
      width: 180,
      fixed: 'right',
      render: (_, r) =>
        isReceptionist ? (
          <Space>
            <Popconfirm
              title="Duyệt đăng ký xe"
              description="Xác nhận duyệt phương tiện này vào bãi gửi xe?"
              okText="Duyệt"
              cancelText="Hủy"
              onConfirm={() => handleApprove(r._id)}
              okButtonProps={{ loading: actionLoadingId === r._id }}
            >
              <Button type="primary" size="small" icon={<CheckOutlined />}>
                Duyệt
              </Button>
            </Popconfirm>

            <Button
              size="small"
              danger
              icon={<CloseOutlined />}
              onClick={() => openRejectModal(r)}
            >
              Từ chối
            </Button>
          </Space>
        ) : (
          <Tag color="default">Chỉ xem</Tag>
        ),
    },
  ];

  // Cột bảng Yêu cầu hủy
  const cancelColumns = [
    {
      title: 'Căn hộ',
      key: 'apartment',
      width: 140,
      render: (_, r) => (
        <div>
          <span className="font-semibold text-primary">{r.apartmentId?.code || '—'}</span>
          <div className="text-xs text-gray-400">
            {r.apartmentId?.buildingId?.name || r.apartmentId?.buildingId?.code || ''}
          </div>
        </div>
      ),
    },
    {
      title: 'Loại xe',
      dataIndex: 'type',
      key: 'type',
      width: 120,
      render: (val) => <EnumTag map={VEHICLE_TYPES} value={val} />,
    },
    {
      title: 'Biển số xe',
      dataIndex: 'plateNumber',
      key: 'plateNumber',
      width: 150,
      render: (val) => (
        <span className="font-bold text-gray-800 dark:text-gray-100">{val || '—'}</span>
      ),
    },
    {
      title: 'Người đăng ký',
      key: 'registeredBy',
      render: (_, r) => (
        <div>
          <div className="font-medium text-gray-800 dark:text-gray-200">{r.registeredBy?.fullName || '—'}</div>
          <div className="text-xs text-gray-400">
            {r.registeredBy?.phone || r.registeredBy?.email || ''}
          </div>
        </div>
      ),
    },
    {
      title: 'Ngày duyệt trước đó',
      dataIndex: 'approvedAt',
      key: 'approvedAt',
      width: 160,
      render: (val) => formatDate(val),
    },
    {
      title: 'Ngày yêu cầu hủy',
      dataIndex: 'cancelRequestedAt',
      key: 'cancelRequestedAt',
      width: 160,
      render: (val) => (
        <span className="text-amber-600 dark:text-amber-400 font-medium">{formatDate(val)}</span>
      ),
    },
    {
      title: 'Thao tác',
      key: 'action',
      width: 160,
      fixed: 'right',
      render: (_, r) =>
        isReceptionist ? (
          <Popconfirm
            title="Xác nhận hủy vé gửi xe"
            description="Sau khi xác nhận hủy, phương tiện sẽ chuyển sang trạng thái Đã hủy."
            okText="Xác nhận hủy"
            cancelText="Đóng"
            okButtonProps={{ danger: true, loading: actionLoadingId === r._id }}
            onConfirm={() => handleConfirmCancel(r._id)}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              Xác nhận hủy
            </Button>
          </Popconfirm>
        ) : (
          <Tag color="default">Chỉ xem</Tag>
        ),
    },
  ];

  // Cột bảng Tất cả xe
  const allColumns = [
    {
      title: 'Căn hộ',
      key: 'apartment',
      width: 140,
      render: (_, r) => (
        <div>
          <span className="font-semibold text-primary">{r.apartmentId?.code || '—'}</span>
          <div className="text-xs text-gray-400">
            {r.apartmentId?.buildingId?.name || r.apartmentId?.buildingId?.code || ''}
          </div>
        </div>
      ),
    },
    {
      title: 'Loại xe',
      dataIndex: 'type',
      key: 'type',
      width: 120,
      render: (val) => <EnumTag map={VEHICLE_TYPES} value={val} />,
    },
    {
      title: 'Biển số xe',
      dataIndex: 'plateNumber',
      key: 'plateNumber',
      width: 150,
      render: (val, r) => (
        <span className="font-bold text-gray-800 dark:text-gray-100">
          {val || (r.type === 'BICYCLE' ? <i className="text-gray-400 font-normal">Không biển số</i> : '—')}
        </span>
      ),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 130,
      render: (val) => <EnumTag map={VEHICLE_STATUS} value={val} />,
    },
    {
      title: 'Người đăng ký',
      key: 'registeredBy',
      render: (_, r) => (
        <div>
          <div className="font-medium text-gray-800 dark:text-gray-200">{r.registeredBy?.fullName || '—'}</div>
          <div className="text-xs text-gray-400">{r.registeredBy?.email}</div>
        </div>
      ),
    },
    {
      title: 'Ngày duyệt',
      dataIndex: 'approvedAt',
      key: 'approvedAt',
      width: 150,
      render: (val) => (val ? formatDate(val) : '—'),
    },
    {
      title: 'Ngày hủy',
      dataIndex: 'cancelledAt',
      key: 'cancelledAt',
      width: 150,
      render: (val) => (val ? formatDate(val) : '—'),
    },
  ];

  const totalPending = pendingPagination?.total || 0;
  const totalCancel = cancelPagination?.total || 0;

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2 m-0">
            <CarOutlined className="text-primary" /> Quản lý yêu cầu gửi xe
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm m-0 mt-1">
            Xét duyệt đăng ký phương tiện mới và xử lý yêu cầu hủy vé gửi xe từ cư dân
          </p>
        </div>

        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            if (activeTab === 'pending') reloadPending();
            else if (activeTab === 'cancel') reloadCancel();
            else reloadAll();
          }}
        >
          Làm mới
        </Button>
      </div>

      {/* Tabs */}
      <Card className="shadow-sm border border-gray-100 dark:border-gray-800">
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key)}
          items={[
            {
              key: 'pending',
              label: (
                <span>
                  Chờ duyệt {totalPending > 0 && <Tag color="gold" className="ml-1">{totalPending}</Tag>}
                </span>
              ),
              children: (
                <Table
                  columns={pendingColumns}
                  dataSource={pendingItems}
                  rowKey="_id"
                  loading={loadingPending}
                  pagination={{
                    current: pendingPage,
                    pageSize: pendingPageSize,
                    total: totalPending,
                    showSizeChanger: true,
                    onChange: (page, pageSize) => {
                      setPendingPage(page);
                      setPendingPageSize(pageSize);
                    },
                  }}
                  locale={{ emptyText: 'Hiện không có yêu cầu đăng ký nào đang chờ duyệt' }}
                  scroll={{ x: 900 }}
                />
              ),
            },
            {
              key: 'cancel',
              label: (
                <span>
                  Yêu cầu hủy {totalCancel > 0 && <Tag color="red" className="ml-1">{totalCancel}</Tag>}
                </span>
              ),
              children: (
                <Table
                  columns={cancelColumns}
                  dataSource={cancelItems}
                  rowKey="_id"
                  loading={loadingCancelRequests}
                  pagination={{
                    current: cancelPage,
                    pageSize: cancelPageSize,
                    total: totalCancel,
                    showSizeChanger: true,
                    onChange: (page, pageSize) => {
                      setCancelPage(page);
                      setCancelPageSize(pageSize);
                    },
                  }}
                  locale={{ emptyText: 'Không có yêu cầu hủy vé gửi xe nào' }}
                  scroll={{ x: 900 }}
                />
              ),
            },
            {
              key: 'all',
              label: 'Tất cả phương tiện',
              children: (
                <div className="space-y-4">
                  <Row gutter={[16, 16]}>
                    <Col xs={24} sm={8} md={6}>
                      <Select
                        placeholder="Trạng thái"
                        allowClear
                        className="w-full"
                        options={enumOptions(VEHICLE_STATUS)}
                        value={allFilters.status}
                        onChange={(val) => setAllFilters((prev) => ({ ...prev, status: val }))}
                      />
                    </Col>
                    <Col xs={24} sm={8} md={6}>
                      <Select
                        placeholder="Loại phương tiện"
                        allowClear
                        className="w-full"
                        options={enumOptions(VEHICLE_TYPES)}
                        value={allFilters.type}
                        onChange={(val) => setAllFilters((prev) => ({ ...prev, type: val }))}
                      />
                    </Col>
                    <Col xs={24} sm={8} md={8}>
                      <Input
                        placeholder="Tìm theo biển số xe..."
                        prefix={<SearchOutlined />}
                        allowClear
                        value={allFilters.q}
                        onChange={(e) => setAllFilters((prev) => ({ ...prev, q: e.target.value }))}
                        onPressEnter={() => reloadAll()}
                      />
                    </Col>
                    <Col xs={24} sm={24} md={4}>
                      <Button
                        type="primary"
                        icon={<SearchOutlined />}
                        onClick={() => reloadAll()}
                        className="w-full"
                      >
                        Tìm kiếm
                      </Button>
                    </Col>
                  </Row>

                  <Table
                    columns={allColumns}
                    dataSource={allItems}
                    rowKey="_id"
                    loading={loadingAll}
                    pagination={{
                      current: allPage,
                      pageSize: allPageSize,
                      total: allPagination?.total || 0,
                      showSizeChanger: true,
                      onChange: (page, pageSize) => {
                        setAllPage(page);
                        setAllPageSize(pageSize);
                      },
                    }}
                    scroll={{ x: 900 }}
                  />
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* Modal Nhập lý do từ chối */}
      <Modal
        title={`Từ chối đăng ký phương tiện: ${rejectingItem?.plateNumber || rejectingItem?.type || ''}`}
        open={rejectModalOpen}
        onCancel={() => setRejectModalOpen(false)}
        onOk={() => rejectForm.submit()}
        confirmLoading={rejectSubmitting}
        okText="Xác nhận từ chối"
        okButtonProps={{ danger: true }}
        cancelText="Hủy"
        destroyOnClose
      >
        <Form
          form={rejectForm}
          layout="vertical"
          onFinish={rejectAction}
          className="mt-4"
        >
          <Form.Item
            name="reason"
            label="Lý do từ chối"
            rules={[{ required: true, message: 'Vui lòng nhập lý do từ chối' }]}
            extra="Lý do từ chối sẽ được gửi thông báo trực tiếp đến cư dân."
          >
            <Input.TextArea
              rows={4}
              placeholder="Ví dụ: Bãi xe máy tạm thời hết chỗ, hoặc thông tin giấy tờ xe chưa hợp lệ..."
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

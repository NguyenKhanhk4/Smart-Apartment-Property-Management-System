import { useState, useMemo } from 'react';
import {
  Table,
  Card,
  Button,
  Input,
  InputNumber,
  Select,
  Modal,
  Form,
  Tabs,
  Tag,
  Badge,
  Space,
  Popconfirm,
  Row,
  Col,
  Statistic,
  Descriptions,
  Alert,
  App,
} from 'antd';
import {
  BankOutlined,
  HomeOutlined,
  PlusOutlined,
  ReloadOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  SearchOutlined,
  TeamOutlined,
  CarOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import PageHeader from '../../components/PageHeader';
import EnumTag from '../../components/EnumTag';
import { APARTMENT_STATUS, CONTRACT_TYPES, CONTRACT_STATUS } from '../../constants/enums';
import { useAuth } from '../../hooks/useAuth';
import { useApi, useAction } from '../../hooks/useApi';
import { buildingsApi, apartmentsApi } from '../../api/moduleA.api';

export default function BuildingsPage() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const isAdmin = user?.role === 'ADMIN';

  // Active tab: 'buildings' | 'apartments'
  const [activeTab, setActiveTab] = useState('buildings');

  // Buildings state & APIs
  const [buildingModalOpen, setBuildingModalOpen] = useState(false);
  const [editingBuilding, setEditingBuilding] = useState(null);
  const [buildingForm] = Form.useForm();

  const {
    data: buildings = [],
    loading: loadingBuildings,
    reload: reloadBuildings,
  } = useApi(buildingsApi.list, []);

  // Apartments filter & state
  const [apartmentFilter, setApartmentFilter] = useState({
    page: 1,
    limit: 10,
    buildingId: undefined,
    floor: undefined,
    status: undefined,
    q: '',
  });
  const [searchInput, setSearchInput] = useState('');

  const [apartmentModalOpen, setApartmentModalOpen] = useState(false);
  const [editingApartment, setEditingApartment] = useState(null);
  const [apartmentForm] = Form.useForm();

  // Apartment Detail state
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedApartment, setSelectedApartment] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Fetch apartments with useApi
  const {
    data: apartments = [],
    pagination: apartmentsPagination,
    loading: loadingApartments,
    reload: reloadApartments,
  } = useApi(
    () =>
      apartmentsApi.list({
        page: apartmentFilter.page,
        limit: apartmentFilter.limit,
        ...(apartmentFilter.buildingId ? { buildingId: apartmentFilter.buildingId } : {}),
        ...(apartmentFilter.floor ? { floor: apartmentFilter.floor } : {}),
        ...(apartmentFilter.status ? { status: apartmentFilter.status } : {}),
        ...(apartmentFilter.q ? { q: apartmentFilter.q.trim() } : {}),
      }),
    [apartmentFilter],
    { enabled: activeTab === 'apartments' },
  );

  // Summary statistics
  const stats = useMemo(() => {
    const totalBuildings = buildings?.length || 0;
    const totalApartments = (buildings || []).reduce((acc, b) => acc + (b.apartmentCount || 0), 0);
    return { totalBuildings, totalApartments };
  }, [buildings]);

  // Actions for Building
  const [saveBuilding, submittingBuilding] = useAction(
    async (values) => {
      if (editingBuilding) {
        return buildingsApi.update(editingBuilding._id, values);
      }
      return buildingsApi.create(values);
    },
    {
      success: () => (editingBuilding ? 'Cập nhật tòa nhà thành công' : 'Thêm tòa nhà mới thành công'),
      onDone: () => {
        setBuildingModalOpen(false);
        reloadBuildings();
      },
    },
  );

  const [deleteBuilding] = useAction((id) => buildingsApi.delete(id), {
    success: 'Đã xóa tòa nhà thành công',
    onDone: reloadBuildings,
  });

  const handleOpenBuildingModal = (bldg = null) => {
    setEditingBuilding(bldg);
    if (bldg) {
      buildingForm.setFieldsValue({
        code: bldg.code,
        name: bldg.name,
        address: bldg.address || '',
        totalFloors: bldg.totalFloors,
      });
    } else {
      buildingForm.resetFields();
    }
    setBuildingModalOpen(true);
  };

  const handleSaveBuilding = async () => {
    try {
      const values = await buildingForm.validateFields();
      await saveBuilding(values);
    } catch {
      // Form validation error
    }
  };

  // Actions for Apartment
  const [saveApartment, submittingApartment] = useAction(
    async (values) => {
      if (editingApartment) {
        return apartmentsApi.update(editingApartment._id, {
          code: values.code,
          floor: values.floor,
          area: values.area,
        });
      }
      return apartmentsApi.create(values);
    },
    {
      success: () =>
        editingApartment
          ? 'Cập nhật căn hộ thành công'
          : 'Tạo mới căn hộ thành công (trạng thái: Trống)',
      onDone: () => {
        setApartmentModalOpen(false);
        reloadApartments();
        reloadBuildings();
      },
    },
  );

  const [deleteApartment] = useAction((id) => apartmentsApi.delete(id), {
    success: 'Đã xóa căn hộ thành công',
    onDone: () => {
      reloadApartments();
      reloadBuildings();
    },
  });

  const handleOpenApartmentModal = (apt = null) => {
    setEditingApartment(apt);
    if (apt) {
      apartmentForm.setFieldsValue({
        buildingId: apt.buildingId?._id || apt.buildingId,
        code: apt.code,
        floor: apt.floor,
        area: apt.area,
      });
    } else {
      apartmentForm.resetFields();
      if (apartmentFilter.buildingId) {
        apartmentForm.setFieldValue('buildingId', apartmentFilter.buildingId);
      }
    }
    setApartmentModalOpen(true);
  };

  const handleSaveApartment = async () => {
    try {
      const values = await apartmentForm.validateFields();
      await saveApartment(values);
    } catch {
      // Form validation error
    }
  };

  const handleViewApartmentDetail = async (id) => {
    setLoadingDetail(true);
    setDetailModalOpen(true);
    try {
      const res = await apartmentsApi.getById(id);
      setSelectedApartment(res.data);
    } catch (err) {
      message.error(err?.response?.data?.message || 'Không thể tải chi tiết căn hộ');
      setDetailModalOpen(false);
    } finally {
      setLoadingDetail(false);
    }
  };

  // Buildings columns
  const buildingColumns = [
    {
      title: 'Mã tòa',
      dataIndex: 'code',
      key: 'code',
      width: 110,
      render: (code) => <Tag color="blue" className="font-semibold text-sm">{code}</Tag>,
    },
    {
      title: 'Tên tòa nhà',
      dataIndex: 'name',
      key: 'name',
      render: (name) => <span className="font-medium text-ink dark:text-gray-200">{name}</span>,
    },
    {
      title: 'Địa chỉ',
      dataIndex: 'address',
      key: 'address',
      render: (addr) => addr || <span className="text-gray-400 italic">Chưa có</span>,
    },
    {
      title: 'Tổng số tầng',
      dataIndex: 'totalFloors',
      key: 'totalFloors',
      width: 140,
      render: (floors) => `${floors} tầng`,
    },
    {
      title: 'Số căn hộ',
      dataIndex: 'apartmentCount',
      key: 'apartmentCount',
      width: 130,
      render: (count) => <Badge count={count ?? 0} showZero overflowCount={999} style={{ backgroundColor: '#108ee9' }} />,
    },
    ...(isAdmin
      ? [
          {
            title: 'Thao tác',
            key: 'action',
            width: 150,
            render: (_, record) => (
              <Space>
                <Button
                  size="small"
                  type="text"
                  icon={<EditOutlined />}
                  onClick={() => handleOpenBuildingModal(record)}
                >
                  Sửa
                </Button>
                <Popconfirm
                  title="Xóa tòa nhà"
                  description={
                    record.apartmentCount > 0
                      ? 'Tòa nhà đã có căn hộ, không thể xóa!'
                      : `Bạn có chắc chắn muốn xóa tòa ${record.name}?`
                  }
                  okText="Xóa"
                  cancelText="Hủy"
                  okButtonProps={{ danger: true, disabled: record.apartmentCount > 0 }}
                  onConfirm={() => deleteBuilding(record._id)}
                >
                  <Button size="small" type="text" danger icon={<DeleteOutlined />}>
                    Xóa
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]
      : []),
  ];

  // Apartments columns
  const apartmentColumns = [
    {
      title: 'Mã căn',
      dataIndex: 'code',
      key: 'code',
      width: 120,
      render: (code) => <span className="font-semibold text-blue-600 dark:text-blue-400">{code}</span>,
    },
    {
      title: 'Tòa nhà',
      dataIndex: 'buildingId',
      key: 'buildingId',
      width: 160,
      render: (bldg) => bldg?.name || bldg?.code || '—',
    },
    {
      title: 'Tầng',
      dataIndex: 'floor',
      key: 'floor',
      width: 90,
      render: (floor) => `Tầng ${floor}`,
    },
    {
      title: 'Diện tích',
      dataIndex: 'area',
      key: 'area',
      width: 120,
      render: (area) => `${area} m²`,
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 140,
      render: (status) => <EnumTag map={APARTMENT_STATUS} value={status} />,
    },
    {
      title: 'Thao tác',
      key: 'action',
      width: 180,
      render: (_, record) => (
        <Space>
          <Button
            size="small"
            type="text"
            icon={<EyeOutlined />}
            onClick={() => handleViewApartmentDetail(record._id)}
          >
            Chi tiết
          </Button>
          {isAdmin && (
            <>
              <Button
                size="small"
                type="text"
                icon={<EditOutlined />}
                onClick={() => handleOpenApartmentModal(record)}
              >
                Sửa
              </Button>
              <Popconfirm
                title="Xóa căn hộ"
                description={`Bạn có chắc muốn xóa căn ${record.code}?`}
                okText="Xóa"
                cancelText="Hủy"
                okButtonProps={{ danger: true }}
                onConfirm={() => deleteApartment(record._id)}
              >
                <Button size="small" type="text" danger icon={<DeleteOutlined />}>
                  Xóa
                </Button>
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Tòa nhà & Căn hộ"
        subtitle="Quản lý danh sách các tòa chung cư (Block) và căn hộ trực thuộc hệ thống"
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Tòa nhà & Căn hộ' }]}
        extra={
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                reloadBuildings();
                if (activeTab === 'apartments') reloadApartments();
              }}
            >
              Làm mới
            </Button>
            {isAdmin && activeTab === 'buildings' && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => handleOpenBuildingModal()}
              >
                Thêm tòa nhà
              </Button>
            )}
            {isAdmin && activeTab === 'apartments' && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => handleOpenApartmentModal()}
              >
                Thêm căn hộ
              </Button>
            )}
          </Space>
        }
      />

      {/* Overview Cards */}
      <Row gutter={[16, 16]} className="mb-6">
        <Col xs={24} sm={12} md={6}>
          <Card bordered={false} className="shadow-sm">
            <Statistic
              title="Tổng số tòa nhà"
              value={stats.totalBuildings}
              prefix={<BankOutlined className="text-blue-500 mr-2" />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card bordered={false} className="shadow-sm">
            <Statistic
              title="Tổng số căn hộ"
              value={stats.totalApartments}
              prefix={<HomeOutlined className="text-green-500 mr-2" />}
            />
          </Card>
        </Col>
      </Row>

      {/* Tabs */}
      <Card bordered={false} className="shadow-sm">
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'buildings',
              label: (
                <span>
                  <BankOutlined className="mr-1.5" />
                  Danh sách tòa nhà ({buildings.length})
                </span>
              ),
              children: (
                <Table
                  columns={buildingColumns}
                  dataSource={buildings}
                  rowKey="_id"
                  loading={loadingBuildings}
                  pagination={false}
                />
              ),
            },
            {
              key: 'apartments',
              label: (
                <span>
                  <HomeOutlined className="mr-1.5" />
                  Danh sách căn hộ
                </span>
              ),
              children: (
                <div>
                  {/* Filters Bar */}
                  <div className="flex flex-wrap gap-3 items-center mb-4 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                    <Select
                      placeholder="Lọc theo tòa"
                      allowClear
                      style={{ width: 170 }}
                      value={apartmentFilter.buildingId}
                      onChange={(val) =>
                        setApartmentFilter((prev) => ({ ...prev, page: 1, buildingId: val }))
                      }
                    >
                      {buildings.map((b) => (
                        <Select.Option key={b._id} value={b._id}>
                          {b.name} ({b.code})
                        </Select.Option>
                      ))}
                    </Select>

                    <Select
                      placeholder="Trạng thái"
                      allowClear
                      style={{ width: 150 }}
                      value={apartmentFilter.status}
                      onChange={(val) =>
                        setApartmentFilter((prev) => ({ ...prev, page: 1, status: val }))
                      }
                    >
                      {Object.entries(APARTMENT_STATUS).map(([key, item]) => (
                        <Select.Option key={key} value={key}>
                          {item.label}
                        </Select.Option>
                      ))}
                    </Select>

                    <InputNumber
                      placeholder="Tầng"
                      min={1}
                      style={{ width: 100 }}
                      value={apartmentFilter.floor}
                      onChange={(val) =>
                        setApartmentFilter((prev) => ({ ...prev, page: 1, floor: val }))
                      }
                    />

                    <Input
                      placeholder="Tìm mã căn (vd: A-101)..."
                      prefix={<SearchOutlined />}
                      allowClear
                      style={{ width: 220 }}
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      onPressEnter={() =>
                        setApartmentFilter((prev) => ({ ...prev, page: 1, q: searchInput }))
                      }
                    />

                    <Button
                      type="primary"
                      onClick={() =>
                        setApartmentFilter((prev) => ({ ...prev, page: 1, q: searchInput }))
                      }
                    >
                      Tìm kiếm
                    </Button>

                    <Button
                      onClick={() => {
                        setSearchInput('');
                        setApartmentFilter({
                          page: 1,
                          limit: 10,
                          buildingId: undefined,
                          floor: undefined,
                          status: undefined,
                          q: '',
                        });
                      }}
                    >
                      Đặt lại
                    </Button>
                  </div>

                  <Table
                    columns={apartmentColumns}
                    dataSource={apartments}
                    rowKey="_id"
                    loading={loadingApartments}
                    pagination={{
                      current: apartmentsPagination?.page || 1,
                      pageSize: apartmentsPagination?.limit || 10,
                      total: apartmentsPagination?.total || 0,
                      showTotal: (total) => `Tổng cộng ${total} căn hộ`,
                      onChange: (page, limit) =>
                        setApartmentFilter((prev) => ({ ...prev, page, limit })),
                    }}
                  />
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* Modal Thêm / Sửa Tòa nhà */}
      <Modal
        title={editingBuilding ? 'Chỉnh sửa tòa nhà' : 'Thêm tòa nhà mới'}
        open={buildingModalOpen}
        onCancel={() => setBuildingModalOpen(false)}
        onOk={handleSaveBuilding}
        confirmLoading={submittingBuilding}
        destroyOnClose
      >
        <Form form={buildingForm} layout="vertical" className="mt-4">
          <Form.Item
            name="code"
            label="Mã tòa"
            rules={[
              { required: true, message: 'Vui lòng nhập mã tòa nhà' },
              { pattern: /^[A-Za-z0-9_-]+$/, message: 'Mã tòa chỉ gồm chữ cái và số' },
            ]}
            extra={
              editingBuilding && editingBuilding.apartmentCount > 0
                ? 'Không thể đổi mã tòa khi tòa đã có căn hộ'
                : 'Mã tòa sẽ được tự động viết hoa (vd: A, B, T1)'
            }
          >
            <Input
              placeholder="Vd: A"
              disabled={Boolean(editingBuilding && editingBuilding.apartmentCount > 0)}
            />
          </Form.Item>

          <Form.Item
            name="name"
            label="Tên tòa nhà"
            rules={[{ required: true, message: 'Vui lòng nhập tên tòa nhà' }]}
          >
            <Input placeholder="Vd: Tòa A - Diamond" />
          </Form.Item>

          <Form.Item name="address" label="Địa chỉ">
            <Input placeholder="Vd: Số 123 Đường Nguyễn Trãi..." />
          </Form.Item>

          <Form.Item
            name="totalFloors"
            label="Tổng số tầng"
            rules={[
              { required: true, message: 'Vui lòng nhập tổng số tầng' },
              { type: 'number', min: 1, message: 'Số tầng tối thiểu là 1' },
            ]}
          >
            <InputNumber min={1} max={200} style={{ width: '100%' }} placeholder="Vd: 25" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal Thêm / Sửa Căn hộ */}
      <Modal
        title={editingApartment ? `Chỉnh sửa căn hộ ${editingApartment.code}` : 'Thêm căn hộ mới'}
        open={apartmentModalOpen}
        onCancel={() => setApartmentModalOpen(false)}
        onOk={handleSaveApartment}
        confirmLoading={submittingApartment}
        destroyOnClose
      >
        <Alert
          message="Quy tắc trạng thái"
          description="Căn hộ mới tạo luôn có trạng thái mặc định là 'Trống' (VACANT). Trạng thái căn hộ chỉ được tự động cập nhật khi có Hợp đồng mua bán hoặc cho thuê."
          type="info"
          showIcon
          className="mb-4"
        />

        <Form form={apartmentForm} layout="vertical">
          <Form.Item
            name="buildingId"
            label="Tòa nhà"
            rules={[{ required: true, message: 'Vui lòng chọn tòa nhà' }]}
          >
            <Select placeholder="Chọn tòa nhà" disabled={Boolean(editingApartment)}>
              {buildings.map((b) => (
                <Select.Option key={b._id} value={b._id}>
                  {b.name} ({b.code}) — {b.totalFloors} tầng
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="code"
            label="Mã căn hộ"
            rules={[{ required: true, message: 'Vui lòng nhập mã căn hộ' }]}
            extra="Mã căn là duy nhất trong tòa nhà (vd: A-101, B-1204)"
          >
            <Input placeholder="Vd: A-101" />
          </Form.Item>

          <Form.Item
            name="floor"
            label="Tầng"
            rules={[
              { required: true, message: 'Vui lòng nhập tầng' },
              { type: 'number', min: 1, message: 'Tầng tối thiểu là 1' },
            ]}
          >
            <InputNumber min={1} style={{ width: '100%' }} placeholder="Vd: 10" />
          </Form.Item>

          <Form.Item
            name="area"
            label="Diện tích (m²)"
            rules={[
              { required: true, message: 'Vui lòng nhập diện tích' },
              { type: 'number', min: 1, message: 'Diện tích phải lớn hơn 0' },
            ]}
          >
            <InputNumber min={1} step={0.1} style={{ width: '100%' }} placeholder="Vd: 75.5" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal Chi tiết Căn hộ */}
      <Modal
        title={`Chi tiết căn hộ ${selectedApartment?.code || ''}`}
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setDetailModalOpen(false)}>
            Đóng
          </Button>,
        ]}
        width={680}
      >
        {selectedApartment ? (
          <div>
            <Descriptions bordered column={2} size="small" className="mb-4">
              <Descriptions.Item label="Mã căn">
                <span className="font-bold text-blue-600">{selectedApartment.code}</span>
              </Descriptions.Item>
              <Descriptions.Item label="Trạng thái">
                <EnumTag map={APARTMENT_STATUS} value={selectedApartment.status} />
              </Descriptions.Item>
              <Descriptions.Item label="Tòa nhà">
                {selectedApartment.building?.name || selectedApartment.building?.code}
              </Descriptions.Item>
              <Descriptions.Item label="Tầng">{`Tầng ${selectedApartment.floor}`}</Descriptions.Item>
              <Descriptions.Item label="Diện tích">{`${selectedApartment.area} m²`}</Descriptions.Item>
              <Descriptions.Item label="Địa chỉ tòa">
                {selectedApartment.building?.address || '—'}
              </Descriptions.Item>
            </Descriptions>

            <Row gutter={16} className="mb-4">
              <Col span={12}>
                <Card size="small" className="bg-blue-50/50 dark:bg-gray-800">
                  <Statistic
                    title="Cư dân đang ở"
                    value={selectedApartment.activeResidentsCount ?? 0}
                    prefix={<TeamOutlined className="text-blue-500 mr-1" />}
                    suffix="người"
                  />
                </Card>
              </Col>
              <Col span={12}>
                <Card size="small" className="bg-purple-50/50 dark:bg-gray-800">
                  <Statistic
                    title="Phương tiện đã duyệt"
                    value={selectedApartment.approvedVehiclesCount ?? 0}
                    prefix={<CarOutlined className="text-purple-500 mr-1" />}
                    suffix="xe"
                  />
                </Card>
              </Col>
            </Row>

            <div className="font-semibold text-sm mb-2 text-ink dark:text-gray-200 flex items-center gap-1.5">
              <FileTextOutlined className="text-gold" />
              Hợp đồng đang hiệu lực
            </div>
            {selectedApartment.activeContracts && selectedApartment.activeContracts.length > 0 ? (
              <div className="space-y-2">
                {selectedApartment.activeContracts.map((c) => (
                  <Card key={c._id} size="small" className="border-gray-200 dark:border-gray-700">
                    <div className="flex justify-between items-center mb-1">
                      <Space>
                        <EnumTag map={CONTRACT_TYPES} value={c.type} />
                        <EnumTag map={CONTRACT_STATUS} value={c.status} />
                      </Space>
                      {c.tenantPaysFees && <Tag color="orange">Người thuê trả phí</Tag>}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {c.type === 'SALE' ? (
                        <span>Chủ sở hữu: <b>{c.ownerId?.fullName}</b> ({c.ownerId?.email})</span>
                      ) : (
                        <span>
                          Người thuê: <b>{c.tenantId?.fullName}</b> ({c.tenantId?.email})
                        </span>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic">Chưa có hợp đồng nào đang hiệu lực</p>
            )}
          </div>
        ) : (
          <p className="text-center py-4">{loadingDetail ? 'Đang tải...' : 'Không tìm thấy dữ liệu'}</p>
        )}
      </Modal>
    </div>
  );
}

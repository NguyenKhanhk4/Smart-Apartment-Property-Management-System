import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
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
  App,
  Alert,
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
import { APARTMENT_OCCUPANCY, CONTRACT_TYPES, CONTRACT_STATUS } from '../../constants/enums';
import { useAuth } from '../../hooks/useAuth';
import { useApi, useAction } from '../../hooks/useApi';
import { buildingsApi, apartmentsApi } from '../../api/moduleA.api';
import ApartmentOccupancyTag from './ApartmentOccupancyTag';
import FloorPlan from './FloorPlan';
import BuildingInventoryModal from './BuildingInventoryModal';
import ApartmentCorrectionModal from './ApartmentCorrectionModal';
import ApartmentDeleteModal from './ApartmentDeleteModal';
import InventoryHistoryDetail from './InventoryHistoryDetail';
import { handoverDay } from './apartmentOccupancy';

const occupancyOptions = Object.entries(APARTMENT_OCCUPANCY).map(([value, { label }]) => ({ value, label }));

export default function BuildingsPage() {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const { message } = App.useApp();
  const isManager = hasRole('MANAGER');
  const [inventoryModal, setInventoryModal] = useState(null);
  const [correctionApartment, setCorrectionApartment] = useState(null);
  const [deletingApartment, setDeletingApartment] = useState(null);
  const [historyRows, setHistoryRows] = useState(null);
  // Trang chi tiết căn hộ (route apartment-detail) chỉ dành cho Trưởng BQL / Lễ tân
  const canOpenApartment = hasRole('MANAGER', 'STAFF:RECEPTIONIST');

  // Active tab: 'buildings' | 'apartments'
  const [activeTab, setActiveTab] = useState('buildings');
  const [planSelection, setPlanSelection] = useState({ floor: 1 });
  const [occupancyApartment, setOccupancyApartment] = useState(null);
  const [occupancyForm] = Form.useForm();

  // Buildings state & APIs
  const [buildingModalOpen, setBuildingModalOpen] = useState(false);
  const [editingBuilding, setEditingBuilding] = useState(null);
  const [buildingForm] = Form.useForm();

  const {
    data: buildings = [],
    loading: loadingBuildings,
    reload: reloadBuildings,
  } = useApi(buildingsApi.list, []);

  const planBuilding = buildings.find((building) => building._id === planSelection.buildingId) ?? buildings[0];
  const declaredPlanFloors = planBuilding?.floorInventory?.map((row) => row.floor) ?? [];
  const planFloor = declaredPlanFloors.length
    ? (declaredPlanFloors.includes(planSelection.floor) ? planSelection.floor : Math.min(...declaredPlanFloors))
    : Math.min(planSelection.floor, planBuilding?.totalFloors ?? 1);
  const {
    data: planApartments = [], loading: loadingPlan, error: planError, reload: reloadFloorPlan,
  } = useApi(
    () => buildingsApi.floorPlan(planBuilding._id, { floor: planFloor }),
    [planBuilding?._id, planFloor],
    { enabled: activeTab === 'floorPlan' && Boolean(planBuilding) },
  );

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
  const [latestHandoverDay, setLatestHandoverDay] = useState('');
  const [apartmentForm] = Form.useForm();
  const formBuildingId = Form.useWatch('buildingId', apartmentForm);
  const formHandoverDate = Form.useWatch('handoverDate', apartmentForm);
  const formBuilding = buildings.find((building) => building._id === formBuildingId);
  const newApartmentStatus = formHandoverDate && formHandoverDate <= latestHandoverDay
    ? 'VACANT'
    : 'NOT_HANDED_OVER';

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
        ...(apartmentFilter.status ? { occupancyStatus: apartmentFilter.status } : {}),
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

  const refreshCatalog = () => {
    reloadBuildings();
    reloadApartmentViews();
    setInventoryModal(null);
    setCorrectionApartment(null);
    setDeletingApartment(null);
    setDetailModalOpen(false);
  };
  const openInventory = async (building) => {
    if (!building) { setInventoryModal({ building: null }); return; }
    try {
      const result = await buildingsApi.inventory(building._id);
      setInventoryModal({ building: result.data });
    } catch (err) { message.error(err.message); }
  };
  const openCorrection = async (apartment) => {
    try {
      const result = await apartmentsApi.getById(apartment._id);
      setCorrectionApartment(result.data);
    } catch (err) { message.error(err.message); }
  };
  const openHistory = async (building) => {
    try {
      const result = await buildingsApi.inventoryHistory(building._id);
      setHistoryRows(result.data);
    } catch (err) { message.error(err.message); }
  };

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
        reason: '', sourceReference: bldg.inventorySource || '',
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

  const reloadApartmentViews = () => {
    if (activeTab === 'apartments') reloadApartments();
    if (activeTab === 'floorPlan' && planBuilding) reloadFloorPlan();
  };

  const openOccupancyModal = (apartment) => {
    occupancyForm.setFieldsValue({ status: apartment.occupancyStatus, reason: '' });
    setOccupancyApartment(apartment);
  };

  const [saveOccupancy, submittingOccupancy] = useAction(
    (values) => apartmentsApi.setOccupancy(occupancyApartment._id, values),
    {
      success: 'Đã cập nhật trạng thái căn hộ',
      onDone: ({ data }) => {
        const updateStatus = (apartment) => apartment?._id === data._id
          ? { ...apartment, occupancyStatus: data.occupancyStatus }
          : apartment;
        setSelectedApartment(updateStatus);
        setEditingApartment(updateStatus);
        setOccupancyApartment(null);
        reloadApartmentViews();
      },
    },
  );

  // Actions for Apartment
  const [saveApartment, submittingApartment] = useAction(
    async (values) => {
      const { buildingId, ...properties } = values;
      const body = {
        technicalShaft: properties.technicalShaft,
        handoverDate: properties.handoverDate || null,
      };
      if (editingApartment) {
        if (!editingApartment.type && body.netArea !== undefined && body.netArea !== editingApartment.netArea) {
          body.type = 'RESIDENTIAL';
        }
        return apartmentsApi.update(editingApartment._id, body);
      }
      return apartmentsApi.create({ buildingId, ...body, type: 'RESIDENTIAL' });
    },
    {
      success: () =>
        editingApartment
          ? 'Cập nhật căn hộ thành công'
          : 'Tạo mới căn hộ thành công',
      onDone: () => {
        setApartmentModalOpen(false);
        reloadApartmentViews();
        reloadBuildings();
      },
    },
  );

  const handleOpenApartmentModal = (apt = null) => {
    setEditingApartment(apt);
    setLatestHandoverDay(handoverDay(Date.now()));
    apartmentForm.resetFields();
    if (apt) {
      apartmentForm.setFieldsValue({
        buildingId: apt.buildingId?._id || apt.buildingId,
        code: apt.code,
        floor: apt.floor,
        netArea: apt.managementArea ?? apt.netArea ?? apt.area,
        technicalShaft: apt.technicalShaft,
        handoverDate: handoverDay(apt.handoverDate),
      });
    } else if (activeTab === 'floorPlan') {
      apartmentForm.setFieldsValue({ buildingId: planBuilding?._id, floor: planFloor });
    } else if (apartmentFilter.buildingId) {
      apartmentForm.setFieldValue('buildingId', apartmentFilter.buildingId);
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
    setSelectedApartment(null);
    setLoadingDetail(true);
    setDetailModalOpen(true);
    try {
      const res = await apartmentsApi.getById(id);
      setSelectedApartment(res.data);
    } catch (err) {
      message.error(err?.message || 'Không thể tải chi tiết căn hộ');
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
      width: 100,
      render: (count) => <Badge count={count ?? 0} showZero overflowCount={999} style={{ backgroundColor: '#108ee9' }} />,
    },
    { title: 'Danh mục', key: 'inventory', width: 175,
      render: (_, record) => <Space orientation="vertical" size={2}>
        <Tag color={record.inventoryConfirmedAt ? 'green' : 'orange'}>{record.inventoryConfirmedAt ? 'Đã đối chiếu' : 'Cần rà soát'}</Tag>
        {record.inventoryConfirmedAt && <span className="text-xs text-gray-500">{new Date(record.inventoryConfirmedAt).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</span>}
      </Space> },
    ...(isManager
      ? [
          {
            title: 'Thao tác',
            key: 'action',
            width: 330,
            render: (_, record) => (
              <Space wrap>
                <Button size="small" type="link" onClick={() => openInventory(record)}>Đối chiếu danh mục</Button>
                <Button size="small" type="text" onClick={() => openHistory(record)}>Lịch sử</Button>
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
                  onConfirm={() => deleteBuilding(record._id).catch(() => {})}
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
      render: (code, record) =>
        canOpenApartment ? (
          <button
            type="button"
            onClick={() => navigate(`/app/apartments/${record._id}`)}
            className="font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer bg-transparent border-0 p-0 text-left"
          >
            {code}
          </button>
        ) : (
          <span className="font-semibold">{code}</span>
        ),
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
      title: 'Diện tích tính phí quản lý',
      dataIndex: 'managementArea',
      key: 'managementArea',
      width: 160,
      render: (area) => (area != null ? `${area} m²` : '—'),
    },
    {
      title: 'Trạng thái căn hộ',
      dataIndex: 'occupancyStatus',
      key: 'occupancyStatus',
      width: 180,
      render: (status) => <ApartmentOccupancyTag status={status} />,
    },
    {
      title: 'Thao tác',
      key: 'action',
      width: 290,
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
          {isManager && (
            <>
              <Button
                size="small"
                type="text"
                icon={<EditOutlined />}
                onClick={() => handleOpenApartmentModal(record)}
              >
                Sửa
              </Button>
              <Button size="small" type="text" onClick={() => openCorrection(record)}>Điều chỉnh</Button>
              <Popconfirm
                title="Xóa căn hộ"
                description={`Bạn có chắc muốn xóa căn ${record.code}?`}
                okText="Xóa"
                cancelText="Hủy"
                okButtonProps={{ danger: true }}
                onConfirm={() => setDeletingApartment(record)}
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
        subtitle="Thiết lập danh mục theo hồ sơ tiếp nhận và theo dõi tình trạng sử dụng"
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Tòa nhà & Căn hộ' }]}
        extra={
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                reloadBuildings();
                reloadApartmentViews();
              }}
            >
              Làm mới
            </Button>
            {isManager && activeTab === 'buildings' && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => openInventory(null)}
              >
                Thiết lập tòa nhà
              </Button>
            )}
            {isManager && activeTab !== 'buildings' && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  const building = activeTab === 'floorPlan' ? planBuilding : buildings.find((row) => row._id === apartmentFilter.buildingId);
                  if (building) openInventory(building);
                  else message.info('Chọn tòa nhà trước, sau đó đối chiếu danh mục để bổ sung căn hộ.');
                }}
              >
                Bổ sung căn theo hồ sơ
              </Button>
            )}
          </Space>
        }
      />

      {isManager && buildings.some((row) => !row.inventoryConfirmedAt) && <Alert className="mb-4" type="info" showIcon
        title="Danh mục cũ cần rà soát theo hồ sơ"
        description="Mở Đối chiếu danh mục ở từng tòa để xác nhận tầng, mã căn và diện tích. Các hồ sơ hiện có được giữ nguyên." />}
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
                  scroll={{ x: 1150 }}
                />
              ),
            },
            {
              key: 'floorPlan',
              label: 'Sơ đồ tòa nhà',
              children: (
                <FloorPlan
                  buildings={buildings}
                  building={planBuilding}
                  selection={{ buildingId: planBuilding?._id, floor: planFloor }}
                  onSelect={setPlanSelection}
                  apartments={planApartments}
                  loading={loadingPlan}
                  error={planError}
                  onOpen={handleViewApartmentDetail}
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
                        setApartmentFilter((prev) => ({ ...prev, page: 1, buildingId: val, floor: undefined }))
                      }
                    >
                      {buildings.map((b) => (
                        <Select.Option key={b._id} value={b._id}>
                          {b.name} ({b.code})
                        </Select.Option>
                      ))}
                    </Select>

                    <Select
                      placeholder="Trạng thái căn hộ"
                      allowClear
                      style={{ width: 150 }}
                      value={apartmentFilter.status}
                      onChange={(val) =>
                        setApartmentFilter((prev) => ({ ...prev, page: 1, status: val }))
                      }
                    >
                      {occupancyOptions.map(({ value, label }) => (
                        <Select.Option key={value} value={value}>{label}</Select.Option>
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

      {inventoryModal && <BuildingInventoryModal building={inventoryModal.building} onClose={() => setInventoryModal(null)} onSaved={refreshCatalog} />}
      {correctionApartment && <ApartmentCorrectionModal apartment={correctionApartment} onClose={() => setCorrectionApartment(null)} onSaved={refreshCatalog} />}
      {deletingApartment && <ApartmentDeleteModal apartment={deletingApartment} onClose={() => setDeletingApartment(null)} onSaved={refreshCatalog} />}
      <Modal title="Lịch sử danh mục và điều chỉnh căn hộ (100 lượt gần nhất)" open={historyRows !== null} width={1000}
        onCancel={() => setHistoryRows(null)} footer={<Button onClick={() => setHistoryRows(null)}>Đóng</Button>}>
        <Table size="small" rowKey="_id" dataSource={historyRows || []} pagination={{ pageSize: 8 }}
          expandable={{ expandedRowRender: (row) => <InventoryHistoryDetail metadata={row.metadata} /> }}
          columns={[
            { title: 'Thời điểm', dataIndex: 'createdAt', render: (value) => new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) },
            { title: 'Người thực hiện', dataIndex: 'performedBy', render: (value) => value?.fullName || 'Hệ thống' },
            { title: 'Thao tác', render: (_, row) => ({ INVENTORY_CREATED: 'Thiết lập danh mục', INVENTORY_CONFIRMED: 'Đối chiếu danh mục cũ',
              INVENTORY_REVISED: 'Bổ sung / điều chỉnh danh mục', CATALOG_CORRECTED: 'Điều chỉnh thông tin căn', DELETE: 'Xóa bản ghi nhập nhầm', UPDATE: 'Cập nhật thông tin' }[row.metadata?.action] || 'Cập nhật nghiệp vụ') },
            { title: 'Lý do', render: (_, row) => row.metadata?.reason || '—' },
            { title: 'Tài liệu đối chiếu', render: (_, row) => row.metadata?.sourceReference || '—' },
          ]} />
      </Modal>
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
            <InputNumber disabled={Boolean(editingBuilding?.inventoryConfirmedAt)} min={1} max={200} style={{ width: '100%' }} placeholder="Vd: 25" />
          </Form.Item>
          {editingBuilding?.inventoryConfirmedAt && <p className="text-gray-500 mb-4">Số tầng được điều chỉnh trong Đối chiếu danh mục.</p>}
          <Form.Item name="reason" label="Lý do cập nhật" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={2} maxLength={500} /></Form.Item>
          <Form.Item name="sourceReference" label="Tài liệu đối chiếu" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={2} maxLength={500} /></Form.Item>
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
        <Form form={apartmentForm} layout="vertical">
          <Form.Item label={editingApartment ? 'Trạng thái căn hộ hiện tại' : 'Trạng thái khi lưu'}>
            <Space wrap>
              <ApartmentOccupancyTag
                status={editingApartment ? editingApartment.occupancyStatus : newApartmentStatus}
              />
              {editingApartment?.handoverDate && (
                <Button size="small" onClick={() => openOccupancyModal(editingApartment)}>
                  Đổi trạng thái
                </Button>
              )}
            </Space>
          </Form.Item>

          <Form.Item
            name="buildingId"
            label="Tòa nhà"
            rules={[{ required: true, message: 'Vui lòng chọn tòa nhà' }]}
          >
            <Select
              placeholder="Chọn tòa nhà"
              disabled={Boolean(editingApartment)}
              onChange={() => apartmentForm.setFieldValue('floor', undefined)}
            >
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
            <Input disabled={Boolean(editingApartment)} placeholder="Vd: A-101" />
          </Form.Item>

          <Form.Item
            name="floor"
            label="Tầng"
            rules={[
              { required: true, message: 'Vui lòng nhập tầng' },
              { type: 'number', min: 1, message: 'Tầng tối thiểu là 1' },
            ]}
          >
            <InputNumber disabled={Boolean(editingApartment)} min={1} max={formBuilding?.totalFloors} precision={0} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="netArea"
            label="Diện tích tính phí quản lý (m²)"
            rules={[
              {
                required: !editingApartment || editingApartment.netArea != null,
                message: 'Vui lòng nhập diện tích tính phí quản lý',
              },
              { type: 'number', min: 1, message: 'Diện tích phải từ 1 m² trở lên' },
              ...(editingApartment?.grossArea != null ? [{
                type: 'number',
                max: editingApartment.grossArea,
                message: `Diện tích tính phí quản lý không được vượt quá ${editingApartment.grossArea} m²`,
              }] : []),
            ]}
          >
            <InputNumber disabled={Boolean(editingApartment)} min={1} step={0.1} className="!w-full" />
          </Form.Item>
          <p className="text-gray-500 mb-3">Dùng nút Điều chỉnh trong danh sách căn để sửa mã, tầng hoặc diện tích có căn cứ.</p>
          <Form.Item name="technicalShaft" label="Vị trí hộp kỹ thuật điện/nước">
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="handoverDate" label="Ngày bàn giao thực tế"
            extra="Để trống nếu căn mới chưa bàn giao."
            rules={[{ required: Boolean(editingApartment?.handoverDate), message: 'Vui lòng giữ ngày bàn giao đã ghi nhận' }]}
          >
            <Input type="date" max={latestHandoverDay} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Đổi trạng thái căn ${occupancyApartment?.code ?? ''}`}
        open={Boolean(occupancyApartment)}
        onCancel={() => setOccupancyApartment(null)}
        onOk={() => occupancyForm.submit()}
        confirmLoading={submittingOccupancy}
      >
        <Form form={occupancyForm} layout="vertical" onFinish={(values) => saveOccupancy(values).catch(() => {})}>
          <Form.Item name="status" label="Trạng thái mới" rules={[{ required: true }]}>
            <Select options={occupancyOptions.filter(({ value }) => value !== 'NOT_HANDED_OVER')} />
          </Form.Item>
          <Form.Item name="reason" label="Lý do điều chỉnh" rules={[
            { required: true, whitespace: true, message: 'Vui lòng nhập lý do điều chỉnh' },
          ]}>
            <Input.TextArea maxLength={500} rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal Chi tiết Căn hộ */}
      <Modal
        title={`Chi tiết căn hộ ${selectedApartment?.code || ''}`}
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={[
          isManager && selectedApartment && (
            <Button key="edit" onClick={() => {
              setDetailModalOpen(false);
              handleOpenApartmentModal(selectedApartment);
            }}>
              Sửa thông tin
            </Button>
          ),
          isManager && selectedApartment?.handoverDate && (
            <Button key="status" onClick={() => openOccupancyModal(selectedApartment)}>
              Đổi trạng thái
            </Button>
          ),
          canOpenApartment && selectedApartment && (
            <Button
              key="manage"
              type="primary"
              icon={<TeamOutlined />}
              onClick={() => {
                setDetailModalOpen(false);
                navigate(`/app/apartments/${selectedApartment?._id}`);
              }}
            >
              Quản lý nhân khẩu & Hợp đồng
            </Button>
          ),
          <Button key="close" onClick={() => setDetailModalOpen(false)}>
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
              <Descriptions.Item label="Trạng thái căn hộ">
                <ApartmentOccupancyTag status={selectedApartment.occupancyStatus} />
              </Descriptions.Item>
              <Descriptions.Item label="Tòa nhà">
                {selectedApartment.building?.name || selectedApartment.building?.code}
              </Descriptions.Item>
              <Descriptions.Item label="Tầng">{`Tầng ${selectedApartment.floor}`}</Descriptions.Item>
              <Descriptions.Item label="Diện tích tính phí quản lý">
                {selectedApartment.managementArea != null ? `${selectedApartment.managementArea} m²` : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Ngày bàn giao">
                {handoverDay(selectedApartment.handoverDate).split('-').reverse().join('/') || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Hộp kỹ thuật">{selectedApartment.technicalShaft || '—'}</Descriptions.Item>
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

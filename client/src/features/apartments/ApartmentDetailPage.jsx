import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import {
  Card,
  Tabs,
  Table,
  Button,
  Modal,
  Form,
  Input,
  DatePicker,
  Tag,
  Space,
  Popconfirm,
  Row,
  Col,
  Statistic,
  Descriptions,
  Empty,
  Badge,
  Tooltip,
} from 'antd';
import {
  ArrowLeftOutlined,
  TeamOutlined,
  FileTextOutlined,
  CarOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CrownOutlined,
  BankOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import PageHeader from '../../components/PageHeader';
import EnumTag from '../../components/EnumTag';
import {
  APARTMENT_STATUS,
  CONTRACT_TYPES,
  CONTRACT_STATUS,
  RELATION_TYPES,
  VEHICLE_STATUS,
  VEHICLE_TYPES,
} from '../../constants/enums';
import { formatDate } from '../../utils/format';
import { useAuth } from '../../hooks/useAuth';
import { useApi, useAction } from '../../hooks/useApi';
import { apartmentsApi, contractsApi, residentsApi, vehicleApi } from '../../api/moduleA.api';

export default function ApartmentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const isReceptionist = user?.role === 'STAFF' && user?.roleTitle === 'RECEPTIONIST';

  // Load apartment details
  const {
    data: apartment,
    loading: loadingApt,
    reload: reloadApt,
  } = useApi(() => apartmentsApi.getById(id), [id]);

  // Load residents list
  const {
    data: residents = [],
    loading: loadingResidents,
    reload: reloadResidents,
  } = useApi(() => residentsApi.listByApartment(id), [id]);

  // Load contracts list
  const {
    data: contractsData,
    loading: loadingContracts,
    reload: reloadContracts,
  } = useApi(() => contractsApi.list({ apartmentId: id, limit: 50 }), [id]);
  const contracts = contractsData || [];

  // Load vehicles list
  const {
    data: vehiclesData,
    loading: loadingVehicles,
    reload: reloadVehicles,
  } = useApi(() => vehicleApi.list({ apartmentId: id, limit: 100 }), [id]);
  const vehicles = vehiclesData?.items || vehiclesData || [];

  // Modal Thêm thành viên
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addForm] = Form.useForm();

  const [addMemberAction, addingMember] = useAction(
    async (values) => {
      const payload = {
        apartmentId: id,
        email: values.email,
        fullName: values.fullName,
        phone: values.phone || null,
        idNumber: values.idNumber || null,
        dateOfBirth: values.dateOfBirth ? values.dateOfBirth.format('YYYY-MM-DD') : null,
      };
      return residentsApi.addMember(payload);
    },
    {
      success: (res) => {
        if (res?.data?.temporaryPassword) {
          return `Thêm thành viên thành công! Mật khẩu tạm của cư dân: ${res.data.temporaryPassword}`;
        }
        return 'Thêm thành viên vào căn hộ thành công';
      },
      onDone: () => {
        setAddModalOpen(false);
        addForm.resetFields();
        reloadResidents();
        reloadApt();
      },
    },
  );

  // Modal Sửa thành viên (CCCD, ngày sinh)
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingResident, setEditingResident] = useState(null);
  const [editForm] = Form.useForm();

  const [updateMemberAction, updatingMember] = useAction(
    async (values) => {
      const payload = {
        idNumber: values.idNumber || '',
        dateOfBirth: values.dateOfBirth ? values.dateOfBirth.format('YYYY-MM-DD') : null,
      };
      return residentsApi.updateMember(editingResident._id, payload);
    },
    {
      success: 'Cập nhật thông tin thành viên thành công',
      onDone: () => {
        setEditModalOpen(false);
        setEditingResident(null);
        editForm.resetFields();
        reloadResidents();
      },
    },
  );

  // Gỡ thành viên
  const [removeMemberAction] = useAction(
    async (residentId) => residentsApi.removeMember(residentId),
    {
      success: 'Đã gỡ thành viên khỏi căn hộ thành công',
      onDone: () => {
        reloadResidents();
        reloadApt();
      },
    },
  );

  const handleOpenEditModal = (record) => {
    setEditingResident(record);
    editForm.setFieldsValue({
      idNumber: record.idNumber || '',
      dateOfBirth: record.dateOfBirth ? dayjs(record.dateOfBirth) : null,
    });
    setEditModalOpen(true);
  };

  // Cột bảng thành viên
  const residentColumns = [
    {
      title: 'Họ và tên',
      key: 'name',
      render: (_, r) => (
        <div>
          <Space>
            <span className="font-semibold text-gray-800 dark:text-gray-100">{r.fullName}</span>
            {r.isHead && (
              <Tag color="gold" icon={<CrownOutlined />}>
                Chủ hộ
              </Tag>
            )}
          </Space>
          <div className="text-xs text-gray-400">{r.email}</div>
        </div>
      ),
    },
    {
      title: 'Quan hệ',
      dataIndex: 'relationType',
      key: 'relationType',
      width: 140,
      render: (val) => <EnumTag map={RELATION_TYPES} value={val} />,
    },
    {
      title: 'Số điện thoại',
      dataIndex: 'phone',
      key: 'phone',
      width: 130,
      render: (val) => val || '—',
    },
    {
      title: 'Ngày sinh',
      dataIndex: 'dateOfBirth',
      key: 'dateOfBirth',
      width: 120,
      render: (val) => formatDate(val) || '—',
    },
    {
      title: 'Số CCCD',
      dataIndex: 'idNumber',
      key: 'idNumber',
      width: 150,
      render: (val) => (val ? <code className="text-xs">{val}</code> : '—'),
    },
    {
      title: 'Ngày dọn vào',
      dataIndex: 'moveInDate',
      key: 'moveInDate',
      width: 130,
      render: (val) => formatDate(val) || '—',
    },
    ...(isReceptionist
      ? [
          {
            title: 'Thao tác',
            key: 'actions',
            width: 120,
            align: 'right',
            render: (_, r) => (
              <Space size="small">
                <Tooltip title="Sửa CCCD / Ngày sinh">
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => handleOpenEditModal(r)}
                  />
                </Tooltip>
                {r.relationType === 'FAMILY_MEMBER' ? (
                  <Popconfirm
                    title="Gỡ thành viên"
                    description={`Bạn có chắc chắn muốn gỡ ${r.fullName} khỏi căn hộ?`}
                    onConfirm={() => removeMemberAction(r._id)}
                    okText="Gỡ"
                    cancelText="Hủy"
                    okButtonProps={{ danger: true }}
                  >
                    <Tooltip title="Gỡ khỏi căn hộ">
                      <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                    </Tooltip>
                  </Popconfirm>
                ) : (
                  <Tooltip title="Hãy chấm dứt hợp đồng để gỡ chủ sở hữu / người thuê">
                    <Button type="text" size="small" disabled icon={<DeleteOutlined />} />
                  </Tooltip>
                )}
              </Space>
            ),
          },
        ]
      : []),
  ];

  // Cột bảng hợp đồng
  const contractColumns = [
    {
      title: 'Loại hợp đồng',
      dataIndex: 'type',
      key: 'type',
      width: 150,
      render: (val) => <EnumTag map={CONTRACT_TYPES} value={val} />,
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 140,
      render: (val) => <EnumTag map={CONTRACT_STATUS} value={val} />,
    },
    {
      title: 'Người đứng tên',
      key: 'person',
      render: (_, c) =>
        c.type === 'SALE' ? (
          <div>
            <span className="font-medium text-gray-800 dark:text-gray-100">
              {c.ownerId?.fullName || '—'}
            </span>
            <div className="text-xs text-gray-400">Chủ sở hữu • {c.ownerId?.email}</div>
          </div>
        ) : (
          <div>
            <span className="font-medium text-gray-800 dark:text-gray-100">
              {c.tenantId?.fullName || '—'}
            </span>
            <div className="text-xs text-gray-400">
              Người thuê • {c.tenantId?.email}
              {c.tenantPaysFees && (
                <Tag color="orange" className="ml-1 text-[10px]">
                  Trả phí DV
                </Tag>
              )}
            </div>
          </div>
        ),
    },
    {
      title: 'Thời hạn',
      key: 'duration',
      render: (_, c) => (
        <span>
          {formatDate(c.startDate)} ➔ {c.endDate ? formatDate(c.endDate) : 'Vô thời hạn'}
        </span>
      ),
    },
  ];

  // Cột bảng phương tiện
  const vehicleColumns = [
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
        <span className="font-semibold text-gray-800 dark:text-gray-100">
          {val || (r.type === 'BICYCLE' ? <i className="text-gray-400 font-normal">Không biển số</i> : '—')}
        </span>
      ),
    },
    {
      title: 'Hãng / Màu',
      key: 'details',
      width: 150,
      render: (_, r) => [r.brand, r.color].filter(Boolean).join(' • ') || '—',
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
      render: (_, r) => r.registeredBy?.fullName || '—',
    },
    {
      title: 'Ngày duyệt',
      dataIndex: 'approvedAt',
      key: 'approvedAt',
      width: 140,
      render: (val) => (val ? formatDate(val) : '—'),
    },
  ];

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="mb-4">
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/app/buildings')}
          className="mb-2"
        >
          Quay lại danh sách
        </Button>
        <PageHeader
          title={`Chi tiết căn hộ ${apartment?.code || ''}`}
          subtitle={`${apartment?.building?.name || ''} • Tầng ${apartment?.floor || ''} • ${apartment?.area || 0} m²`}
          extra={
            <Space>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  reloadApt();
                  reloadResidents();
                  reloadContracts();
                  reloadVehicles();
                }}
              >
                Làm mới
              </Button>
            </Space>
          }
        />
      </div>

      {/* Thông tin tổng quan căn hộ */}
      <Card loading={loadingApt} className="mb-6 shadow-sm border border-gray-100 dark:border-gray-800">
        <Row gutter={[24, 16]} align="middle">
          <Col xs={24} sm={12} md={5}>
            <Statistic
              title="Trạng thái căn"
              valueRender={() => (
                <div className="mt-1">
                  <EnumTag map={APARTMENT_STATUS} value={apartment?.status} />
                </div>
              )}
            />
          </Col>
          <Col xs={12} sm={6} md={5}>
            <Statistic
              title="Cư dân đang ở"
              value={residents.length}
              prefix={<TeamOutlined className="text-blue-500 mr-1" />}
              suffix="người"
            />
          </Col>
          <Col xs={12} sm={6} md={5}>
            <Statistic
              title="Hợp đồng"
              value={contracts.length}
              prefix={<FileTextOutlined className="text-gold mr-1" />}
              suffix="HĐ"
            />
          </Col>
          <Col xs={12} sm={6} md={5}>
            <Statistic
              title="Phương tiện"
              value={vehicles.length}
              prefix={<CarOutlined className="text-green-500 mr-1" />}
              suffix="xe"
            />
          </Col>
          <Col xs={12} sm={6} md={4}>
            <Statistic
              title="Diện tích"
              value={apartment?.area || 0}
              suffix="m²"
            />
          </Col>
        </Row>
      </Card>

      {/* Tabs Thành viên / Hợp đồng / Phương tiện */}
      <Card className="shadow-sm border border-gray-100 dark:border-gray-800">
        <Tabs
          defaultActiveKey="residents"
          items={[
            {
              key: 'residents',
              label: (
                <span>
                  <TeamOutlined /> Thành viên ({residents.length})
                </span>
              ),
              children: (
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <div className="text-sm text-gray-500">
                      Danh sách nhân khẩu đang sinh sống thực tế tại căn hộ
                    </div>
                    {isReceptionist && apartment?.status !== 'VACANT' && (
                      <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={() => setAddModalOpen(true)}
                      >
                        Thêm thành viên
                      </Button>
                    )}
                  </div>
                  <Table
                    columns={residentColumns}
                    dataSource={residents}
                    rowKey="_id"
                    loading={loadingResidents}
                    pagination={false}
                    locale={{ emptyText: 'Chưa có thành viên nào trong căn hộ' }}
                  />
                </div>
              ),
            },
            {
              key: 'contracts',
              label: (
                <span>
                  <FileTextOutlined /> Hợp đồng ({contracts.length})
                </span>
              ),
              children: (
                <div>
                  <Table
                    columns={contractColumns}
                    dataSource={contracts}
                    rowKey="_id"
                    loading={loadingContracts}
                    pagination={false}
                    locale={{ emptyText: 'Chưa có hợp đồng nào cho căn hộ này' }}
                  />
                </div>
              ),
            },
            {
              key: 'vehicles',
              label: (
                <span>
                  <CarOutlined /> Phương tiện ({vehicles.length})
                </span>
              ),
              children: (
                <div>
                  <Table
                    columns={vehicleColumns}
                    dataSource={vehicles}
                    rowKey="_id"
                    loading={loadingVehicles}
                    pagination={false}
                    locale={{ emptyText: 'Chưa có phương tiện nào đăng ký cho căn hộ này' }}
                  />
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* Modal Thêm thành viên */}
      <Modal
        title={`Thêm thành viên vào căn hộ ${apartment?.code || ''}`}
        open={addModalOpen}
        onCancel={() => setAddModalOpen(false)}
        onOk={() => addForm.submit()}
        confirmLoading={addingMember}
        destroyOnClose
      >
        <Form form={addForm} layout="vertical" onFinish={addMemberAction} className="mt-4">
          <Form.Item
            name="email"
            label="Email tài khoản"
            rules={[
              { required: true, message: 'Vui lòng nhập email' },
              { type: 'email', message: 'Email không đúng định dạng' },
            ]}
          >
            <Input placeholder="Vd: member@gmail.com" />
          </Form.Item>

          <Form.Item
            name="fullName"
            label="Họ và tên"
            rules={[{ required: true, message: 'Vui lòng nhập họ và tên' }]}
          >
            <Input placeholder="Vd: Nguyễn Văn Thành" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="phone" label="Số điện thoại">
                <Input placeholder="0912345678" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="idNumber" label="Số CCCD">
                <Input placeholder="001200000003" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="dateOfBirth" label="Ngày sinh">
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" placeholder="Chọn ngày sinh" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal Sửa CCCD / Ngày sinh */}
      <Modal
        title={`Cập nhật thông tin: ${editingResident?.fullName || ''}`}
        open={editModalOpen}
        onCancel={() => setEditModalOpen(false)}
        onOk={() => editForm.submit()}
        confirmLoading={updatingMember}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical" onFinish={updateMemberAction} className="mt-4">
          <Form.Item name="idNumber" label="Số CCCD">
            <Input placeholder="Nhập số CCCD mới" />
          </Form.Item>

          <Form.Item name="dateOfBirth" label="Ngày sinh">
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" placeholder="Chọn ngày sinh" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

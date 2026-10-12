import { useState } from 'react';
import {
  Table,
  Card,
  Button,
  Select,
  DatePicker,
  Switch,
  Modal,
  Form,
  Input,
  Tag,
  Space,
  Popconfirm,
  Row,
  Col,
  Descriptions,
  Alert,
  Upload,
  Radio,
  App,
  Tooltip,
} from 'antd';
import {
  FileTextOutlined,
  PlusOutlined,
  ReloadOutlined,
  EyeOutlined,
  CalendarOutlined,
  StopOutlined,
  UploadOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import PageHeader from '../../components/PageHeader';
import EnumTag from '../../components/EnumTag';
import { CONTRACT_TYPES, CONTRACT_STATUS } from '../../constants/enums';
import { formatDate } from '../../utils/format';
import { useAuth } from '../../hooks/useAuth';
import { useApi, useAction } from '../../hooks/useApi';
import { contractsApi, buildingsApi, apartmentsApi } from '../../api/moduleA.api';

export default function ContractsPage() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const isReceptionist = user?.role === 'STAFF' && user?.roleTitle === 'RECEPTIONIST';

  // Filters state
  const [filters, setFilters] = useState({
    page: 1,
    limit: 10,
    buildingId: undefined,
    apartmentId: undefined,
    type: undefined,
    status: undefined,
    endingWithinDays: undefined,
  });

  // Load buildings for filter & form
  const { data: buildings = [] } = useApi(buildingsApi.list, []);

  // Load apartments for apartment selection dropdown
  const { data: allApartments = [] } = useApi(
    () => apartmentsApi.list({ limit: 100 }),
    [],
  );

  // Load contracts list
  const {
    data: contracts = [],
    pagination,
    loading,
    reload: reloadContracts,
  } = useApi(
    () =>
      contractsApi.list({
        page: filters.page,
        limit: filters.limit,
        ...(filters.buildingId ? { buildingId: filters.buildingId } : {}),
        ...(filters.apartmentId ? { apartmentId: filters.apartmentId } : {}),
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.endingWithinDays !== undefined
          ? { endingWithinDays: filters.endingWithinDays }
          : {}),
      }),
    [filters],
  );

  // Modal Create state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm] = Form.useForm();
  const selectedType = Form.useWatch('type', createForm);
  const [contractFileList, setContractFileList] = useState([]);

  // Modal Extend/Update state
  const [extendModalOpen, setExtendModalOpen] = useState(false);
  const [extendingContract, setExtendingContract] = useState(null);
  const [extendForm] = Form.useForm();
  const [extendFileList, setExtendFileList] = useState([]);

  // Modal Detail state
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedContract, setSelectedContract] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Actions
  const [createContract, creating] = useAction(
    async (formData) => contractsApi.create(formData),
    {
      success: (res) => {
        if (res?.data?.temporaryPassword) {
          return `Tạo hợp đồng thành công! Mật khẩu tạm của cư dân mới: ${res.data.temporaryPassword}`;
        }
        return 'Tạo hợp đồng thành công';
      },
      onDone: () => {
        setCreateModalOpen(false);
        createForm.resetFields();
        setContractFileList([]);
        reloadContracts();
      },
    },
  );

  const [updateContract, updating] = useAction(
    async ({ id, formData }) => contractsApi.update(id, formData),
    {
      success: 'Cập nhật hợp đồng thành công',
      onDone: () => {
        setExtendModalOpen(false);
        extendForm.resetFields();
        setExtendFileList([]);
        reloadContracts();
      },
    },
  );

  const [terminateContract] = useAction(
    (id) => contractsApi.terminate(id),
    {
      success: 'Đã chấm dứt hợp đồng thành công',
      onDone: reloadContracts,
    },
  );

  // Handlers
  const handleOpenCreateModal = () => {
    createForm.resetFields();
    createForm.setFieldsValue({
      type: CONTRACT_TYPES.SALE,
      startDate: dayjs(),
      tenantPaysFees: false,
    });
    setContractFileList([]);
    setCreateModalOpen(true);
  };

  const handleSaveCreate = async () => {
    try {
      const values = await createForm.validateFields();
      const formData = new FormData();
      formData.append('apartmentId', values.apartmentId);
      formData.append('type', values.type);
      formData.append('startDate', values.startDate.format('YYYY-MM-DD'));
      if (values.endDate) {
        formData.append('endDate', values.endDate.format('YYYY-MM-DD'));
      }
      formData.append('tenantPaysFees', String(Boolean(values.tenantPaysFees)));

      if (values.type === CONTRACT_TYPES.SALE) {
        const ownerData = {
          fullName: values.ownerFullName,
          email: values.ownerEmail,
          phone: values.ownerPhone || '',
          idNumber: values.ownerIdNumber || '',
          dateOfBirth: values.ownerDob ? values.ownerDob.format('YYYY-MM-DD') : null,
        };
        formData.append('owner', JSON.stringify(ownerData));
      } else {
        const tenantData = {
          fullName: values.tenantFullName,
          email: values.tenantEmail,
          phone: values.tenantPhone || '',
          idNumber: values.tenantIdNumber || '',
          dateOfBirth: values.tenantDob ? values.tenantDob.format('YYYY-MM-DD') : null,
        };
        formData.append('tenant', JSON.stringify(tenantData));
      }

      if (contractFileList[0]?.originFileObj) {
        formData.append('file', contractFileList[0].originFileObj);
      }

      await createContract(formData);
    } catch {
      // Form validation error
    }
  };

  const handleOpenExtendModal = (record) => {
    setExtendingContract(record);
    extendForm.setFieldsValue({
      endDate: record.endDate ? dayjs(record.endDate) : null,
      tenantPaysFees: record.tenantPaysFees ?? false,
    });
    setExtendFileList([]);
    setExtendModalOpen(true);
  };

  const handleSaveExtend = async () => {
    try {
      const values = await extendForm.validateFields();
      const formData = new FormData();
      if (values.endDate) {
        formData.append('endDate', values.endDate.format('YYYY-MM-DD'));
      }
      if (extendingContract.type === 'LEASE') {
        formData.append('tenantPaysFees', String(Boolean(values.tenantPaysFees)));
      }
      if (extendFileList[0]?.originFileObj) {
        formData.append('file', extendFileList[0].originFileObj);
      }

      await updateContract({ id: extendingContract._id, formData });
    } catch {
      // Form validation error
    }
  };

  const handleViewDetail = async (id) => {
    setLoadingDetail(true);
    setDetailModalOpen(true);
    try {
      const res = await contractsApi.getById(id);
      setSelectedContract(res.data);
    } catch (err) {
      message.error(err?.response?.data?.message || 'Không thể tải chi tiết hợp đồng');
      setDetailModalOpen(false);
    } finally {
      setLoadingDetail(false);
    }
  };

  // Columns definition
  const columns = [
    {
      title: 'Căn hộ',
      dataIndex: 'apartmentId',
      key: 'apartmentId',
      width: 140,
      render: (apt) => (
        <div>
          <span className="font-semibold text-blue-600 dark:text-blue-400">
            {apt?.code || '—'}
          </span>
          <div className="text-xs text-gray-400">{apt?.buildingId?.name || ''}</div>
        </div>
      ),
    },
    {
      title: 'Loại',
      dataIndex: 'type',
      key: 'type',
      width: 110,
      render: (type) => <EnumTag map={CONTRACT_TYPES} value={type} />,
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 130,
      render: (status) => <EnumTag map={CONTRACT_STATUS} value={status} />,
    },
    {
      title: 'Chủ sở hữu',
      dataIndex: 'ownerId',
      key: 'ownerId',
      render: (owner) =>
        owner ? (
          <div>
            <div className="font-medium text-ink dark:text-gray-200">{owner.fullName}</div>
            <div className="text-xs text-gray-400">{owner.email}</div>
          </div>
        ) : (
          '—'
        ),
    },
    {
      title: 'Người thuê',
      dataIndex: 'tenantId',
      key: 'tenantId',
      render: (tenant) =>
        tenant ? (
          <div>
            <div className="font-medium text-ink dark:text-gray-200">{tenant.fullName}</div>
            <div className="text-xs text-gray-400">{tenant.email}</div>
          </div>
        ) : (
          <span className="text-gray-400 italic">Không có</span>
        ),
    },
    {
      title: 'Thời hạn',
      key: 'period',
      width: 190,
      render: (_, record) => (
        <div className="text-xs">
          <div>Từ: {formatDate(record.startDate)}</div>
          <div>Đến: {record.endDate ? formatDate(record.endDate) : 'Vô thời hạn'}</div>
        </div>
      ),
    },
    {
      title: 'Người trả phí',
      key: 'payer',
      width: 130,
      render: (_, record) =>
        record.type === 'SALE' ? (
          <Tag color="blue">Chủ sở hữu</Tag>
        ) : record.tenantPaysFees ? (
          <Tag color="orange">Người thuê</Tag>
        ) : (
          <Tag color="blue">Chủ sở hữu</Tag>
        ),
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
            onClick={() => handleViewDetail(record._id)}
          >
            Xem
          </Button>
          {isReceptionist && record.status === 'ACTIVE' && (
            <>
              {record.type === 'LEASE' && (
                <Tooltip title="Gia hạn thời hạn hợp đồng">
                  <Button
                    size="small"
                    type="text"
                    icon={<CalendarOutlined />}
                    onClick={() => handleOpenExtendModal(record)}
                  >
                    Gia hạn
                  </Button>
                </Tooltip>
              )}
              <Popconfirm
                title="Chấm dứt hợp đồng"
                description={
                  record.type === 'SALE'
                    ? 'Chấm dứt hợp đồng mua bán sẽ gỡ toàn bộ cư dân và đưa căn hộ về trạng thái Trống. Tiếp tục?'
                    : 'Chấm dứt hợp đồng thuê sẽ gỡ người thuê và đưa căn hộ về trạng thái Đã sở hữu. Tiếp tục?'
                }
                okText="Chấm dứt"
                cancelText="Hủy"
                okButtonProps={{ danger: true }}
                onConfirm={() => terminateContract(record._id)}
              >
                <Button size="small" type="text" danger icon={<StopOutlined />}>
                  Chấm dứt
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
        title="Quản lý hợp đồng"
        subtitle="Quản lý hợp đồng mua bán (SALE) và hợp đồng cho thuê (LEASE) của cư dân"
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Hợp đồng' }]}
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={reloadContracts}>
              Làm mới
            </Button>
            {isReceptionist && (
              <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreateModal}>
                Tạo hợp đồng
              </Button>
            )}
          </Space>
        }
      />

      <Card bordered={false} className="shadow-sm">
        {/* Bộ lọc */}
        <div className="flex flex-wrap gap-3 items-center mb-4 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
          <Select
            placeholder="Tòa nhà"
            allowClear
            style={{ width: 160 }}
            value={filters.buildingId}
            onChange={(val) =>
              setFilters((prev) => ({ ...prev, page: 1, buildingId: val, apartmentId: undefined }))
            }
          >
            {buildings.map((b) => (
              <Select.Option key={b._id} value={b._id}>
                {b.name} ({b.code})
              </Select.Option>
            ))}
          </Select>

          <Select
            placeholder="Căn hộ"
            allowClear
            showSearch
            filterOption={(input, option) =>
              (option?.children ?? '').toLowerCase().includes(input.toLowerCase())
            }
            style={{ width: 140 }}
            value={filters.apartmentId}
            onChange={(val) => setFilters((prev) => ({ ...prev, page: 1, apartmentId: val }))}
          >
            {allApartments.map((a) => (
              <Select.Option key={a._id} value={a._id}>
                {a.code}
              </Select.Option>
            ))}
          </Select>

          <Select
            placeholder="Loại hợp đồng"
            allowClear
            style={{ width: 150 }}
            value={filters.type}
            onChange={(val) => setFilters((prev) => ({ ...prev, page: 1, type: val }))}
          >
            <Select.Option value={CONTRACT_TYPES.SALE}>Mua bán (SALE)</Select.Option>
            <Select.Option value={CONTRACT_TYPES.LEASE}>Cho thuê (LEASE)</Select.Option>
          </Select>

          <Select
            placeholder="Trạng thái"
            allowClear
            style={{ width: 160 }}
            value={filters.status}
            onChange={(val) => setFilters((prev) => ({ ...prev, page: 1, status: val }))}
          >
            {Object.entries(CONTRACT_STATUS).map(([key, item]) => (
              <Select.Option key={key} value={key}>
                {item.label}
              </Select.Option>
            ))}
          </Select>

          <Select
            placeholder="Hạn hợp đồng"
            allowClear
            style={{ width: 160 }}
            value={filters.endingWithinDays}
            onChange={(val) => setFilters((prev) => ({ ...prev, page: 1, endingWithinDays: val }))}
          >
            <Select.Option value={30}>Hết hạn trong 30 ngày</Select.Option>
            <Select.Option value={60}>Hết hạn trong 60 ngày</Select.Option>
            <Select.Option value={90}>Hết hạn trong 90 ngày</Select.Option>
          </Select>

          <Button
            onClick={() =>
              setFilters({
                page: 1,
                limit: 10,
                buildingId: undefined,
                apartmentId: undefined,
                type: undefined,
                status: undefined,
                endingWithinDays: undefined,
              })
            }
          >
            Đặt lại
          </Button>
        </div>

        <Table
          columns={columns}
          dataSource={contracts}
          rowKey="_id"
          loading={loading}
          pagination={{
            current: pagination?.page || 1,
            pageSize: pagination?.limit || 10,
            total: pagination?.total || 0,
            showTotal: (total) => `Tổng cộng ${total} hợp đồng`,
            onChange: (page, limit) => setFilters((prev) => ({ ...prev, page, limit })),
          }}
        />
      </Card>

      {/* Modal Tạo Hợp đồng */}
      <Modal
        title="Tạo mới hợp đồng"
        open={createModalOpen}
        onCancel={() => setCreateModalOpen(false)}
        onOk={handleSaveCreate}
        confirmLoading={creating}
        width={680}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical" className="mt-4">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="apartmentId"
                label="Căn hộ"
                rules={[{ required: true, message: 'Vui lòng chọn căn hộ' }]}
              >
                <Select
                  placeholder="Chọn căn hộ"
                  showSearch
                  filterOption={(input, option) =>
                    (option?.children ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                >
                  {allApartments.map((a) => (
                    <Select.Option key={a._id} value={a._id}>
                      {a.code} ({a.buildingId?.name || ''}) — {a.status}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>

            <Col span={12}>
              <Form.Item
                name="type"
                label="Loại hợp đồng"
                rules={[{ required: true, message: 'Vui lòng chọn loại hợp đồng' }]}
              >
                <Radio.Group buttonStyle="solid">
                  <Radio.Button value={CONTRACT_TYPES.SALE}>Mua bán (SALE)</Radio.Button>
                  <Radio.Button value={CONTRACT_TYPES.LEASE}>Cho thuê (LEASE)</Radio.Button>
                </Radio.Group>
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="startDate"
                label="Ngày bắt đầu"
                rules={[{ required: true, message: 'Vui lòng chọn ngày bắt đầu' }]}
              >
                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>

            {selectedType === CONTRACT_TYPES.LEASE && (
              <Col span={12}>
                <Form.Item
                  name="endDate"
                  label="Ngày kết thúc"
                  rules={[{ required: true, message: 'Vui lòng chọn ngày kết thúc' }]}
                >
                  <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
                </Form.Item>
              </Col>
            )}
          </Row>

          {selectedType === CONTRACT_TYPES.LEASE && (
            <Form.Item
              name="tenantPaysFees"
              label="Bên chịu phí dịch vụ"
              valuePropName="checked"
            >
              <Switch
                checkedChildren="Người thuê chịu phí"
                unCheckedChildren="Chủ sở hữu chịu phí"
              />
            </Form.Item>
          )}

          {/* Thông tin Chủ sở hữu khi SALE */}
          {selectedType === CONTRACT_TYPES.SALE && (
            <Card size="small" title="Thông tin Chủ sở hữu" className="mb-4 bg-gray-50/50 dark:bg-gray-800">
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name="ownerFullName"
                    label="Họ và tên"
                    rules={[{ required: true, message: 'Vui lòng nhập họ tên chủ sở hữu' }]}
                  >
                    <Input placeholder="Vd: Nguyễn Văn A" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="ownerEmail"
                    label="Email"
                    rules={[
                      { required: true, message: 'Vui lòng nhập email' },
                      { type: 'email', message: 'Email không hợp lệ' },
                    ]}
                  >
                    <Input placeholder="Vd: nva@gmail.com" />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item name="ownerPhone" label="Số điện thoại">
                    <Input placeholder="0912345678" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="ownerIdNumber" label="Số CCCD">
                    <Input placeholder="001200000001" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="ownerDob" label="Ngày sinh">
                    <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          )}

          {/* Thông tin Người thuê khi LEASE */}
          {selectedType === CONTRACT_TYPES.LEASE && (
            <Card size="small" title="Thông tin Người thuê" className="mb-4 bg-gray-50/50 dark:bg-gray-800">
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name="tenantFullName"
                    label="Họ và tên"
                    rules={[{ required: true, message: 'Vui lòng nhập họ tên người thuê' }]}
                  >
                    <Input placeholder="Vd: Trần Thị B" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="tenantEmail"
                    label="Email"
                    rules={[
                      { required: true, message: 'Vui lòng nhập email' },
                      { type: 'email', message: 'Email không hợp lệ' },
                    ]}
                  >
                    <Input placeholder="Vd: ttb@gmail.com" />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item name="tenantPhone" label="Số điện thoại">
                    <Input placeholder="0987654321" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="tenantIdNumber" label="Số CCCD">
                    <Input placeholder="001200000002" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="tenantDob" label="Ngày sinh">
                    <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          )}

          <Form.Item label="File đính kèm (hợp đồng có chữ ký / công chứng, jpg/png ≤ 5MB)">
            <Upload
              accept="image/png,image/jpeg"
              beforeUpload={() => false}
              fileList={contractFileList}
              onChange={({ fileList }) => setContractFileList(fileList.slice(-1))}
              maxCount={1}
            >
              <Button icon={<UploadOutlined />}>Chọn file đính kèm</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal Gia hạn Hợp đồng */}
      <Modal
        title={`Gia hạn hợp đồng ${extendingContract?.apartmentId?.code || ''}`}
        open={extendModalOpen}
        onCancel={() => setExtendModalOpen(false)}
        onOk={handleSaveExtend}
        confirmLoading={updating}
        destroyOnClose
      >
        <Form form={extendForm} layout="vertical" className="mt-4">
          <Form.Item
            name="endDate"
            label="Ngày kết thúc mới"
            rules={[{ required: true, message: 'Vui lòng chọn ngày kết thúc' }]}
          >
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
          </Form.Item>

          {extendingContract?.type === 'LEASE' && (
            <Form.Item
              name="tenantPaysFees"
              label="Bên chịu phí dịch vụ"
              valuePropName="checked"
            >
              <Switch
                checkedChildren="Người thuê chịu phí"
                unCheckedChildren="Chủ sở hữu chịu phí"
              />
            </Form.Item>
          )}

          <Form.Item label="Cập nhật file đính kèm mới (nếu có, jpg/png ≤ 5MB)">
            <Upload
              accept="image/png,image/jpeg"
              beforeUpload={() => false}
              fileList={extendFileList}
              onChange={({ fileList }) => setExtendFileList(fileList.slice(-1))}
              maxCount={1}
            >
              <Button icon={<UploadOutlined />}>Chọn file mới</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal Chi tiết Hợp đồng */}
      <Modal
        title="Chi tiết hợp đồng"
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setDetailModalOpen(false)}>
            Đóng
          </Button>,
        ]}
        width={680}
      >
        {selectedContract ? (
          <div>
            <Descriptions bordered column={2} size="small" className="mb-4">
              <Descriptions.Item label="Mã căn hộ">
                <span className="font-bold text-blue-600">
                  {selectedContract.apartmentId?.code}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="Tòa nhà">
                {selectedContract.apartmentId?.buildingId?.name || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Loại hợp đồng">
                <EnumTag map={CONTRACT_TYPES} value={selectedContract.type} />
              </Descriptions.Item>
              <Descriptions.Item label="Trạng thái">
                <EnumTag map={CONTRACT_STATUS} value={selectedContract.status} />
              </Descriptions.Item>
              <Descriptions.Item label="Ngày bắt đầu">
                {formatDate(selectedContract.startDate)}
              </Descriptions.Item>
              <Descriptions.Item label="Ngày kết thúc">
                {selectedContract.endDate ? formatDate(selectedContract.endDate) : 'Vô thời hạn'}
              </Descriptions.Item>
              {selectedContract.terminatedAt && (
                <Descriptions.Item label="Ngày chấm dứt" span={2}>
                  <Tag color="red">{formatDate(selectedContract.terminatedAt)}</Tag>
                </Descriptions.Item>
              )}
              {selectedContract.type === 'LEASE' && (
                <Descriptions.Item label="Người trả phí" span={2}>
                  {selectedContract.tenantPaysFees ? (
                    <Tag color="orange">Người thuê trả phí dịch vụ</Tag>
                  ) : (
                    <Tag color="blue">Chủ sở hữu trả phí dịch vụ</Tag>
                  )}
                </Descriptions.Item>
              )}
            </Descriptions>

            <Row gutter={16} className="mb-4">
              <Col span={12}>
                <Card size="small" title="Chủ sở hữu" className="bg-gray-50 dark:bg-gray-800">
                  <div className="font-medium">{selectedContract.ownerId?.fullName}</div>
                  <div className="text-xs text-gray-500">Email: {selectedContract.ownerId?.email}</div>
                  <div className="text-xs text-gray-500">SĐT: {selectedContract.ownerId?.phone || '—'}</div>
                </Card>
              </Col>
              <Col span={12}>
                <Card size="small" title="Người thuê" className="bg-gray-50 dark:bg-gray-800">
                  {selectedContract.tenantId ? (
                    <div>
                      <div className="font-medium">{selectedContract.tenantId?.fullName}</div>
                      <div className="text-xs text-gray-500">Email: {selectedContract.tenantId?.email}</div>
                      <div className="text-xs text-gray-500">SĐT: {selectedContract.tenantId?.phone || '—'}</div>
                    </div>
                  ) : (
                    <span className="text-gray-400 italic">Không có người thuê</span>
                  )}
                </Card>
              </Col>
            </Row>

            {selectedContract.fileUrl && (
              <div className="p-3 bg-blue-50/50 dark:bg-gray-800 rounded flex items-center justify-between">
                <span className="text-xs font-medium">Tệp tài liệu hợp đồng:</span>
                <Button
                  size="small"
                  type="link"
                  icon={<DownloadOutlined />}
                  href={selectedContract.fileUrl}
                  target="_blank"
                >
                  Xem / Tải xuống
                </Button>
              </div>
            )}
          </div>
        ) : (
          <p className="text-center py-4">{loadingDetail ? 'Đang tải...' : 'Không tìm thấy dữ liệu'}</p>
        )}
      </Modal>
    </div>
  );
}

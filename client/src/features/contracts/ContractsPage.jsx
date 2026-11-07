import { useState } from 'react';
import {
  Table,
  Card,
  Button,
  Select,
  DatePicker,
  Modal,
  Form,
  Input,
  Tag,
  Space,
  Popconfirm,
  Row,
  Col,
  Descriptions,
  Upload,
  App,
} from 'antd';
import PhoneAccountNotice from '../../components/PhoneAccountNotice';
import { usePhoneAccount } from '../../hooks/usePhoneAccount';
import { PHONE_RULES } from '../../utils/phone';
import {
  PlusOutlined,
  ReloadOutlined,
  EyeOutlined,
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
import { contractsApi, buildingsApi } from '../../api/moduleA.api';
import ApartmentSelect from '../../components/ApartmentSelect';

// SĐT nhập trước để biết có tài khoản chưa; tài khoản có sẵn không nhận họ tên, email, ngày sinh mới (BR-X5)
function PartyFields({ prefix, title, check, namePlaceholder, emailPlaceholder, phonePlaceholder, idPlaceholder }) {
  return (
    <Card size="small" title={title} className="mb-4 bg-gray-50/50 dark:bg-gray-800">
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item name={`${prefix}Phone`} label="Số điện thoại" rules={PHONE_RULES}>
            <Input placeholder={phonePlaceholder} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name={`${prefix}IdNumber`} label="Số CCCD">
            <Input placeholder={idPlaceholder} />
          </Form.Item>
        </Col>
      </Row>

      <PhoneAccountNotice check={check} />

      {!check.isExisting && (
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item
              name={`${prefix}FullName`}
              label="Họ và tên"
              rules={[{ required: true, message: 'Vui lòng nhập họ tên' }]}
            >
              <Input placeholder={namePlaceholder} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name={`${prefix}Email`}
              label="Email (không bắt buộc)"
              rules={[{ type: 'email', message: 'Email không hợp lệ' }]}
            >
              <Input placeholder={emailPlaceholder} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name={`${prefix}Dob`} label="Ngày sinh">
              <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
            </Form.Item>
          </Col>
        </Row>
      )}
    </Card>
  );
}

export default function ContractsPage() {
  const { hasRole } = useAuth();
  const { message } = App.useApp();
  const isReceptionist = hasRole('STAFF:RECEPTIONIST');
  const isManager = hasRole('MANAGER');

  // Filters state
  const [filters, setFilters] = useState({
    page: 1,
    limit: 10,
    buildingId: undefined,
    apartmentId: undefined,
    type: undefined,
    status: undefined,
  });

  // Load buildings for filter & form
  const { data: buildings = [] } = useApi(buildingsApi.list, []);

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
      }),
    [filters],
  );

  // Modal Create state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm] = Form.useForm();
  const check = usePhoneAccount(Form.useWatch('ownerPhone', createForm));
  const [contractFileList, setContractFileList] = useState([]);

  // Modal Detail state
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedContract, setSelectedContract] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Actions
  const [createContract, creating] = useAction(
    async (formData) => contractsApi.create(formData),
    {
      success: (res) => {
        return res?.data?.activationInviteSent === false
          ? 'Đã tạo hợp đồng. Chưa gửi được email mời (hoặc cư dân không có email): cấp mã tại menu Cấp mã kích hoạt để cư dân kích hoạt.'
          : 'Tạo hợp đồng thành công';
      },
      onDone: () => {
        setCreateModalOpen(false);
        createForm.resetFields();
        check.reset();
        setContractFileList([]);
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
    check.reset();
    createForm.setFieldsValue({
      startDate: dayjs(),
    });
    setContractFileList([]);
    setCreateModalOpen(true);
  };

  const handleSaveCreate = async () => {
    try {
      const values = await createForm.validateFields();
      const formData = new FormData();
      formData.append('apartmentId', values.apartmentId);
      formData.append('type', CONTRACT_TYPES.SALE);
      formData.append('startDate', values.startDate.format('YYYY-MM-DD'));
      if (check.blockReason) return;
      const dob = values.ownerDob;
      const partyData = {
        phone: values.ownerPhone,
        idNumber: values.ownerIdNumber || '',
        ...(check.isExisting
          ? { userId: check.userId }
          : {
              fullName: values.ownerFullName,
              email: values.ownerEmail,
              dateOfBirth: dob ? dob.format('YYYY-MM-DD') : null,
            }),
      };
      formData.append('owner', JSON.stringify(partyData));

      if (contractFileList[0]?.originFileObj) {
        formData.append('file', contractFileList[0].originFileObj);
      }

      // Lỗi đã được báo; kiểm tra lại vì SĐT có thể vừa có tài khoản
      await createContract(formData).catch(() => check.reload());
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
      message.error(err?.message || 'Không thể tải chi tiết hợp đồng');
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
          {isManager && record.status === 'ACTIVE' && record.type === CONTRACT_TYPES.SALE && (
            <Popconfirm
              title="Chấm dứt hợp đồng mua bán"
              description="Chấm dứt hợp đồng mua bán sẽ kết thúc cư trú của các thành viên. Tiếp tục?"
              okText="Chấm dứt"
              cancelText="Hủy"
              okButtonProps={{ danger: true }}
              onConfirm={() => terminateContract(record._id).catch(() => {})}
            >
              <Button size="small" type="text" danger icon={<StopOutlined />}>
                Chấm dứt
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Quản lý hợp đồng"
        subtitle="Quản lý hợp đồng mua bán và tra cứu hồ sơ thuê cũ"
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Hợp đồng' }]}
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={reloadContracts}>
              Làm mới
            </Button>
            {isReceptionist && (
              <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreateModal}>
                Tạo hợp đồng mua bán
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

          <ApartmentSelect
            placeholder="Căn hộ"
            allowClear
            style={{ width: 160 }}
            value={filters.apartmentId}
            onChange={(val) => setFilters((prev) => ({ ...prev, page: 1, apartmentId: val }))}
          />

          <Select
            placeholder="Loại hợp đồng"
            allowClear
            style={{ width: 150 }}
            value={filters.type}
            onChange={(val) => setFilters((prev) => ({ ...prev, page: 1, type: val }))}
          >
            <Select.Option value={CONTRACT_TYPES.SALE}>Mua bán (SALE)</Select.Option>
            <Select.Option value={CONTRACT_TYPES.LEASE}>Cho thuê (hồ sơ cũ)</Select.Option>
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

          <Button
            onClick={() =>
              setFilters({
                page: 1,
                limit: 10,
                buildingId: undefined,
                apartmentId: undefined,
                type: undefined,
                status: undefined,
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
        title="Tạo hợp đồng mua bán"
        open={createModalOpen}
        onCancel={() => setCreateModalOpen(false)}
        onOk={handleSaveCreate}
        okButtonProps={{ disabled: Boolean(check.blockReason) }}
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
                <ApartmentSelect
                  placeholder="Gõ mã căn để tìm"
                  renderLabel={(a) => `${a.code} (${a.buildingId?.name || ''}) — ${a.status}`}
                />
              </Form.Item>
            </Col>

            <Col span={12}>
              <Form.Item
                name="startDate"
                label="Ngày bắt đầu"
                rules={[{ required: true, message: 'Vui lòng chọn ngày bắt đầu' }]}
              >
                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
          </Row>

          <PartyFields
            prefix="owner"
            title="Thông tin Chủ sở hữu"
            check={check}
            namePlaceholder="Vd: Nguyễn Văn A"
            emailPlaceholder="Vd: nva@gmail.com"
            phonePlaceholder="0912345678"
            idPlaceholder="001200000001"
          />

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

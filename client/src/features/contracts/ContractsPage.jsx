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
import { CONTRACT_STATUS, OWNERSHIP_DOCUMENT_TYPES } from '../../constants/enums';
import { formatDate, formatDateTime } from '../../utils/format';
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
  const isManager = hasRole('MANAGER');

  // Filters state
  const [filters, setFilters] = useState({
    page: 1,
    limit: 10,
    buildingId: undefined,
    floor: undefined,
    type: 'SALE',
    status: undefined,
  });

  // Load buildings for filter & form
  const { data: buildings = [] } = useApi(buildingsApi.list, []);
  const selectedBuilding = buildings.find((building) => building._id === filters.buildingId);
  const floorCount = selectedBuilding?.totalFloors ?? Math.max(0, ...buildings.map((building) => building.totalFloors ?? 0));
  const floorOptions = Array.from({ length: floorCount }, (_, index) => ({
    value: index + 1, label: `Tầng ${index + 1}`,
  }));
  const showingLegacy = filters.type === 'LEASE';
  const pageTitle = showingLegacy ? 'Hồ sơ thuê cũ' : 'Hồ sơ sở hữu căn hộ';

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
        floor: filters.floor,
        type: filters.type,
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
      success: 'Đã ghi nhận chủ sở hữu. Bạn có thể cấp tài khoản tại Chi tiết căn hộ.',
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
      formData.append('type', 'SALE');
      formData.append('startDate', values.startDate.format('YYYY-MM-DD'));
      formData.append('ownershipDocumentType', values.ownershipDocumentType);
      formData.append('ownershipDocumentNumber', values.ownershipDocumentNumber);
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
    setSelectedContract(null);
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
      title: 'Tầng',
      key: 'floor',
      width: 80,
      render: (_, record) => record.apartmentId?.floor ?? '—',
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
    ...(showingLegacy ? [{
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
    }, {
      title: 'Thời hạn',
      key: 'period',
      width: 190,
      render: (_, record) => (
        <div className="text-xs">
          <div>Từ: {formatDate(record.startDate)}</div>
          <div>Đến: {record.endDate ? formatDate(record.endDate) : 'Vô thời hạn'}</div>
        </div>
      ),
    }, {
      title: 'Người trả phí',
      key: 'payer',
      width: 130,
      render: (_, record) =>
        record.tenantPaysFees ? (
          <Tag color="orange">Người thuê</Tag>
        ) : (
          <Tag color="blue">Chủ sở hữu</Tag>
        ),
    }] : [{
      title: 'Giấy tờ đối chiếu',
      key: 'ownershipDocument',
      render: (_, record) => (
        <div>
          <div>{OWNERSHIP_DOCUMENT_TYPES[record.ownershipDocumentType]?.label || 'Chưa ghi nhận'}</div>
          {record.ownershipDocumentNumber && <div className="text-xs text-gray-500">{record.ownershipDocumentNumber}</div>}
        </div>
      ),
    }, {
      title: 'Ngày hiệu lực',
      dataIndex: 'startDate',
      key: 'startDate',
      width: 145,
      render: formatDate,
    }]),
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
          {isManager && record.status === 'ACTIVE' && record.type === 'SALE' && (
            <Popconfirm
              title="Chấm dứt hợp đồng mua bán"
              description="Chấm dứt hợp đồng mua bán sẽ kết thúc cư trú của các thành viên. Tiếp tục?"
              okText="Chấm dứt"
              cancelText="Hủy"
              okButtonProps={{ danger: true }}
              onConfirm={() => terminateContract(record._id).catch(() => { })}
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
        title={pageTitle}
        subtitle={showingLegacy ? 'Tra cứu hồ sơ thuê đã ghi nhận trước đây' : 'Ghi nhận và tra cứu thông tin người đứng tên căn hộ'}
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: pageTitle }]}
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={reloadContracts}>
              Làm mới
            </Button>
            <Button onClick={() => setFilters((previous) => ({
              ...previous, page: 1, type: showingLegacy ? 'SALE' : 'LEASE',
            }))}>
              {showingLegacy ? 'Về hồ sơ sở hữu' : 'Tra cứu hồ sơ thuê cũ'}
            </Button>
            {isManager && !showingLegacy && (
              <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreateModal}>
                Ghi nhận chủ sở hữu
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
              setFilters((prev) => ({ ...prev, page: 1, buildingId: val, floor: undefined }))
            }
          >
            {buildings.map((b) => (
              <Select.Option key={b._id} value={b._id}>
                {b.name} ({b.code})
              </Select.Option>
            ))}
          </Select>

          <Select
            aria-label="Lọc theo tầng"
            placeholder="Tất cả tầng"
            allowClear
            style={{ width: 160 }}
            options={floorOptions}
            value={filters.floor}
            onChange={(floor) => setFilters((previous) => ({ ...previous, page: 1, floor }))}
          />

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
                floor: undefined,
                type: filters.type,
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
            showTotal: (total) => `Tổng cộng ${total} hồ sơ`,
            onChange: (page, limit) => setFilters((prev) => ({ ...prev, page, limit })),
          }}
        />
      </Card>

      <Modal
        title="Ghi nhận chủ sở hữu"
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
                label="Ngày hiệu lực"
                rules={[{ required: true, message: 'Vui lòng chọn ngày hiệu lực' }]}
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

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="ownershipDocumentType"
                label="Giấy tờ đối chiếu"
                rules={[{ required: true, message: 'Vui lòng chọn giấy tờ đã đối chiếu' }]}
              >
                <Select options={Object.entries(OWNERSHIP_DOCUMENT_TYPES).map(([value, item]) => ({ value, label: item.label }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="ownershipDocumentNumber"
                label="Số tham chiếu giấy tờ"
                rules={[{ required: true, whitespace: true, message: 'Vui lòng nhập số tham chiếu' }]}
              >
                <Input maxLength={100} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="Ảnh giấy tờ đính kèm (không bắt buộc, JPG/PNG tối đa 5 MB)">
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

      <Modal
        title={selectedContract?.type === 'LEASE' ? 'Chi tiết hồ sơ thuê cũ' : 'Chi tiết hồ sơ sở hữu căn hộ'}
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
              <Descriptions.Item label="Tầng">
                {selectedContract.apartmentId?.floor ?? '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Trạng thái">
                <EnumTag map={CONTRACT_STATUS} value={selectedContract.status} />
              </Descriptions.Item>
              <Descriptions.Item label={selectedContract.type === 'LEASE' ? 'Ngày bắt đầu' : 'Ngày hiệu lực'}>
                {formatDate(selectedContract.startDate)}
              </Descriptions.Item>
              {selectedContract.type === 'LEASE' ? (
                <Descriptions.Item label="Ngày kết thúc">
                  {selectedContract.endDate ? formatDate(selectedContract.endDate) : 'Vô thời hạn'}
                </Descriptions.Item>
              ) : (
                <>
                  <Descriptions.Item label="Giấy tờ đối chiếu">
                    {OWNERSHIP_DOCUMENT_TYPES[selectedContract.ownershipDocumentType]?.label || 'Chưa ghi nhận'}
                  </Descriptions.Item>
                  <Descriptions.Item label="Số tham chiếu giấy tờ">
                    {selectedContract.ownershipDocumentNumber || '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="Người ghi nhận">
                    {selectedContract.createdBy?.fullName || '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="Thời điểm ghi nhận">
                    {formatDateTime(selectedContract.createdAt)}
                  </Descriptions.Item>
                </>
              )}
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
              <Col span={selectedContract.type === 'LEASE' ? 12 : 24}>
                <Card size="small" title="Chủ sở hữu" className="bg-gray-50 dark:bg-gray-800">
                  <div className="font-medium">{selectedContract.ownerId?.fullName}</div>
                  <div className="text-xs text-gray-500">Email: {selectedContract.ownerId?.email}</div>
                  <div className="text-xs text-gray-500">SĐT: {selectedContract.ownerId?.phone || '—'}</div>
                </Card>
              </Col>
              {selectedContract.type === 'LEASE' && <Col span={12}>
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
              </Col>}
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

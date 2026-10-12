import { useState, useTransition } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  CarOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router';
import { residentsApi, vehicleApi } from '../../api/moduleA.api';
import EnumTag from '../../components/EnumTag';
import { VEHICLE_STATUS, VEHICLE_TYPES, enumOptions } from '../../constants/enums';
import { useAction, useApi } from '../../hooks/useApi';
import { formatDate } from '../../utils/format';

export default function MyVehiclesPage() {
  const navigate = useNavigate();
  const [, startTransition] = useTransition();

  const [selectedAptId, setSelectedAptId] = useState(null);
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [selectedType, setSelectedType] = useState('MOTORBIKE');
  const [cancellingId, setCancellingId] = useState(null);

  const [form] = Form.useForm();

  // Tải danh sách căn hộ cư dân đang ở
  const {
    data: apartmentsData,
    loading: loadingApts,
    reload: reloadApts,
  } = useApi(() => residentsApi.myApartments(), []);
  const apartments = Array.isArray(apartmentsData)
    ? apartmentsData
    : apartmentsData?.items || [];

  // Xác định căn hộ đang chọn
  const activeApartment =
    apartments.find((a) => (a.apartmentId || a._id) === selectedAptId) || apartments[0] || null;
  const activeAptId = activeApartment ? activeApartment.apartmentId || activeApartment._id : null;
  const isFamilyMember = activeApartment?.relation === 'FAMILY_MEMBER';

  // Tải danh sách xe của căn hộ đang chọn
  const {
    data: vehiclesData,
    loading: loadingVehicles,
    reload: reloadVehicles,
  } = useApi(
    () => (activeAptId ? vehicleApi.listMine({ apartmentId: activeAptId }) : Promise.resolve({ data: [] })),
    [activeAptId],
    { enabled: Boolean(activeAptId) },
  );
  const vehicles = Array.isArray(vehiclesData)
    ? vehiclesData
    : vehiclesData?.items || [];

  // Action đăng ký xe
  const [registerAction, submitting] = useAction(
    async (values) => {
      const payload = {
        apartmentId: activeAptId,
        type: values.type,
        plateNumber: values.plateNumber,
        brand: values.brand,
        color: values.color,
      };
      return vehicleApi.register(payload);
    },
    {
      success: 'Gửi yêu cầu đăng ký xe thành công! Vui lòng chờ Lễ tân duyệt.',
      onDone: () => {
        setRegisterModalOpen(false);
        form.resetFields();
        reloadVehicles();
      },
    },
  );

  // Action hủy vé
  const handleCancelRequest = async (vehicleId) => {
    setCancellingId(vehicleId);
    try {
      await vehicleApi.requestCancel(vehicleId);
      message.success('Đã gửi yêu cầu xử lý hủy vé gửi xe thành công');
      reloadVehicles();
    } catch (err) {
      message.error(err.response?.data?.message || 'Thao tác không thành công');
    } finally {
      setCancellingId(null);
    }
  };

  if (loadingApts) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <Spin size="large" tip="Đang tải dữ liệu..." />
      </div>
    );
  }

  if (!apartments.length) {
    return (
      <div className="max-w-2xl mx-auto p-4 md:p-6">
        <Card className="shadow-sm border-gray-100 dark:border-gray-800 text-center py-10">
          <Empty
            description={
              <div>
                <p className="font-semibold text-gray-700 dark:text-gray-200 text-base">
                  Bạn chưa được gán vào căn hộ nào
                </p>
                <p className="text-gray-400 text-sm mt-1">
                  Vui lòng liên hệ Lễ tân tòa nhà để được kích hoạt hồ sơ cư dân.
                </p>
              </div>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => startTransition(() => navigate(-1))}
          />
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2 m-0">
              <CarOutlined className="text-primary" /> Xe của tôi
            </h1>
            <p className="text-gray-500 dark:text-gray-400 text-xs md:text-sm m-0 mt-0.5">
              Đăng ký và quản lý phương tiện gửi tại hầm chung cư
            </p>
          </div>
        </div>

        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              reloadApts();
              reloadVehicles();
            }}
            loading={loadingVehicles}
          >
            Làm mới
          </Button>
          {!isFamilyMember && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                form.resetFields();
                setSelectedType('MOTORBIKE');
                form.setFieldsValue({ type: 'MOTORBIKE' });
                setRegisterModalOpen(true);
              }}
            >
              Đăng ký xe
            </Button>
          )}
        </Space>
      </div>

      {/* Căn hộ đang chọn (nếu có nhiều căn) */}
      {apartments.length > 1 && (
        <Card className="mb-4 shadow-sm border border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Chọn căn hộ:</span>
            <Select
              className="w-56"
              value={activeAptId}
              onChange={(val) => setSelectedAptId(val)}
              options={apartments.map((a) => ({
                value: a.apartmentId || a._id,
                label: `Căn ${a.code || a.apartmentCode} - Tòa ${a.buildingName || a.buildingCode || ''}`,
              }))}
            />
          </div>
        </Card>
      )}

      {/* Cảnh báo cho Thành viên gia đình */}
      {isFamilyMember && (
        <Alert
          type="info"
          showIcon
          className="mb-4"
          message="Quyền đăng ký phương tiện"
          description="Chỉ Chủ hộ (Chủ sở hữu hoặc Người thuê đứng tên hợp đồng) mới được quyền đăng ký phương tiện mới cho căn hộ."
        />
      )}

      {/* Danh sách xe */}
      {loadingVehicles ? (
        <div className="flex justify-center items-center py-12">
          <Spin size="large" />
        </div>
      ) : vehicles.length === 0 ? (
        <Card className="shadow-sm border border-gray-100 dark:border-gray-800 text-center py-12">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Căn hộ hiện chưa có phương tiện nào được đăng ký gửi xe"
          >
            {!isFamilyMember && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  form.resetFields();
                  setSelectedType('MOTORBIKE');
                  form.setFieldsValue({ type: 'MOTORBIKE' });
                  setRegisterModalOpen(true);
                }}
              >
                Đăng ký phương tiện ngay
              </Button>
            )}
          </Empty>
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {vehicles.map((v) => {
            const isBicycle = v.type === 'BICYCLE';
            const isPending = v.status === 'PENDING';
            const isApproved = v.status === 'APPROVED';
            const isRejected = v.status === 'REJECTED';
            const isCancelled = v.status === 'CANCELLED';
            const hasCancelRequest = Boolean(v.cancelRequestedAt);

            return (
              <Col xs={24} md={12} key={v._id}>
                <Card
                  className="shadow-sm hover:shadow transition-shadow border border-gray-100 dark:border-gray-800 h-full flex flex-col justify-between"
                  title={
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <EnumTag map={VEHICLE_TYPES} value={v.type} />
                        <span className="font-bold text-base text-gray-800 dark:text-gray-100">
                          {v.plateNumber || (isBicycle ? 'Không biển số' : '—')}
                        </span>
                      </div>
                      <EnumTag map={VEHICLE_STATUS} value={v.status} />
                    </div>
                  }
                >
                  <div className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Hãng xe:</span>
                      <span className="font-medium">{v.brand || '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Màu xe:</span>
                      <span className="font-medium">{v.color || '—'}</span>
                    </div>
                    {v.approvedAt && (
                      <div className="flex justify-between">
                        <span className="text-gray-400">Ngày duyệt:</span>
                        <span>{formatDate(v.approvedAt)}</span>
                      </div>
                    )}
                    {v.cancelledAt && (
                      <div className="flex justify-between">
                        <span className="text-gray-400">Ngày hủy:</span>
                        <span>{formatDate(v.cancelledAt)}</span>
                      </div>
                    )}

                    {/* Lý do từ chối nếu có */}
                    {isRejected && v.rejectReason && (
                      <div className="mt-3 p-2.5 rounded bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-300 text-xs">
                        <span className="font-semibold">Lý do từ chối:</span> {v.rejectReason}
                      </div>
                    )}

                    {/* Trạng thái đang chờ hủy */}
                    {isApproved && hasCancelRequest && (
                      <div className="mt-3 p-2.5 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-amber-700 dark:text-amber-300 text-xs flex items-center gap-1.5">
                        <ClockCircleOutlined />
                        <span>Đã gửi yêu cầu hủy vé ({formatDate(v.cancelRequestedAt)}). Chờ Lễ tân xác nhận.</span>
                      </div>
                    )}
                  </div>

                  {/* Nút hành động */}
                  <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 flex justify-end">
                    {isPending && (
                      <Popconfirm
                        title="Rút yêu cầu đăng ký xe"
                        description="Bạn có chắc muốn hủy yêu cầu đăng ký phương tiện này?"
                        okText="Rút yêu cầu"
                        cancelText="Đóng"
                        okButtonProps={{ danger: true, loading: cancellingId === v._id }}
                        onConfirm={() => handleCancelRequest(v._id)}
                      >
                        <Button size="small" danger>
                          Rút yêu cầu
                        </Button>
                      </Popconfirm>
                    )}

                    {isApproved && !hasCancelRequest && (
                      <Popconfirm
                        title="Yêu cầu hủy vé gửi xe"
                        description={
                          <div className="max-w-xs">
                            <p className="m-0 mb-1">
                              Sau khi hủy, xe vẫn được gửi và <b>tính phí đến hết tháng hiện tại</b>.
                            </p>
                            <p className="m-0 text-xs text-gray-400">
                              Lễ tân sẽ xác nhận yêu cầu hủy vé của bạn.
                            </p>
                          </div>
                        }
                        okText="Xác nhận gửi yêu cầu hủy"
                        cancelText="Quay lại"
                        okButtonProps={{ danger: true, loading: cancellingId === v._id }}
                        onConfirm={() => handleCancelRequest(v._id)}
                      >
                        <Button size="small" danger>
                          Yêu cầu hủy vé
                        </Button>
                      </Popconfirm>
                    )}

                    {(isCancelled || isRejected) && (
                      <Tag color="default" className="m-0">
                        Hồ sơ đã kết thúc
                      </Tag>
                    )}
                  </div>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}

      {/* Modal Đăng ký xe */}
      <Modal
        title={
          <div className="flex items-center gap-2">
            <CarOutlined className="text-primary" />
            <span>Đăng ký phương tiện mới</span>
          </div>
        }
        open={registerModalOpen}
        onCancel={() => setRegisterModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={submitting}
        okText="Gửi yêu cầu"
        cancelText="Hủy"
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={registerAction}
          initialValues={{ type: 'MOTORBIKE' }}
          className="mt-4"
        >
          <Form.Item
            name="type"
            label="Loại phương tiện"
            rules={[{ required: true, message: 'Vui lòng chọn loại xe' }]}
          >
            <Select
              options={enumOptions(VEHICLE_TYPES)}
              onChange={(val) => setSelectedType(val)}
            />
          </Form.Item>

          <Form.Item
            name="plateNumber"
            label={
              <span>
                Biển số xe{' '}
                {selectedType === 'BICYCLE' ? (
                  <span className="text-gray-400 font-normal">(Xe đạp không bắt buộc)</span>
                ) : (
                  <span className="text-red-500">*</span>
                )}
              </span>
            }
            rules={[
              {
                required: selectedType !== 'BICYCLE',
                message: 'Vui lòng nhập biển số xe',
              },
            ]}
            extra="Biển số sẽ được tự động viết hoa và chuẩn hóa (bỏ dấu cách, dấu chấm)."
          >
            <Input placeholder={selectedType === 'BICYCLE' ? 'Để trống nếu không có' : 'Ví dụ: 29A1-123.45 hoặc 51H-999.88'} />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="brand" label="Hãng xe">
                <Input placeholder="Honda, Toyota, Giant..." />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="color" label="Màu xe">
                <Input placeholder="Trắng, Đen, Xanh..." />
              </Form.Item>
            </Col>
          </Row>

          <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded border border-blue-200 dark:border-blue-900/50 text-xs text-blue-700 dark:text-blue-300">
            <p className="m-0 font-medium flex items-center gap-1">
              <ExclamationCircleOutlined /> Lưu ý quy định gửi xe:
            </p>
            <ul className="m-0 mt-1 pl-4 list-disc space-y-0.5">
              <li>Yêu cầu sẽ được Lễ tân xem xét và duyệt trong giờ làm việc.</li>
              <li>Phí gửi xe hàng tháng sẽ bắt đầu được tính từ hóa đơn của tháng kế tiếp.</li>
              <li>Chỗ đỗ xe máy và ô tô phụ thuộc vào sức chứa bãi xe còn trống.</li>
            </ul>
          </div>
        </Form>
      </Modal>
    </div>
  );
}

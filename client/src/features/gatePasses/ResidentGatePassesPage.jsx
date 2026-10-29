import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  TimePicker,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  CarOutlined,
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router';
import { gatePassesApi } from '../../api/gatePasses.api';
import { residentsApi } from '../../api/moduleA.api';
import EnumTag from '../../components/EnumTag';
import PageHeader from '../../components/PageHeader';
import { RELATION_TYPES } from '../../constants/enums';
import { useAction, useApi } from '../../hooks/useApi';
import { formatDate, formatDateTime } from '../../utils/format';
import { GATE_PASS_DIRECTIONS_MAP, GATE_PASS_STATUS_MAP } from './gatePassConstants';

export default function ResidentGatePassesPage() {
  const navigate = useNavigate();
  const [selectedAptId, setSelectedAptId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [detailItem, setDetailItem] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);

  const [createForm] = Form.useForm();
  const [rejectForm] = Form.useForm();
  const [timeToOpen, setTimeToOpen] = useState(false);
  const timeToRef = useRef(null);

  const timeFromVal = Form.useWatch('timeFrom', createForm);

  const { data: aptsData, loading: loadingApts } = useApi(() => residentsApi.myApartments(), []);
  const apartments = Array.isArray(aptsData) ? aptsData : aptsData?.items || [];

  const activeApartment =
    apartments.find((a) => (a.apartmentId || a._id) === selectedAptId) || apartments[0] || null;
  const activeAptId = activeApartment ? activeApartment.apartmentId || activeApartment._id : null;

  const {
    data: passesList,
    loading: loadingPasses,
    reload: reloadPasses,
  } = useApi(
    () =>
      activeAptId
        ? gatePassesApi.list({
            apartmentId: activeAptId,
            status: statusFilter || undefined,
            limit: 50,
          })
        : Promise.resolve({ data: [] }),
    [activeAptId, statusFilter],
    { enabled: Boolean(activeAptId) },
  );

  const gatePasses = Array.isArray(passesList) ? passesList : passesList?.items || [];

  const [runCreate, creating] = useAction(gatePassesApi.create, {
    success: 'Đã gửi đơn chuyển đồ thành công',
    onDone: () => {
      setCreateOpen(false);
      reloadPasses();
    },
  });
  const [runDecision, deciding] = useAction(
    ({ id, body }) => gatePassesApi.ownerDecision(id, body),
    {
      onDone: () => reloadPasses(),
    },
  );

  const openCreateModal = () => {
    createForm.resetFields();
    createForm.setFieldsValue({
      apartmentId: activeAptId,
      direction: 'IN',
      scheduledDate: dayjs().add(1, 'day'),
      timeFrom: dayjs('08:00', 'HH:mm'),
      timeTo: dayjs('11:00', 'HH:mm'),
      items: [{ name: '', quantity: 1 }],
    });
    setTimeToOpen(false);
    setCreateOpen(true);
  };

  const handleTimeFromChange = (newFrom) => {
    if (newFrom && dayjs.isDayjs(newFrom)) {
      const currentTo = createForm.getFieldValue('timeTo');
      const fromMinutes = newFrom.hour() * 60 + newFrom.minute();

      if (currentTo && dayjs.isDayjs(currentTo)) {
        const toMinutes = currentTo.hour() * 60 + currentTo.minute();
        if (fromMinutes >= toMinutes) {
          // Tính lại khoảng thời lượng trước đó nếu có, mặc định là 1 tiếng
          let prevDurationMin = 60;
          if (timeFromVal && dayjs.isDayjs(timeFromVal)) {
            const oldFromMin = timeFromVal.hour() * 60 + timeFromVal.minute();
            if (toMinutes > oldFromMin) {
              prevDurationMin = toMinutes - oldFromMin;
            }
          }
          let updatedTo = newFrom.add(prevDurationMin, 'minute');
          if (updatedTo.day() !== newFrom.day()) {
            updatedTo = newFrom.hour(23).minute(59);
          }
          createForm.setFieldValue('timeTo', updatedTo);
        }
      } else {
        let updatedTo = newFrom.add(1, 'hour');
        if (updatedTo.day() !== newFrom.day()) {
          updatedTo = newFrom.hour(23).minute(59);
        }
        createForm.setFieldValue('timeTo', updatedTo);
      }

      createForm.validateFields(['timeTo']).catch(() => {});

      // Tự động focus/mở luôn khung chọn của Giờ kết thúc
      setTimeout(() => {
        setTimeToOpen(true);
        timeToRef.current?.focus?.();
      }, 120);
    }
  };

  const disabledTimeTo = () => {
    const from = createForm.getFieldValue('timeFrom');
    if (!from || !dayjs.isDayjs(from)) return {};
    const fromHour = from.hour();
    const fromMinute = from.minute();

    return {
      disabledHours: () => {
        const hours = [];
        for (let h = 0; h < 24; h++) {
          if (h < fromHour || (h === fromHour && fromMinute === 59)) {
            hours.push(h);
          }
        }
        return hours;
      },
      disabledMinutes: (selectedHour) => {
        if (selectedHour === fromHour) {
          const minutes = [];
          for (let m = 0; m <= fromMinute; m++) {
            minutes.push(m);
          }
          return minutes;
        }
        return [];
      },
    };
  };

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      const formatTimeSlot = (val) => {
        if (!val) return '';
        if (dayjs.isDayjs(val)) return val.format('HH:mm');
        if (typeof val === 'string') return val.trim();
        return '';
      };

      const payload = {
        apartmentId: values.apartmentId || activeAptId,
        direction: values.direction,
        scheduledDate: values.scheduledDate.format('YYYY-MM-DD'),
        timeSlot: {
          from: formatTimeSlot(values.timeFrom),
          to: formatTimeSlot(values.timeTo),
        },
        truckPlate: values.truckPlate.trim(),
        driverPhone: values.driverPhone?.trim() || undefined,
        items: values.items.map((it) => ({
          name: it.name.trim(),
          quantity: Number(it.quantity),
        })),
      };
      await runCreate(payload);
    } catch {
      // handled by form or useAction
    }
  };

  const handleOwnerApprove = async (item) => {
    try {
      await runDecision({ id: item._id, body: { approved: true } });
    } catch {
      // handled by useAction
    }
  };

  const handleOwnerReject = async () => {
    try {
      const values = await rejectForm.validateFields();
      await runDecision({
        id: rejectTarget._id,
        body: { approved: false, rejectReason: values.rejectReason },
      });
      setRejectTarget(null);
      rejectForm.resetFields();
    } catch {
      message.warning('Vui lòng nhập lý do từ chối');
    }
  };

  if (loadingApts) {
    return (
      <div className="flex justify-center items-center py-20">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader
        title="Đơn chuyển đồ (Gate Pass)"
        subtitle="Đăng ký mang đồ đạc, nội thất ra/vào tòa nhà và theo dõi trạng thái phê duyệt"
        extra={
          <Space wrap>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/r/my-apartment')}>
              Căn hộ
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => reloadPasses()}>
              Làm mới
            </Button>
            {activeAptId && (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
                Tạo đơn chuyển đồ
              </Button>
            )}
          </Space>
        }
      />

      {activeApartment?.relationType === 'TENANT' && (
        <Alert
          type="info"
          showIcon
          message="Lưu ý dành cho khách thuê"
          description="Đơn chuyển đồ do khách thuê tạo sẽ gửi tới Chủ hộ xác nhận trước khi chuyển lên Trưởng BQL phê duyệt."
        />
      )}

      <Card size="small">
        <Row gutter={[12, 12]} align="middle">
          {apartments.length > 1 && (
            <Col xs={24} sm={10}>
              <Select
                className="w-full"
                value={activeAptId}
                onChange={setSelectedAptId}
                options={apartments.map((a) => ({
                  value: a.apartmentId || a._id,
                  label: `Căn ${a.code} — ${a.building?.name || ''}`,
                }))}
              />
            </Col>
          )}
          <Col xs={24} sm={10}>
            <Select
              className="w-full"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: '', label: 'Tất cả trạng thái' },
                ...Object.entries(GATE_PASS_STATUS_MAP).map(([k, v]) => ({
                  value: k,
                  label: v.label,
                })),
              ]}
            />
          </Col>
        </Row>
      </Card>

      {loadingPasses ? (
        <div className="flex justify-center py-16">
          <Spin />
        </div>
      ) : gatePasses.length === 0 ? (
        <Card>
          <Empty description="Chưa có đơn chuyển đồ nào">
            {activeAptId && (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
                Tạo đơn đầu tiên
              </Button>
            )}
          </Empty>
        </Card>
      ) : (
        <div className="space-y-3">
          {gatePasses.map((item) => (
            <Card key={item._id} size="small" className="shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="space-y-1">
                  <Space wrap>
                    <span className="font-bold text-base text-blue-600">{item.code}</span>
                    <EnumTag map={GATE_PASS_DIRECTIONS_MAP} value={item.direction} />
                    <EnumTag map={GATE_PASS_STATUS_MAP} value={item.status} />
                    <Tag icon={<CarOutlined />}>{item.truckPlate}</Tag>
                  </Space>
                  <div className="text-sm text-gray-600 dark:text-gray-300">
                    Ngày: <b>{formatDate(item.scheduledDate)}</b> · Khung giờ:{' '}
                    <b>
                      {item.timeSlot?.from} – {item.timeSlot?.to}
                    </b>{' '}
                    · Người tạo: <b>{item.createdBy?.fullName || '—'}</b> (
                    <EnumTag map={RELATION_TYPES} value={item.creatorRelation} />)
                  </div>
                  <div className="text-xs text-gray-500">
                    Đồ đạc:{' '}
                    {(item.items || []).map((it) => `${it.name} (x${it.quantity})`).join(', ')}
                  </div>
                  {item.rejectReason && (
                    <div className="text-xs text-red-500">Lý do từ chối: {item.rejectReason}</div>
                  )}
                </div>

                <Space wrap>
                  <Button
                    size="small"
                    icon={<EyeOutlined />}
                    onClick={() => setDetailItem(item)}
                  >
                    Chi tiết
                  </Button>
                  {item.canOwnerConfirm && (
                    <>
                      <Popconfirm
                        title="Xác nhận cho phép khách thuê chuyển đồ theo đơn này?"
                        onConfirm={() => handleOwnerApprove(item)}
                        okText="Xác nhận"
                        cancelText="Hủy"
                      >
                        <Button
                          size="small"
                          type="primary"
                          icon={<CheckOutlined />}
                          loading={deciding}
                        >
                          Chủ hộ xác nhận
                        </Button>
                      </Popconfirm>
                      <Button
                        size="small"
                        danger
                        icon={<CloseOutlined />}
                        onClick={() => {
                          setRejectTarget(item);
                          rejectForm.resetFields();
                        }}
                      >
                        Từ chối
                      </Button>
                    </>
                  )}
                </Space>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Modal tạo đơn chuyển đồ */}
      <Modal
        title="Tạo đơn chuyển đồ (Gate Pass)"
        open={createOpen}
        onCancel={() => {
          setTimeToOpen(false);
          setCreateOpen(false);
        }}
        onOk={handleCreate}
        confirmLoading={creating}
        okText="Gửi đơn"
        cancelText="Hủy"
        width={640}
      >
        <Form form={createForm} layout="vertical">
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="direction"
                label="Chiều vận chuyển"
                rules={[{ required: true, message: 'Chọn chiều vận chuyển' }]}
              >
                <Select
                  options={[
                    { value: 'IN', label: 'Chuyển đồ vào (IN)' },
                    { value: 'OUT', label: 'Chuyển đồ ra (OUT)' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="scheduledDate"
                label="Ngày vận chuyển"
                rules={[{ required: true, message: 'Chọn ngày vận chuyển' }]}
              >
                <DatePicker
                  className="w-full"
                  format="DD/MM/YYYY"
                  disabledDate={(d) => d && d.isBefore(dayjs().startOf('day'))}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col xs={12}>
              <Form.Item
                name="timeFrom"
                label="Giờ bắt đầu"
                rules={[{ required: true, message: 'Chọn giờ bắt đầu' }]}
              >
                <TimePicker
                  className="w-full"
                  format="HH:mm"
                  needConfirm={false}
                  placeholder="Chọn giờ bắt đầu"
                  onChange={handleTimeFromChange}
                />
              </Form.Item>
            </Col>
            <Col xs={12}>
              <Form.Item
                name="timeTo"
                label="Giờ kết thúc"
                dependencies={['timeFrom']}
                rules={[
                  { required: true, message: 'Chọn giờ kết thúc' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      const from = getFieldValue('timeFrom');
                      if (!value || !from) return Promise.resolve();
                      const fromStr = dayjs.isDayjs(from) ? from.format('HH:mm') : String(from);
                      const toStr = dayjs.isDayjs(value) ? value.format('HH:mm') : String(value);
                      if (toStr <= fromStr) {
                        return Promise.reject(new Error('Giờ kết thúc phải sau giờ bắt đầu'));
                      }
                      return Promise.resolve();
                    },
                  }),
                ]}
              >
                <TimePicker
                  ref={timeToRef}
                  className="w-full"
                  format="HH:mm"
                  needConfirm={false}
                  placeholder="Chọn giờ kết thúc"
                  open={timeToOpen}
                  onOpenChange={setTimeToOpen}
                  disabledTime={disabledTimeTo}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="truckPlate"
                label="Biển số xe tải / xe chở đồ"
                rules={[{ required: true, message: 'Nhập biển số xe tải' }]}
              >
                <Input placeholder="VD: 29C-123.45" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="driverPhone" label="SĐT tài xế (tuỳ chọn)">
                <Input placeholder="VD: 0901234567" />
              </Form.Item>
            </Col>
          </Row>

          <div className="font-medium mb-2">Danh sách đồ đạc vận chuyển</div>
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <div className="space-y-2">
                {fields.map(({ key, name, ...restField }) => (
                  <Row key={key} gutter={8} align="middle">
                    <Col flex="auto">
                      <Form.Item
                        {...restField}
                        name={[name, 'name']}
                        rules={[{ required: true, message: 'Nhập tên vật dụng' }]}
                        className="mb-0"
                      >
                        <Input placeholder="Tên đồ đạc (VD: Tủ lạnh, Sofa...)" />
                      </Form.Item>
                    </Col>
                    <Col width={110}>
                      <Form.Item
                        {...restField}
                        name={[name, 'quantity']}
                        rules={[{ required: true, message: 'Số lượng' }]}
                        className="mb-0"
                      >
                        <InputNumber min={1} className="w-24" placeholder="SL" />
                      </Form.Item>
                    </Col>
                    <Col>
                      {fields.length > 1 && (
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => remove(name)}
                        />
                      )}
                    </Col>
                  </Row>
                ))}
                <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ name: '', quantity: 1 })}>
                  Thêm vật dụng
                </Button>
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>

      {/* Modal Chủ hộ từ chối */}
      <Modal
        title={`Từ chối đơn ${rejectTarget?.code || ''}`}
        open={Boolean(rejectTarget)}
        onCancel={() => setRejectTarget(null)}
        onOk={handleOwnerReject}
        confirmLoading={deciding}
        okText="Xác nhận từ chối"
        okButtonProps={{ danger: true }}
        cancelText="Hủy"
      >
        <Form form={rejectForm} layout="vertical">
          <Form.Item
            name="rejectReason"
            label="Lý do từ chối"
            rules={[{ required: true, message: 'Vui lòng nhập lý do từ chối' }]}
          >
            <Input.TextArea rows={3} placeholder="Nhập lý do từ chối..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal chi tiết */}
      <Modal
        title={`Chi tiết đơn chuyển đồ ${detailItem?.code || ''}`}
        open={Boolean(detailItem)}
        onCancel={() => setDetailItem(null)}
        footer={<Button onClick={() => setDetailItem(null)}>Đóng</Button>}
      >
        {detailItem && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="Mã đơn">{detailItem.code}</Descriptions.Item>
            <Descriptions.Item label="Căn hộ">
              {detailItem.apartmentId?.code} ({detailItem.apartmentId?.buildingId?.name})
            </Descriptions.Item>
            <Descriptions.Item label="Chiều">
              <EnumTag map={GATE_PASS_DIRECTIONS_MAP} value={detailItem.direction} />
            </Descriptions.Item>
            <Descriptions.Item label="Trạng thái">
              <EnumTag map={GATE_PASS_STATUS_MAP} value={detailItem.status} />
            </Descriptions.Item>
            <Descriptions.Item label="Thời gian">
              {formatDate(detailItem.scheduledDate)} ({detailItem.timeSlot?.from} –{' '}
              {detailItem.timeSlot?.to})
            </Descriptions.Item>
            <Descriptions.Item label="Biển số xe tải">{detailItem.truckPlate}</Descriptions.Item>
            <Descriptions.Item label="SĐT tài xế">
              {detailItem.driverPhone || '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Danh sách đồ">
              <ul className="list-disc pl-4 m-0">
                {(detailItem.items || []).map((it, idx) => (
                  <li key={idx}>
                    {it.name} — SL: <b>{it.quantity}</b>
                  </li>
                ))}
              </ul>
            </Descriptions.Item>
            {detailItem.ownerDecision?.at && (
              <Descriptions.Item label="Xác nhận của chủ hộ">
                {detailItem.ownerDecision.approved ? 'Đã đồng ý' : 'Đã từ chối'} lúc{' '}
                {formatDateTime(detailItem.ownerDecision.at)}
              </Descriptions.Item>
            )}
            {detailItem.rejectReason && (
              <Descriptions.Item label="Lý do từ chối">
                <span className="text-red-500">{detailItem.rejectReason}</span>
              </Descriptions.Item>
            )}
            {detailItem.usedAt && (
              <Descriptions.Item label="Qua cổng lúc">
                {formatDateTime(detailItem.usedAt)}
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Modal>
    </div>
  );
}

import { useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Flex,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from 'antd';
import {
  BankOutlined,
  CalculatorOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { buildingProfileApi, collectionSettingsApi, utilityTariffsApi } from '../../api/buildingSettings.api';
import { systemConfigApi } from '../../api/moduleE.api';
import PageHeader from '../../components/PageHeader';
import FeeTypesPage from '../feeTypes/FeeTypesPage';
import { formatMoney } from '../../utils/format';
import { IMAGE_ACCEPT, checkImageFile } from '../../utils/imageUpload';
import { useApi, useAction } from '../../hooks/useApi';
import { CONFIG_GROUPS, CONFIG_METADATA, cleanConfigDescription } from './deadlineConfigs';

const { Text, Title } = Typography;

/** "Ban quản lý Đông Á" → "BAN QUAN LY DONG A" (tên chủ tài khoản dùng cho mã QR chuyển khoản) */
const toBankAccountName = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase();

/** 1678 → "1.678" (định dạng Việt Nam cho ô đơn giá) */
const formatVnNumber = (val) => (val === undefined || val === null || val === '' ? '' : `${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
const parseVnNumber = (val) => (val ? val.replace(/\./g, '') : '');

/** "2027-12" → "12/2027" */
const periodText = (p) => (p ? `${p.slice(5, 7)}/${p.slice(0, 4)}` : '');

// ==========================================
// TAB 1: THÔNG TIN TÒA NHÀ
// ==========================================
function BuildingProfileTab() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [fileList, setFileList] = useState([]);
  const [userLogoUrl, setUserLogoUrl] = useState(null);

  // useApi tự lấy .data của response → không được bóc .data thêm lần nữa ở đây
  // Không tự làm mới ngầm: đang nhập dở mà form bị dựng lại thì mất chữ
  const profile = useApi(() => buildingProfileApi.get(), [], { autoRefresh: false });

  const previewLogo = userLogoUrl !== null ? userLogoUrl : (profile.data?.logoUrl || '');

  const [saveProfile, saving] = useAction(
    async (values) => {
      const formData = new FormData();
      Object.entries(values).forEach(([k, v]) => {
        formData.append(k, v || '');
      });
      // beforeUpload lưu thẳng File gốc vào fileList (không có originFileObj)
      const file = fileList[0]?.originFileObj ?? fileList[0];
      if (file) formData.append('logo', file);
      return buildingProfileApi.update(formData);
    },
    {
      success: 'Đã lưu thông tin tòa nhà',
      onDone: async () => {
        setFileList([]);
        setUserLogoUrl(null);
        await profile.reload();
      },
    },
  );

  const beforeUpload = (file) => {
    const err = checkImageFile(file);
    if (err) {
      message.error(err);
      return Upload.LIST_IGNORE;
    }
    setFileList([file]);
    setUserLogoUrl(URL.createObjectURL(file));
    return false;
  };

  return (
    <Card title="Hồ sơ & Thông tin pháp lý tòa nhà" loading={profile.loading}>
      <Form
        form={form}
        layout="vertical"
        key={`${profile.data?._id || 'new'}-${profile.data?.updatedAt || ''}`}
        initialValues={{
          name: profile.data?.name || '',
          address: profile.data?.address || '',
          taxCode: profile.data?.taxCode || '',
          bankName: profile.data?.bankName || '',
          bankAccountNo: profile.data?.bankAccountNo || '',
          bankAccountName: profile.data?.bankAccountName || '',
        }}
        onFinish={(values) => saveProfile(values).catch(() => {})}
        style={{ maxWidth: 800 }}
      >
        <Row gutter={24}>
          <Col xs={24} md={16}>
            <Form.Item
              name="name"
              label="Tên tòa nhà"
              rules={[{ required: true, message: 'Vui lòng nhập tên tòa nhà' }]}
            >
              <Input placeholder="Ví dụ: Tòa nhà Sunshine Center" maxLength={200} />
            </Form.Item>

            <Form.Item
              name="address"
              label="Địa chỉ"
              rules={[{ required: true, message: 'Vui lòng nhập địa chỉ tòa nhà' }]}
            >
              <Input.TextArea rows={2} placeholder="Số nhà, đường phố, phường/xã, quận/huyện..." maxLength={500} />
            </Form.Item>

            <Form.Item
              name="taxCode"
              label="Mã số thuế"
              rules={[
                { required: true, message: 'Vui lòng nhập mã số thuế' },
                {
                  pattern: /^(\d{10}|\d{10}-\d{3})$/,
                  message: 'Mã số thuế phải là 10 số hoặc 13 số dạng xxxxxxxxxx-xxx',
                },
              ]}
            >
              <Input placeholder="Ví dụ: 0101234567 hoặc 0101234567-001" maxLength={20} />
            </Form.Item>
          </Col>

          <Col xs={24} md={8}>
            <Form.Item label="Logo tòa nhà">
              <Flex vertical align="center" gap={12}>
                <div
                  style={{
                    width: 140,
                    height: 140,
                    border: '1px dashed #d9d9d9',
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    background: '#fafafa',
                  }}
                >
                  {previewLogo ? (
                    <Image src={previewLogo} alt="Logo" style={{ maxHeight: 130, maxWidth: 130, objectFit: 'contain' }} />
                  ) : (
                    <Text type="secondary">Chưa có logo</Text>
                  )}
                </div>
                <Upload
                  accept={IMAGE_ACCEPT}
                  showUploadList={false}
                  beforeUpload={beforeUpload}
                  fileList={fileList}
                >
                  <Button icon={<UploadOutlined />}>Tải logo lên</Button>
                </Upload>
              </Flex>
            </Form.Item>
          </Col>
        </Row>

        <Title level={5} style={{ marginTop: 16 }}>
          <BankOutlined style={{ marginRight: 8 }} />
          Tài khoản ngân hàng nhận thanh toán phí
        </Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          Thông tin này sẽ được in trực tiếp lên thông báo phí hàng tháng và mã QR thanh toán của cư dân.
        </Text>

        <Row gutter={16}>
          <Col xs={24} sm={8}>
            <Form.Item
              name="bankName"
              label="Tên ngân hàng"
              rules={[{ required: true, message: 'Nhập tên ngân hàng' }]}
            >
              <Input placeholder="Ví dụ: Vietcombank, BIDV, Techcombank..." maxLength={200} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item
              name="bankAccountNo"
              label="Số tài khoản"
              rules={[
                { required: true, message: 'Nhập số tài khoản' },
                { pattern: /^\d+$/, message: 'Số tài khoản chỉ được chứa chữ số' },
              ]}
            >
              <Input placeholder="Chỉ nhập chữ số" maxLength={30} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item
              name="bankAccountName"
              label="Chủ tài khoản"
              rules={[
                { required: true, message: 'Nhập tên chủ tài khoản' },
                { pattern: /^[A-Z0-9 .,&()-]+$/, message: 'Chữ in hoa không dấu, giống tên in trên tài khoản ngân hàng' },
              ]}
              normalize={(v) => (v ? toBankAccountName(v) : v)}
              extra="Tự chuyển sang chữ in hoa không dấu để mã QR chuyển khoản đọc được"
            >
              <Input placeholder="Ví dụ: BAN QUAN LY TOA NHA..." maxLength={200} />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item style={{ marginTop: 16 }}>
          <Button type="primary" htmlType="submit" loading={saving}>
            Lưu thông tin tòa nhà
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}

// ==========================================
// TAB 2: BIỂU PHÍ (ĐIỆN, NƯỚC, PHÍ CỐ ĐỊNH)
// ==========================================
function TariffModal({ open, utility, onClose, onDone }) {
  const [form] = Form.useForm();
  const isWater = utility === 'WATER';

  // State tính thử tiền
  const [testConsumption, setTestConsumption] = useState(0);
  const [testOccupants, setTestOccupants] = useState(4);
  const [calculatedAmount, setCalculatedAmount] = useState(0);

  const [create, creating] = useAction(
    (values) => {
      const payload = {
        utility,
        fromPeriod: values.fromPeriod,
        perOccupant: isWater ? values.perOccupant : false,
        tiers: values.tiers.map((t, idx, arr) => ({
          upTo: idx === arr.length - 1 ? null : t.upTo,
          unitPrice: t.unitPrice,
        })),
      };
      return utilityTariffsApi.create(payload).catch((err) => {
        // Lỗi gắn với field (tiers.2.upTo, fromPeriod) → tô đỏ đúng ô
        const fields = (err.details || [])
          .filter((d) => d.field)
          .map((d) => ({ name: d.field.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)), errors: [d.message] }));
        if (fields.length) form.setFields(fields);
        throw err;
      });
    },
    {
      // useAction đã tự báo res.message → không báo thêm lần nữa
      onDone: () => {
        onClose();
        onDone();
      },
    },
  );

  // Tính thử tiền. Truyền giá trị mới vào thẳng vì setState chưa kịp cập nhật trong cùng onChange
  const runCalculator = ({ consumption = testConsumption, occupants = testOccupants } = {}) => {
    const values = form.getFieldsValue();
    const tiers = values.tiers || [];
    const perOccupant = isWater && values.perOccupant;
    const nOccupants = perOccupant ? Math.max(1, Number(occupants) || 1) : 1;

    let remaining = Number(consumption) || 0;
    let prevLimit = 0;
    let total = 0;

    for (let i = 0; i < tiers.length; i++) {
      if (remaining <= 0) break;
      const tier = tiers[i];
      const isLast = i === tiers.length - 1;
      const unitPrice = Number(tier?.unitPrice) || 0;

      if (isLast) {
        total += remaining * unitPrice;
        break;
      }

      const upTo = Number(tier?.upTo) || 0;
      const capacity = upTo * nOccupants - prevLimit;
      if (capacity <= 0) continue;

      const used = Math.min(remaining, capacity);
      total += used * unitPrice;
      remaining -= used;
      prevLimit = upTo * nOccupants;
    }
    setCalculatedAmount(Math.round(total));
  };

  const initialTiers = isWater
    ? [
        { upTo: 10, unitPrice: 6000 },
        { upTo: 20, unitPrice: 7000 },
        { upTo: 30, unitPrice: 8600 },
        { upTo: null, unitPrice: 16000 },
      ]
    : [
        { upTo: 50, unitPrice: 1678 },
        { upTo: 100, unitPrice: 1734 },
        { upTo: 200, unitPrice: 2014 },
        { upTo: 300, unitPrice: 2536 },
        { upTo: 400, unitPrice: 2834 },
        { upTo: null, unitPrice: 2927 },
      ];

  const nextMonthPeriod = dayjs().add(1, 'month').format('YYYY-MM');

  return (
    <Modal
      title={`Thêm phiên bản biểu giá ${isWater ? 'NƯỚC' : 'ĐIỆN'} bậc thang mới`}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={creating}
      width="min(720px, 94vw)"
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          fromPeriod: nextMonthPeriod,
          perOccupant: isWater,
          tiers: initialTiers,
        }}
        onValuesChange={() => runCalculator()}
        onFinish={(v) => create(v).catch(() => {})}
      >
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="fromPeriod"
              label="Kỳ áp dụng (YYYY-MM)"
              rules={[
                { required: true, message: 'Nhập kỳ áp dụng' },
                { pattern: /^\d{4}-\d{2}$/, message: 'Định dạng YYYY-MM' },
              ]}
              extra="Nếu chọn kỳ hiện tại hoặc quá khứ, hệ thống sẽ tự dời sang kỳ sau."
            >
              <Input placeholder="YYYY-MM" />
            </Form.Item>
          </Col>
          {isWater && (
            <Col span={12}>
              <Form.Item
                name="perOccupant"
                label="Định mức nước theo đầu người"
                valuePropName="checked"
                extra="Mức bậc thang nhân với số người ở trong căn"
              >
                <Switch />
              </Form.Item>
            </Col>
          )}
        </Row>

        <Title level={5} style={{ marginTop: 8 }}>
          Các bậc thang giá ({isWater ? 'm³' : 'kWh'})
        </Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          Mức tối đa phải tăng dần. Bậc cuối cùng tự động hiểu là "trở lên" (không giới hạn).
        </Text>

        <Form.List name="tiers">
          {(fields, { remove }) => (
            <Flex vertical gap={8}>
              {fields.map(({ key, name, ...restField }, index) => {
                const isLast = index === fields.length - 1;
                return (
                  <Flex key={key} gap={12} align="flex-start">
                    <Text strong style={{ width: 60, lineHeight: '32px' }}>
                      Bậc {index + 1}:
                    </Text>
                    {isLast ? (
                      <Input
                        value="Trở lên (không giới hạn)"
                        disabled
                        style={{ width: 200, background: '#f5f5f5' }}
                      />
                    ) : (
                      <Form.Item
                        {...restField}
                        name={[name, 'upTo']}
                        style={{ marginBottom: 0 }}
                        dependencies={index > 0 ? [['tiers', index - 1, 'upTo']] : []}
                        rules={[
                          { required: true, message: 'Nhập mức' },
                          ({ getFieldValue }) => ({
                            validator(_, value) {
                              const prev = index > 0 ? getFieldValue(['tiers', index - 1, 'upTo']) : null;
                              if (value != null && prev != null && value <= prev) {
                                return Promise.reject(new Error(`Phải lớn hơn mức bậc ${index} (${prev})`));
                              }
                              return Promise.resolve();
                            },
                          }),
                        ]}
                      >
                        <InputNumber
                          min={1}
                          placeholder={`Đến mức (${isWater ? 'm³' : 'kWh'})`}
                          style={{ width: 200 }}
                        />
                      </Form.Item>
                    )}
                    <Form.Item
                      {...restField}
                      name={[name, 'unitPrice']}
                      style={{ marginBottom: 0 }}
                      rules={[{ required: true, message: 'Nhập đơn giá' }]}
                    >
                      <InputNumber
                        min={0}
                        step={100}
                        placeholder="Đơn giá (VNĐ)"
                        style={{ width: 180 }}
                        formatter={formatVnNumber}
                        parser={parseVnNumber}
                      />
                    </Form.Item>
                    <Text type="secondary" style={{ lineHeight: '32px' }}>VNĐ/{isWater ? 'm³' : 'kWh'}</Text>
                    {fields.length > 1 && !isLast && (
                      <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(name)} />
                    )}
                  </Flex>
                );
              })}
              <Button
                type="dashed"
                onClick={() => {
                  const currentTiers = form.getFieldValue('tiers') || [];
                  const last = currentTiers[currentTiers.length - 1];
                  const prev = currentTiers.length > 1 ? currentTiers[currentTiers.length - 2] : null;
                  const newUpTo = prev ? prev.upTo + 50 : 50;
                  const newTiers = [
                    ...currentTiers.slice(0, -1),
                    { upTo: newUpTo, unitPrice: last.unitPrice },
                    { upTo: null, unitPrice: last.unitPrice + 500 },
                  ];
                  form.setFieldsValue({ tiers: newTiers });
                  runCalculator();
                }}
                icon={<PlusOutlined />}
                style={{ width: 200, marginTop: 8 }}
              >
                Thêm bậc giá
              </Button>
            </Flex>
          )}
        </Form.List>

        <Card size="small" style={{ marginTop: 16, background: '#f9f9f9' }}>
          <Title level={5} style={{ margin: 0, marginBottom: 8 }}>
            <CalculatorOutlined style={{ marginRight: 6 }} />
            Xem thử số tiền tính theo biểu giá này:
          </Title>
          <Flex gap={16} align="center" wrap="wrap">
            <Flex align="center" gap={8}>
              <Text>Lượng tiêu thụ:</Text>
              <InputNumber
                min={0}
                value={testConsumption}
                onChange={(val) => {
                  setTestConsumption(val || 0);
                  runCalculator({ consumption: val || 0 });
                }}
                style={{ width: 100 }}
              />
              <Text>{isWater ? 'm³' : 'kWh'}</Text>
            </Flex>
            {isWater && form.getFieldValue('perOccupant') && (
              <Flex align="center" gap={8}>
                <Text>Số người ở:</Text>
                <InputNumber
                  min={1}
                  value={testOccupants}
                  onChange={(val) => {
                    setTestOccupants(val || 1);
                    runCalculator({ occupants: val || 1 });
                  }}
                  style={{ width: 80 }}
                />
                <Text>người</Text>
              </Flex>
            )}
            <Flex align="center" gap={8} style={{ marginLeft: 'auto' }}>
              <Text strong>Thành tiền dự kiến:</Text>
              <Text strong style={{ fontSize: 16, color: '#c9a35b' }}>
                {formatMoney(calculatedAmount)}
              </Text>
            </Flex>
          </Flex>
        </Card>
      </Form>
    </Modal>
  );
}

function UtilityTariffsSection() {
  const [modalUtility, setModalUtility] = useState(null); // 'ELECTRICITY' | 'WATER' | null
  const tariffs = useApi(() => utilityTariffsApi.list(), []);

  const [deleteTariff] = useAction((id) => utilityTariffsApi.delete(id), {
    success: 'Đã xóa biểu giá',
    onDone: tariffs.reload,
  });

  const columns = [
    {
      title: 'Loại tiện ích',
      dataIndex: 'utility',
      width: 140,
      render: (v) =>
        v === 'ELECTRICITY' ? (
          <Tag color="gold" icon={<ThunderboltOutlined />}>
            ĐIỆN
          </Tag>
        ) : (
          <Tag color="blue">NƯỚC</Tag>
        ),
    },
    {
      title: 'Kỳ áp dụng',
      dataIndex: 'fromPeriod',
      width: 160,
      render: (v, r) => (r.toPeriod ? `${periodText(v)} → ${periodText(r.toPeriod)}` : `Từ ${periodText(v)}`),
    },
    {
      title: 'Số bậc',
      dataIndex: 'tiers',
      width: 100,
      render: (tiers) => `${tiers?.length || 0} bậc`,
    },
    {
      title: 'Định mức theo người',
      dataIndex: 'perOccupant',
      width: 180,
      render: (v, r) =>
        r.utility === 'WATER' ? (
          v ? <Tag color="green">Theo đầu người</Tag> : <Tag>Tính chung căn</Tag>
        ) : (
          '—'
        ),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'state',
      width: 140,
      render: (s) => {
        if (s === 'ACTIVE') return <Tag color="green">Đang áp dụng</Tag>;
        if (s === 'UPCOMING') return <Tag color="cyan">Sắp áp dụng</Tag>;
        return <Tag color="default">Đã hết hạn</Tag>;
      },
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      render: (_, r) =>
        r.canDelete && (
          <Popconfirm
            title="Xóa phiên bản biểu giá này?"
            description="Chỉ xóa được phiên bản ở kỳ tương lai chưa có hiệu lực."
            onConfirm={() => deleteTariff(r._id).catch(() => {})}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              Xóa
            </Button>
          </Popconfirm>
        ),
    },
  ];

  return (
    <Card
      title="Biểu giá điện, nước bậc thang"
      extra={
        <Space>
          <Button icon={<PlusOutlined />} onClick={() => setModalUtility('ELECTRICITY')}>
            Đổi giá điện
          </Button>
          <Button icon={<PlusOutlined />} onClick={() => setModalUtility('WATER')}>
            Đổi giá nước
          </Button>
        </Space>
      }
      style={{ marginTop: 24 }}
    >
      <Table
        rowKey="_id"
        loading={tariffs.loading}
        dataSource={tariffs.data}
        columns={columns}
        pagination={false}
        expandable={{
          expandedRowRender: (r) => (
            <Table
              size="small"
              pagination={false}
              dataSource={r.tiers}
              rowKey={(t, idx) => idx}
              columns={[
                { title: 'Bậc', render: (_, __, idx) => `Bậc ${idx + 1}` },
                {
                  title: 'Đến mức',
                  dataIndex: 'upTo',
                  render: (val) => (val === null ? 'Trở lên' : `${val} ${r.utility === 'WATER' ? 'm³' : 'kWh'}`),
                },
                {
                  title: 'Đơn giá',
                  dataIndex: 'unitPrice',
                  render: (price) => `${formatMoney(price)}/${r.utility === 'WATER' ? 'm³' : 'kWh'}`,
                },
              ]}
            />
          ),
        }}
      />
      {modalUtility && (
        <TariffModal
          open={Boolean(modalUtility)}
          utility={modalUtility}
          onClose={() => setModalUtility(null)}
          onDone={tariffs.reload}
        />
      )}
    </Card>
  );
}

function FeeScheduleTab() {
  return (
    <div>
      <Typography.Paragraph type="secondary">
        Biểu phí bao gồm Phí quản lý, Phí vệ sinh, Phí gửi xe và Biểu giá điện nước bậc thang. Mọi thay đổi đơn giá luôn
        được tự động áp dụng từ kỳ kế tiếp.
      </Typography.Paragraph>
      {/* Tái sử dụng bảng phí sẵn có cho Quản lý / Vệ sinh / Gửi xe */}
      <FeeTypesPage embedded />
      {/* Khu vực điện nước bậc thang */}
      <UtilityTariffsSection />
    </div>
  );
}

// ==========================================
// TAB 3: CÔNG TẮC THU HỘ
// ==========================================
/** Định mức nước theo đầu người (m³/người/tháng) của kỳ hiện tại và kỳ sau; sửa thì áp dụng từ kỳ sau */
function WaterQuotaEditor({ row, nextPeriod, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(null);
  const current = row?.current?.waterQuotaPerOccupant ?? null;
  const next = row?.upcoming ? (row.upcoming.waterQuotaPerOccupant ?? null) : current;
  const text = (q) => (q == null ? 'Không áp định mức' : `${q} m³/người/tháng`);

  return (
    <div style={{ marginTop: 12, padding: 12, borderRadius: 6, border: '1px solid #f0f0f0' }}>
      <Text strong style={{ display: 'block' }}>
        Định mức nước theo đầu người
      </Text>
      {editing ? (
        <Flex gap={8} align="center" wrap="wrap" style={{ marginTop: 8 }}>
          <InputNumber
            min={0.1}
            max={100}
            step={0.5}
            value={value}
            onChange={setValue}
            placeholder="Để trống = không áp"
            style={{ width: 170 }}
          />
          <Text type="secondary">m³/người/tháng</Text>
          <Button
            size="small"
            type="primary"
            onClick={async () => {
              if (await onSave(value ?? null)) setEditing(false);
            }}
          >
            Lưu
          </Button>
          <Button size="small" onClick={() => setEditing(false)}>
            Hủy
          </Button>
        </Flex>
      ) : (
        <Flex justify="space-between" align="center" gap={8} wrap="wrap" style={{ marginTop: 4 }}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Hiện tại: {text(current)}
            {next !== current && ` · Từ ${periodText(nextPeriod)}: ${text(next)}`}
          </Text>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setValue(next);
              setEditing(true);
            }}
          >
            Đổi định mức
          </Button>
        </Flex>
      )}
    </div>
  );
}

function CollectionTab() {
  const { modal } = App.useApp();
  const settings = useApi(() => collectionSettingsApi.get(), []);
  const tariffs = useApi(() => utilityTariffsApi.list(), []);

  // useAction tự báo res.message → không báo thêm lần nữa
  const [updateSetting] = useAction((payload) => collectionSettingsApi.update(payload), { onDone: settings.reload });
  const [cancelUpcoming] = useAction((utility) => collectionSettingsApi.cancelUpcoming(utility), { onDone: settings.reload });

  // Định mức nước (m³/người/tháng): như công tắc, có hiệu lực từ kỳ sau; giữ nguyên trạng thái BẬT
  const saveQuota = (quota) =>
    new Promise((resolve) => {
      modal.confirm({
        title: 'Đổi định mức nước theo đầu người?',
        content: `Định mức mới (${quota == null ? 'không áp định mức' : `${quota} m³/người/tháng`}) có hiệu lực từ kỳ ${periodText(settings.data?.nextPeriod)}. Kỳ hiện tại giữ nguyên.`,
        okText: 'Lưu',
        cancelText: 'Đóng',
        onOk: () => updateSetting({ utility: 'WATER', enabled: true, waterQuotaPerOccupant: quota }).then(() => resolve(true), () => resolve(false)),
        onCancel: () => resolve(false),
      });
    });

  const data = settings.data?.settings;
  const hasTariff =(utility) => (tariffs.data || []).some((t) => t.utility === utility && t.state !== 'EXPIRED');

  const handleToggle = (utility, nextEnabled, row) => {
    const name = utility === 'ELECTRICITY' ? 'ĐIỆN' : 'NƯỚC';
    // Chọn lại đúng trạng thái kỳ hiện tại = hủy lịch hẹn
    const backToCurrent = nextEnabled === Boolean(row?.current?.enabled);
    modal.confirm({
      title: backToCurrent
        ? `Hủy lịch hẹn đổi thu hộ tiền ${name}?`
        : `Xác nhận ${nextEnabled ? 'BẬT' : 'TẮT'} thu hộ tiền ${name}?`,
      content: backToCurrent
        ? 'Kỳ sau sẽ giữ nguyên trạng thái thu hộ như kỳ hiện tại.'
        : `Thay đổi có hiệu lực từ đầu kỳ tính phí tiếp theo (${periodText(settings.data?.nextPeriod)}). Kỳ hiện tại vẫn giữ nguyên trạng thái cũ.` +
          (nextEnabled && !hasTariff(utility) ? ` Lưu ý: chưa có biểu giá ${name.toLowerCase()} nào, cần thêm ở tab Biểu phí trước kỳ tính phí.` : ''),
      okText: backToCurrent ? 'Hủy lịch hẹn' : 'Xác nhận đổi',
      cancelText: 'Đóng',
      onOk: () =>
        (backToCurrent
          ? cancelUpcoming(utility)
          : updateSetting({ utility, enabled: nextEnabled, waterQuotaPerOccupant: row?.current?.waterQuotaPerOccupant ?? null })
        ).catch(() => {}),
    });
  };

  const renderUtility = (utility, title) => {
    const row = data?.[utility];
    const currentOn = Boolean(row?.current?.enabled);
    const upcoming = row?.upcoming;
    // Công tắc thể hiện trạng thái của kỳ sau (đã tính lịch hẹn) để bấm lại là hủy được hẹn
    const nextOn = upcoming ? Boolean(upcoming.enabled) : currentOn;
    const missingTariff = !tariffs.loading && (currentOn || nextOn) && !hasTariff(utility);
    return (
      <Card type="inner" title={title}>
        <Flex justify="space-between" align="center" style={{ marginBottom: 16 }} gap={12}>
          <div>
            <Text strong style={{ display: 'block' }}>
              Kỳ hiện tại ({periodText(settings.data?.currentPeriod)}):
            </Text>
            <Tag color={currentOn ? 'green' : 'default'} style={{ marginTop: 4 }}>
              {currentOn ? 'ĐANG BẬT THU HỘ' : 'ĐANG TẮT (Không thu hộ)'}
            </Tag>
          </div>
          <Flex vertical align="end" gap={4}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Từ kỳ sau
            </Text>
            <Switch
              checked={nextOn}
              checkedChildren="Bật"
              unCheckedChildren="Tắt"
              onChange={(checked) => handleToggle(utility, checked, row)}
            />
          </Flex>
        </Flex>

        {upcoming && Boolean(upcoming.enabled) !== currentOn && (
          <Flex
            justify="space-between"
            align="center"
            gap={8}
            wrap="wrap"
            style={{ background: '#f6ffed', padding: 12, borderRadius: 6, border: '1px solid #b7eb8f' }}
          >
            <span>
              <Text type="success" strong>
                Đã hẹn từ kỳ {periodText(upcoming.fromPeriod)}:{' '}
              </Text>
              <Text>{upcoming.enabled ? 'Sẽ BẬT thu hộ' : 'Sẽ TẮT thu hộ'}</Text>
            </span>
            <Popconfirm title="Hủy lịch hẹn này?" description="Kỳ sau giữ nguyên trạng thái hiện tại." onConfirm={() => cancelUpcoming(utility).catch(() => {})}>
              <Button size="small">Hủy lịch hẹn</Button>
            </Popconfirm>
          </Flex>
        )}

        {utility === 'WATER' && nextOn && <WaterQuotaEditor row={row} nextPeriod={settings.data?.nextPeriod} onSave={saveQuota} />}

        {missingTariff && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 12 }}
            message={`Chưa có biểu giá ${utility === 'ELECTRICITY' ? 'điện' : 'nước'}`}
            description="Đang bật thu hộ nhưng chưa có biểu giá nào. Thêm biểu giá ở tab Biểu phí, nếu không Kế toán sẽ thiếu giá khi tính phí."
          />
        )}
      </Card>
    );
  };

  return (
    <Card title="Cấu hình BQL thu hộ Điện & Nước" loading={settings.loading}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 24 }}>
        Khi bật thu hộ, hệ thống sẽ mở màn hình ghi chỉ số đồng hồ và đưa dòng phí vào thông báo phí hàng tháng của cư
        dân. Nếu tắt, màn hình ghi chỉ số và các dòng phí tương ứng sẽ tự động ẩn đi. Mọi thay đổi có hiệu lực từ kỳ sau.
      </Typography.Paragraph>

      <Row gutter={[24, 24]}>
        <Col xs={24} md={12}>
          {renderUtility(
            'ELECTRICITY',
            <Space>
              <ThunderboltOutlined style={{ color: '#faad14' }} />
              <span>Thu tiền Điện</span>
            </Space>,
          )}
        </Col>
        <Col xs={24} md={12}>
          {renderUtility(
            'WATER',
            <Space>
              <span style={{ color: '#1890ff' }}>💧</span>
              <span>Thu tiền Nước</span>
            </Space>,
          )}
        </Col>
      </Row>
    </Card>
  );
}

// ==========================================
// TAB 4: LỊCH & THỜI HẠN
// ==========================================
function DeadlinesTab() {
  const configs = useApi(() => systemConfigApi.list(), []);
  const [editingKey, setEditingKey] = useState(null);
  const [editValue, setEditValue] = useState(null);

  // Server trả cả tham số chưa có trong DB kèm giá trị mặc định (isDefault)
  const configMap = new Map((configs.data || []).map((c) => [c.key, c]));

  const [save, saving] = useAction((key) => systemConfigApi.update(key, editValue), {
    success: 'Đã cập nhật tham số',
    onDone: async () => {
      setEditingKey(null);
      await configs.reload();
    },
  });

  return (
    <Flex vertical gap={24}>
      {CONFIG_GROUPS.map((group) => (
        <Card key={group.title} title={group.title} size="small" loading={configs.loading}>
          <Flex vertical gap={12}>
            {group.keys.map((key) => {
              const cfg = configMap.get(key);
              const meta = CONFIG_METADATA[key] || { label: key, unit: '' };
              const min = meta.min ?? 1; // số ngày / phút / lần phải > 0
              const isEditing = editingKey === key;
              const invalid = editValue == null || editValue < min || (meta.max != null && editValue > meta.max);
              return (
                <Flex
                  key={key}
                  justify="space-between"
                  align="center"
                  gap={12}
                  wrap="wrap"
                  style={{
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: isEditing ? '#f5f5f5' : 'transparent',
                    borderBottom: '1px solid #f0f0f0',
                  }}
                >
                  <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                    <Text strong style={{ display: 'block' }}>
                      {meta.label}
                    </Text>
                    {cfg?.description && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {cleanConfigDescription(cfg.description)}
                      </Text>
                    )}
                  </div>

                  {isEditing ? (
                    <Flex vertical gap={4} align="end">
                      <Flex gap={8} align="center">
                        <InputNumber
                          min={min}
                          max={meta.max}
                          precision={0}
                          value={editValue}
                          onChange={setEditValue}
                          status={invalid ? 'error' : undefined}
                          style={{ width: 120 }}
                        />
                        <Text type="secondary">{meta.unit}</Text>
                        <Button
                          size="small"
                          type="primary"
                          loading={saving}
                          disabled={invalid}
                          onClick={() => save(key).catch(() => {})}
                        >
                          Lưu
                        </Button>
                        <Button size="small" onClick={() => setEditingKey(null)}>
                          Hủy
                        </Button>
                      </Flex>
                      <Text type={invalid ? 'danger' : 'secondary'} style={{ fontSize: 12 }}>
                        {meta.max != null ? `Từ ${min} đến ${meta.max}` : `Tối thiểu ${min}`}
                      </Text>
                    </Flex>
                  ) : (
                    <Flex gap={12} align="center">
                      <Text strong style={{ fontSize: 15 }}>
                        {cfg ? cfg.value : '—'} {meta.unit}
                      </Text>
                      {cfg?.isDefault && <Tag>Mặc định</Tag>}
                      <Button
                        size="small"
                        type="text"
                        icon={<EditOutlined />}
                        disabled={!cfg}
                        onClick={() => {
                          setEditingKey(key);
                          setEditValue(cfg?.value);
                        }}
                      />
                    </Flex>
                  )}
                </Flex>
              );
            })}
          </Flex>
        </Card>
      ))}

      {/* Thông tin tham số xác thực cố định */}
      <Card title="Xác thực & Mã bảo mật (Cố định)" size="small">
        <Descriptions column={{ xs: 1, sm: 2 }} size="small">
          <Descriptions.Item label="Thời hạn mã OTP xác thực email">
            <Tag color="blue">10 phút (cố định)</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Thời hạn mã kích hoạt in tại quầy">
            <Tag color="blue">48 giờ (cố định)</Tag>
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </Flex>
  );
}

// Tạm ẩn tab Thu hộ: module tính phí chưa dùng công tắc thu hộ / định mức nước.
// Đổi thành true để hiện lại (code tab và API vẫn giữ nguyên).
const SHOW_COLLECTION_TAB = false;

// ==========================================
// TRANG CHÍNH: THÔNG TIN TÒA NHÀ & BIỂU PHÍ
// ==========================================
export default function BuildingSettingsPage() {
  const [activeTab, setActiveTab] = useState('profile');

  const tabItems = [
    {
      key: 'profile',
      label: (
        <span>
          <BankOutlined /> Tòa nhà
        </span>
      ),
      children: <BuildingProfileTab />,
    },
    {
      key: 'fees',
      label: (
        <span>
          <ThunderboltOutlined /> Biểu phí
        </span>
      ),
      children: <FeeScheduleTab />,
    },
    {
      key: 'collection',
      label: (
        <span>
          <CalculatorOutlined /> Thu hộ
        </span>
      ),
      children: <CollectionTab />,
      hidden: !SHOW_COLLECTION_TAB,
    },
    {
      key: 'deadlines',
      label: (
        <span>
          <ClockCircleOutlined /> Lịch & thời hạn
        </span>
      ),
      children: <DeadlinesTab />,
    },
  ].filter((tab) => !tab.hidden);

  return (
    <>
      <PageHeader
        title="Thông tin tòa nhà & Biểu phí"
        subtitle="Hồ sơ pháp lý, tài khoản thanh toán, biểu phí dịch vụ và thời hạn hệ thống"
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Tòa nhà & biểu phí' }]}
      />
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} size="large" />
    </>
  );
}

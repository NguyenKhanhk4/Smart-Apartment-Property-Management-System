import { useState } from 'react';
import {
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

const { Text, Title } = Typography;

// ==========================================
// TAB 1: THÔNG TIN TÒA NHÀ
// ==========================================
function BuildingProfileTab() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [fileList, setFileList] = useState([]);
  const [userLogoUrl, setUserLogoUrl] = useState(null);

  const profile = useApi(async () => {
    const res = await buildingProfileApi.get();
    return res.data;
  }, []);

  const previewLogo = userLogoUrl !== null ? userLogoUrl : (profile.data?.logoUrl || '');

  const [saveProfile, saving] = useAction(
    async (values) => {
      const formData = new FormData();
      Object.entries(values).forEach(([k, v]) => {
        formData.append(k, v || '');
      });
      if (fileList.length > 0 && fileList[0].originFileObj) {
        formData.append('logo', fileList[0].originFileObj);
      }
      return buildingProfileApi.update(formData);
    },
    {
      success: 'Đã lưu cấu hình. Thay đổi phí áp dụng từ kỳ tính phí sau.',
      onDone: profile.reload,
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
        key={profile.data?._id || 'new'}
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
              rules={[{ required: true, message: 'Nhập tên chủ tài khoản' }]}
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
  const { message } = App.useApp();
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
      return utilityTariffsApi.create(payload);
    },
    {
      onDone: (res) => {
        if (res?.message) message.info(res.message);
        onClose();
        onDone();
      },
    },
  );

  // Tính thử tiền realtime
  const runCalculator = () => {
    const values = form.getFieldsValue();
    const tiers = values.tiers || [];
    const perOccupant = isWater && values.perOccupant;
    const nOccupants = perOccupant ? Math.max(1, Number(testOccupants) || 1) : 1;

    let remaining = Number(testConsumption) || 0;
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
        onValuesChange={runCalculator}
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
                extra="Mức bậc thang nhân với số người ở trong căn (BR-F03)"
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
                  <Flex key={key} gap={12} align="center">
                    <Text strong style={{ width: 60 }}>
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
                        noStyle
                        rules={[{ required: true, message: 'Nhập mức' }]}
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
                      noStyle
                      rules={[{ required: true, message: 'Nhập đơn giá' }]}
                    >
                      <InputNumber
                        min={0}
                        step={100}
                        placeholder="Đơn giá (VNĐ)"
                        style={{ width: 180 }}
                        formatter={(val) => `${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                      />
                    </Form.Item>
                    <Text type="secondary">VNĐ/{isWater ? 'm³' : 'kWh'}</Text>
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
                  runCalculator();
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
                    runCalculator();
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
      render: (v, r) => `${v} → ${r.toPeriod ? r.toPeriod : 'nay'}`,
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
        được tự động áp dụng từ kỳ kế tiếp (BR-S08).
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
function CollectionTab() {
  const { message } = App.useApp();
  const settings = useApi(() => collectionSettingsApi.get(), []);

  const [updateSetting] = useAction((payload) => collectionSettingsApi.update(payload), {
    onDone: (res) => {
      if (res?.message) message.info(res.message);
      settings.reload();
    },
  });

  const handleToggle = (utility, nextEnabled, currentQuota) => {
    Modal.confirm({
      title: `Xác nhận ${nextEnabled ? 'BẬT' : 'TẮT'} thu hộ tiền ${utility === 'ELECTRICITY' ? 'ĐIỆN' : 'NƯỚC'}?`,
      content:
        'Theo quy tắc BR-S09, thay đổi này sẽ có hiệu lực từ đầu kỳ tính phí tiếp theo. Kỳ hiện tại vẫn giữ nguyên trạng thái cũ.',
      okText: 'Xác nhận đổi',
      cancelText: 'Hủy',
      onOk: () =>
        updateSetting({
          utility,
          enabled: nextEnabled,
          waterQuotaPerOccupant: currentQuota,
        }).catch(() => {}),
    });
  };

  const data = settings.data?.settings;

  return (
    <Card title="Cấu hình BQL thu hộ Điện & Nước" loading={settings.loading}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 24 }}>
        Khi bật thu hộ, hệ thống sẽ mở màn hình ghi chỉ số đồng hồ và đưa dòng phí vào thông báo phí hàng tháng của cư
        dân. Nếu tắt, màn hình ghi chỉ số và các dòng phí tương ứng sẽ tự động ẩn đi (BR-S09).
      </Typography.Paragraph>

      <Row gutter={[24, 24]}>
        {/* Thu hộ Điện */}
        <Col xs={24} md={12}>
          <Card
            type="inner"
            title={
              <Space>
                <ThunderboltOutlined style={{ color: '#faad14' }} />
                <span>Thu tiền Điện</span>
              </Space>
            }
          >
            <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
              <div>
                <Text strong style={{ display: 'block' }}>
                  Trạng thái kỳ hiện tại:
                </Text>
                <Tag color={data?.ELECTRICITY?.current?.enabled ? 'green' : 'default'} style={{ marginTop: 4 }}>
                  {data?.ELECTRICITY?.current?.enabled ? 'ĐANG BẬT THU HỘ' : 'ĐANG TẮT (Không thu hộ)'}
                </Tag>
              </div>
              <Switch
                checked={data?.ELECTRICITY?.current?.enabled}
                onChange={(checked) => handleToggle('ELECTRICITY', checked, null)}
              />
            </Flex>

            {data?.ELECTRICITY?.upcoming && (
              <div style={{ background: '#f6ffed', padding: 12, borderRadius: 6, border: '1px solid #b7eb8f' }}>
                <Text type="success" strong>
                  Đã hẹn từ kỳ {data.ELECTRICITY.upcoming.fromPeriod}:{' '}
                </Text>
                <Text>{data.ELECTRICITY.upcoming.enabled ? 'Sẽ BẬT thu hộ' : 'Sẽ TẮT thu hộ'}</Text>
              </div>
            )}
          </Card>
        </Col>

        {/* Thu hộ Nước */}
        <Col xs={24} md={12}>
          <Card
            type="inner"
            title={
              <Space>
                <span style={{ color: '#1890ff' }}>💧</span>
                <span>Thu tiền Nước</span>
              </Space>
            }
          >
            <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
              <div>
                <Text strong style={{ display: 'block' }}>
                  Trạng thái kỳ hiện tại:
                </Text>
                <Tag color={data?.WATER?.current?.enabled ? 'green' : 'default'} style={{ marginTop: 4 }}>
                  {data?.WATER?.current?.enabled ? 'ĐANG BẬT THU HỘ' : 'ĐANG TẮT (Không thu hộ)'}
                </Tag>
              </div>
              <Switch
                checked={data?.WATER?.current?.enabled}
                onChange={(checked) => handleToggle('WATER', checked, data?.WATER?.current?.waterQuotaPerOccupant)}
              />
            </Flex>

            {data?.WATER?.upcoming && (
              <div style={{ background: '#f6ffed', padding: 12, borderRadius: 6, border: '1px solid #b7eb8f' }}>
                <Text type="success" strong>
                  Đã hẹn từ kỳ {data.WATER.upcoming.fromPeriod}:{' '}
                </Text>
                <Text>{data.WATER.upcoming.enabled ? 'Sẽ BẬT thu hộ' : 'Sẽ TẮT thu hộ'}</Text>
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </Card>
  );
}

// ==========================================
// TAB 4: LỊCH & THỜI HẠN (BR-X8)
// ==========================================
const CONFIG_GROUPS = [
  {
    title: 'Thu phí & Thanh toán',
    keys: ['BILLING_REMIND_DAY', 'PAYMENT_TERM_DAYS', 'INVOICE_APPROVAL_REMIND_DAYS', 'DEBT_REMINDER_INTERVAL_DAYS', 'DEBT_REMINDER_MAX'],
  },
  {
    title: 'Chờ cư dân & Khách hàng phản hồi (BR-X8)',
    keys: ['OWNER_CONFIRM_REMIND_DAYS', 'OWNER_CONFIRM_AUTO_CANCEL_DAYS', 'QUOTE_REMIND_DAYS', 'QUOTE_AUTO_CLOSE_DAYS'],
  },
  {
    title: 'Bảo trì & Quỹ',
    keys: ['FUND_APPROVAL_REMIND_DAYS', 'REPAIR_REVIEW_REPEAT_DAYS', 'REPAIR_POSTPONE_MAX_DAYS', 'REPAIR_ACCEPTANCE_REMIND_DAYS'],
  },
  {
    title: 'Cảnh báo khẩn cấp & An toàn',
    keys: ['EMERGENCY_REPEAT_MINUTES'],
  },
  {
    title: 'Hệ thống & Tải file',
    keys: ['UPLOAD_MAX_SIZE_MB'],
  },
];

const CONFIG_METADATA = {
  BILLING_REMIND_DAY: { label: 'Ngày nhắc lập thông báo phí', unit: 'Hàng tháng', max: 28 },
  PAYMENT_TERM_DAYS: { label: 'Hạn nộp phí sau khi phát hành', unit: 'ngày' },
  INVOICE_APPROVAL_REMIND_DAYS: { label: 'Nhắc duyệt thông báo phí sau', unit: 'ngày' },
  DEBT_REMINDER_INTERVAL_DAYS: { label: 'Khoảng cách giữa các lần nhắc nợ', unit: 'ngày' },
  DEBT_REMINDER_MAX: { label: 'Số lần nhắc nợ tối đa trước khi báo Trưởng BQL', unit: 'lần' },
  OWNER_CONFIRM_REMIND_DAYS: { label: 'Chủ nhà chưa xác nhận yêu cầu: nhắc sau', unit: 'ngày' },
  OWNER_CONFIRM_AUTO_CANCEL_DAYS: { label: 'Chủ nhà không phản hồi: tự hủy sau', unit: 'ngày' },
  QUOTE_REMIND_DAYS: { label: 'Nhắc cư dân đồng ý báo giá sau', unit: 'ngày' },
  QUOTE_AUTO_CLOSE_DAYS: { label: 'Cư dân không đồng ý báo giá: tự đóng sau', unit: 'ngày' },
  FUND_APPROVAL_REMIND_DAYS: { label: 'Nhắc Ban quản trị duyệt chi quỹ sau', unit: 'ngày' },
  REPAIR_REVIEW_REPEAT_DAYS: { label: 'Phiếu hoãn đến hạn xem lại: nhắc lại mỗi', unit: 'ngày' },
  REPAIR_POSTPONE_MAX_DAYS: { label: 'Tạm hoãn sửa chữa tối đa', unit: 'ngày' },
  REPAIR_ACCEPTANCE_REMIND_DAYS: { label: 'Chờ nghiệm thu quá hạn nhắc Trưởng BQL sau', unit: 'ngày' },
  EMERGENCY_REPEAT_MINUTES: { label: 'Khoảng thời gian lặp lại cảnh báo khẩn cấp', unit: 'phút' },
  UPLOAD_MAX_SIZE_MB: { label: 'Dung lượng ảnh tối đa tải lên', unit: 'MB', max: 20 },
};

function DeadlinesTab() {
  const { message } = App.useApp();
  const configs = useApi(() => systemConfigApi.list(), []);
  const [editingKey, setEditingKey] = useState(null);
  const [editValue, setEditValue] = useState(null);

  const configMap = new Map((configs.data || []).map((c) => [c.key, c]));

  const handleSave = async (key) => {
    try {
      await systemConfigApi.update(key, editValue);
      message.success('Đã cập nhật tham số');
      setEditingKey(null);
      configs.reload();
    } catch (err) {
      message.error(err.message || 'Lỗi cập nhật tham số');
    }
  };

  return (
    <Flex vertical gap={24}>
      {CONFIG_GROUPS.map((group) => (
        <Card key={group.title} title={group.title} size="small">
          <Flex vertical gap={12}>
            {group.keys.map((key) => {
              const cfg = configMap.get(key);
              const meta = CONFIG_METADATA[key] || { label: key, unit: '' };
              const isEditing = editingKey === key;
              return (
                <Flex
                  key={key}
                  justify="space-between"
                  align="center"
                  style={{
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: isEditing ? '#f5f5f5' : 'transparent',
                    borderBottom: '1px solid #f0f0f0',
                  }}
                >
                  <div style={{ maxWidth: '65%' }}>
                    <Text strong style={{ display: 'block' }}>
                      {meta.label}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {cfg?.description || key}
                    </Text>
                  </div>

                  {isEditing ? (
                    <Flex gap={8} align="center">
                      <InputNumber
                        min={0}
                        max={meta.max}
                        value={editValue}
                        onChange={setEditValue}
                        style={{ width: 120 }}
                      />
                      <Text type="secondary">{meta.unit}</Text>
                      <Button size="small" type="primary" onClick={() => handleSave(key)}>
                        Lưu
                      </Button>
                      <Button size="small" onClick={() => setEditingKey(null)}>
                        Hủy
                      </Button>
                    </Flex>
                  ) : (
                    <Flex gap={12} align="center">
                      <Text strong style={{ fontSize: 15 }}>
                        {cfg ? cfg.value : '—'} {meta.unit}
                      </Text>
                      <Button
                        size="small"
                        type="text"
                        icon={<EditOutlined />}
                        onClick={() => {
                          setEditingKey(key);
                          setEditValue(cfg?.value ?? 0);
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

// ==========================================
// TRANG CHÍNH: CẤU HÌNH TÒA NHÀ & BIỂU PHÍ (UC05)
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
  ];

  return (
    <>
      <PageHeader
        title="Thông tin tòa nhà & Biểu phí"
        subtitle="Hồ sơ pháp lý, tài khoản thanh toán, biểu phí dịch vụ, công tắc thu hộ và thời hạn hệ thống (UC05)"
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Tòa nhà & biểu phí' }]}
      />
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} size="large" />
    </>
  );
}

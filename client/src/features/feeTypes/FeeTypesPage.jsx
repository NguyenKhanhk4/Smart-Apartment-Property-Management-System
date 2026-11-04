import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { LockOutlined, PlusOutlined } from '@ant-design/icons';
import { feeTypeApi } from '../../api/moduleB.api';
import PageHeader from '../../components/PageHeader';
import EnumTag from '../../components/EnumTag';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { FEE_CALC_METHODS, FEE_CATEGORIES, FEE_TYPE_STATES, VEHICLE_TYPES, enumOptions } from '../../constants/enums';
import { formatMoney, moneyInputProps } from '../../utils/format';

// Phí tiện ích do Module D định giá trên từng tiện ích → chỉ cấu hình vệ sinh & gửi xe ở đây
const CATEGORY_OPTIONS = ['CLEANING', 'PARKING'].map((v) => ({ value: v, label: FEE_CATEGORIES[v].label }));
const CALC_OPTIONS_BY_CATEGORY = {
  CLEANING: ['PER_M2', 'PER_APARTMENT'],
  PARKING: ['PER_VEHICLE'],
};

const periodLabel = (p) => (p ? `${p.slice(5)}/${p.slice(0, 4)}` : '');
const rangeLabel = (v) => `${periodLabel(v.fromPeriod)} → ${v.endPeriod ? periodLabel(v.endPeriod) : 'nay'}`;
const priceWithUnit = (price, calcMethod) => `${formatMoney(price)} / ${FEE_CALC_METHODS[calcMethod]?.unit ?? ''}`;
const toPeriod = (d) => d.format('YYYY-MM');
// Chỉ áp dụng / ngừng thu từ kỳ hiện tại trở đi (backend kiểm tra lại theo giờ VN)
const beforeThisMonth = (d) => d.isBefore(dayjs().startOf('month'));

const monthField = (name, label, extra) => (
  <Form.Item name={name} label={label} extra={extra} rules={[{ required: true, message: 'Chọn kỳ' }]}>
    <DatePicker picker="month" format="MM/YYYY" disabledDate={beforeThisMonth} style={{ width: '100%' }} />
  </Form.Item>
);

const priceField = (
  <Form.Item name="unitPrice" label="Đơn giá (VNĐ/tháng)" rules={[{ required: true, message: 'Nhập đơn giá' }]}>
    <InputNumber
      min={0}
      step={1000}
      style={{ width: '100%' }}
      {...moneyInputProps}
    />
  </Form.Item>
);

// Thêm mã phí mới
function NewFeeTypeModal({ onClose, onDone }) {
  const [form] = Form.useForm();
  const category = Form.useWatch('feeCategory', form);
  const [save, saving] = useAction((v) => feeTypeApi.create(v), { onDone: () => (onClose(), onDone()) });

  return (
    <Modal title="Thêm loại phí" open onCancel={onClose} onOk={() => form.submit()} confirmLoading={saving} destroyOnHidden>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ feeCategory: 'CLEANING', calcMethod: 'PER_M2', effectiveFrom: dayjs().add(1, 'month') }}
        onValuesChange={(changed) => {
          if (changed.feeCategory) {
            form.setFieldsValue({ calcMethod: CALC_OPTIONS_BY_CATEGORY[changed.feeCategory][0], vehicleType: undefined });
          }
        }}
        onFinish={(v) => save({ ...v, effectiveFrom: toPeriod(v.effectiveFrom) }).catch(() => {})}
      >
        <Flex gap={12}>
          <Form.Item
            name="code"
            label="Mã phí"
            style={{ flex: 1 }}
            normalize={(v) => v?.toUpperCase().replace(/[^A-Z0-9_]/g, '')}
            rules={[{ required: true, min: 2, message: 'Mã gồm chữ in hoa, số, dấu _ (≥ 2 ký tự)' }]}
          >
            <Input placeholder="vd PARKING_MOTORBIKE" maxLength={40} />
          </Form.Item>
          <Form.Item name="name" label="Tên hiển thị" style={{ flex: 1 }} rules={[{ required: true, message: 'Nhập tên' }]}>
            <Input placeholder="vd Vé xe máy" maxLength={100} />
          </Form.Item>
        </Flex>
        <Flex gap={12}>
          <Form.Item name="feeCategory" label="Nhóm phí" style={{ flex: 1 }}>
            <Select options={CATEGORY_OPTIONS} />
          </Form.Item>
          <Form.Item name="calcMethod" label="Cách tính" style={{ flex: 1 }}>
            <Select
              options={(CALC_OPTIONS_BY_CATEGORY[category] ?? []).map((v) => ({ value: v, label: FEE_CALC_METHODS[v].label }))}
            />
          </Form.Item>
        </Flex>
        {category === 'PARKING' && (
          <Form.Item name="vehicleType" label="Loại xe" rules={[{ required: true, message: 'Chọn loại xe' }]}>
            <Select options={enumOptions(VEHICLE_TYPES)} />
          </Form.Item>
        )}
        <Flex gap={12}>
          <div style={{ flex: 1 }}>{priceField}</div>
          <div style={{ flex: 1 }}>{monthField('effectiveFrom', 'Áp dụng từ kỳ')}</div>
        </Flex>
      </Form>
    </Modal>
  );
}

// Đổi giá: tạo mức mới từ một kỳ, mức đang áp dụng tự kết thúc ở kỳ liền trước
function ChangePriceModal({ group, onClose, onDone }) {
  const [form] = Form.useForm();
  const [save, saving] = useAction((v) => feeTypeApi.create(v), { onDone: () => (onClose(), onDone()) });
  const current = group.current ?? group.versions[0];

  return (
    <Modal title={`Đổi giá: ${group.name}`} open onCancel={onClose} onOk={() => form.submit()} confirmLoading={saving} destroyOnHidden>
      <Typography.Paragraph type="secondary">
        Giá hiện tại: <b>{group.current ? priceWithUnit(group.current.unitPrice, group.calcMethod) : 'không áp dụng'}</b>. Mức
        giá mới áp dụng từ kỳ đã chọn; các hóa đơn đã lập giữ nguyên giá cũ.
      </Typography.Paragraph>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ unitPrice: current?.unitPrice, effectiveFrom: dayjs().add(1, 'month') }}
        onFinish={(v) => save({ code: group.code, unitPrice: v.unitPrice, effectiveFrom: toPeriod(v.effectiveFrom) }).catch(() => {})}
      >
        {priceField}
        {monthField('effectiveFrom', 'Áp dụng từ kỳ')}
      </Form>
    </Modal>
  );
}

// Sửa một mức giá: tên áp dụng cho cả mã phí; đơn giá chỉ sửa được khi chưa lập hóa đơn
function EditVersionModal({ version, onClose, onDone }) {
  const [form] = Form.useForm();
  const [save, saving] = useAction((v) => feeTypeApi.update(version._id, v), { onDone: () => (onClose(), onDone()) });

  return (
    <Modal title={`Sửa mức giá ${rangeLabel(version)}`} open onCancel={onClose} onOk={() => form.submit()} confirmLoading={saving} destroyOnHidden>
      {version.inUse && (
        <Alert
          type="info"
          showIcon
          className="!mb-4"
          message="Mức giá đã dùng lập hóa đơn nên không sửa được đơn giá. Muốn đổi giá hãy dùng “Đổi giá” cho kỳ sau."
        />
      )}
      <Form
        form={form}
        layout="vertical"
        initialValues={{ name: version.name, unitPrice: version.unitPrice }}
        onFinish={(v) => save(version.inUse ? { name: v.name } : v).catch(() => {})}
      >
        <Form.Item name="name" label="Tên hiển thị" extra="Đổi tên áp dụng cho mọi mức giá của mã phí này" rules={[{ required: true, message: 'Nhập tên' }]}>
          <Input maxLength={100} />
        </Form.Item>
        <Form.Item name="unitPrice" label="Đơn giá (VNĐ/tháng)" rules={[{ required: true, message: 'Nhập đơn giá' }]}>
          <InputNumber min={0} step={1000} disabled={version.inUse} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function EndModal({ version, onClose, onDone }) {
  const [form] = Form.useForm();
  const [save, saving] = useAction((v) => feeTypeApi.end(version._id, toPeriod(v.effectiveTo)), {
    onDone: () => (onClose(), onDone()),
  });

  return (
    <Modal title={`Ngừng thu: ${version.name}`} open onCancel={onClose} onOk={() => form.submit()} confirmLoading={saving} destroyOnHidden>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ effectiveTo: dayjs().add(1, 'month') }}
        onFinish={(v) => save(v).catch(() => {})}
      >
        {monthField('effectiveTo', 'Ngừng thu từ kỳ', 'Kỳ liền trước là kỳ cuối cùng còn tính phí này')}
      </Form>
    </Modal>
  );
}

// UC-B01 — Danh mục phí & đơn giá theo thời gian. Trưởng BQL cấu hình, Kế toán chỉ xem. Mọi thay đổi ghi audit log.
export default function FeeTypesPage() {
  const { hasRole } = useAuth();
  const canEdit = hasRole('MANAGER');
  const [modal, setModal] = useState(null); // { type: 'new' | 'price' | 'edit' | 'end', target }
  const list = useApi(() => feeTypeApi.list(), []);
  const [remove] = useAction((id) => feeTypeApi.remove(id), { onDone: list.reload });

  // Gom các mức giá theo mã phí; backend đã sắp xếp mới nhất trước
  const groups = useMemo(() => {
    const map = new Map();
    for (const v of list.data ?? []) {
      if (!map.has(v.code)) map.set(v.code, { ...v, versions: [] });
      map.get(v.code).versions.push(v);
    }
    return [...map.values()].map((g) => ({
      ...g,
      current: g.versions.find((v) => v.state === 'ACTIVE') ?? null,
      upcoming: g.versions.filter((v) => v.state === 'UPCOMING').at(-1) ?? null,
      open: g.versions.find((v) => !v.endPeriod) ?? null,
    }));
  }, [list.data]);

  const close = () => setModal(null);

  const versionColumns = [
    { title: 'Kỳ áp dụng', render: (_, v) => rangeLabel(v) },
    { title: 'Đơn giá', dataIndex: 'unitPrice', render: (p, v) => priceWithUnit(p, v.calcMethod) },
    { title: 'Trạng thái', dataIndex: 'state', width: 140, render: (s) => <EnumTag map={FEE_TYPE_STATES} value={s} /> },
    {
      title: 'Hóa đơn',
      dataIndex: 'inUse',
      width: 130,
      render: (inUse) =>
        inUse ? (
          <Tooltip title="Đã dùng lập hóa đơn, giữ nguyên để đối chiếu">
            <Tag icon={<LockOutlined />}>Đã lập HĐ</Tag>
          </Tooltip>
        ) : (
          <Typography.Text type="secondary">Chưa dùng</Typography.Text>
        ),
    },
    ...(canEdit
      ? [
          {
            title: '',
            width: 150,
            render: (_, v) => (
              <Flex gap={4}>
                <Button size="small" onClick={() => setModal({ type: 'edit', target: v })}>
                  Sửa
                </Button>
                {!v.inUse && (
                  <Popconfirm
                    title="Xóa mức giá này?"
                    description="Mức giá liền trước (nếu có) sẽ được áp dụng tiếp."
                    onConfirm={() => remove(v._id).catch(() => {})}
                  >
                    <Button size="small" danger>
                      Xóa
                    </Button>
                  </Popconfirm>
                )}
              </Flex>
            ),
          },
        ]
      : []),
  ];

  const columns = [
    {
      title: 'Loại phí',
      dataIndex: 'name',
      render: (name, g) => (
        <Flex vertical>
          <b>{name}</b>
          <Typography.Text type="secondary" code>
            {g.code}
          </Typography.Text>
        </Flex>
      ),
    },
    { title: 'Nhóm', dataIndex: 'feeCategory', width: 130, render: (v) => <EnumTag map={FEE_CATEGORIES} value={v} /> },
    {
      title: 'Cách tính',
      dataIndex: 'calcMethod',
      width: 170,
      render: (v, g) => (
        <Flex gap={4} wrap>
          <EnumTag map={FEE_CALC_METHODS} value={v} />
          {g.vehicleType && <EnumTag map={VEHICLE_TYPES} value={g.vehicleType} />}
        </Flex>
      ),
    },
    {
      title: 'Giá hiện hành',
      width: 180,
      render: (_, g) =>
        g.current ? <b>{priceWithUnit(g.current.unitPrice, g.calcMethod)}</b> : <Tag>Không áp dụng</Tag>,
    },
    {
      title: 'Thay đổi sắp tới',
      width: 220,
      render: (_, g) => {
        if (g.upcoming) return `${priceWithUnit(g.upcoming.unitPrice, g.calcMethod)} từ ${periodLabel(g.upcoming.fromPeriod)}`;
        if (g.current?.endPeriod) return `Ngừng thu sau ${periodLabel(g.current.endPeriod)}`;
        return <Typography.Text type="secondary">—</Typography.Text>;
      },
    },
    ...(canEdit
      ? [
          {
            title: '',
            width: 190,
            render: (_, g) => (
              <Flex gap={4}>
                <Button size="small" type="primary" ghost onClick={() => setModal({ type: 'price', target: g })}>
                  Đổi giá
                </Button>
                {g.open && (
                  <Button size="small" onClick={() => setModal({ type: 'end', target: g.open })}>
                    Ngừng thu
                  </Button>
                )}
              </Flex>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Bảng phí & đơn giá"
        subtitle="Phí vệ sinh và phí gửi xe hằng tháng. Đổi giá tạo mức giá mới từ một kỳ; hóa đơn đã lập giữ nguyên giá lúc lập. Phí tiện ích cấu hình ở trang Tiện ích."
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Bảng phí' }]}
        extra={
          canEdit && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModal({ type: 'new' })}>
              Thêm loại phí
            </Button>
          )
        }
      />
      <Card>
        <Table
          rowKey="code"
          loading={list.loading}
          dataSource={groups}
          columns={columns}
          pagination={false}
          scroll={{ x: 900 }}
          expandable={{
            expandedRowRender: (g) => (
              <Table rowKey="_id" size="small" dataSource={g.versions} columns={versionColumns} pagination={false} />
            ),
          }}
        />
      </Card>

      {modal?.type === 'new' && <NewFeeTypeModal onClose={close} onDone={list.reload} />}
      {modal?.type === 'price' && <ChangePriceModal group={modal.target} onClose={close} onDone={list.reload} />}
      {modal?.type === 'edit' && <EditVersionModal version={modal.target} onClose={close} onDone={list.reload} />}
      {modal?.type === 'end' && <EndModal version={modal.target} onClose={close} onDone={list.reload} />}
    </>
  );
}

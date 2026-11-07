import { useState } from 'react';
import {
  App,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import { PHONE_RULES } from '../../utils/phone';
import {
  EditOutlined,
  LockOutlined,
  PlusOutlined,
  SearchOutlined,
  UnlockOutlined,
} from '@ant-design/icons';
import { usersApi } from '../../api/moduleA.api';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import {
  BOARD_TITLES,
  ROLES,
  ROLE_TITLES,
  enumOptions,
  roleLabelOf,
} from '../../constants/enums';
import PageHeader from '../../components/PageHeader';
import { formatDateTime } from '../../utils/format';

// Vai trò nội bộ (lọc, hiển thị). Trưởng BQL không tạo trên giao diện (UC03 bước 2), thay bằng npm run db:set-manager
const INTERNAL_ROLES = {
  MANAGER: ROLES.MANAGER,
  ACCOUNTANT: ROLES.ACCOUNTANT,
  STAFF: ROLES.STAFF,
  BOARD: ROLES.BOARD,
};
const { MANAGER: _manager, ...CREATABLE_ROLES } = INTERNAL_ROLES;

// UC03: Chờ kích hoạt / Hoạt động / Đã khóa
const ACCOUNT_STATUS = {
  PENDING: { label: 'Chờ kích hoạt', color: 'warning' },
  ACTIVE: { label: 'Hoạt động', color: 'success' },
  LOCKED: { label: 'Đã khóa', color: 'error' },
};

// Modal tạo mới tài khoản nội bộ (Trưởng BQL). Không tạo mật khẩu: nhân viên tự kích hoạt (UC11) hoặc nhận mã tại quầy (UC02)
function CreateAccountModal({ open, onClose, onDone }) {
  const [form] = Form.useForm();
  const selectedRole = Form.useWatch('role', form);

  const [createAccount, saving] = useAction((values) => usersApi.createInternal(values), {
    success: (res) =>
      res.data?.inviteSent
        ? 'Đã tạo tài khoản nhân viên. Email mời kích hoạt đã được gửi.'
        : 'Đã tạo tài khoản nhân viên. Chưa gửi được email mời: cấp mã tại menu Cấp mã kích hoạt.',
    onDone: () => {
      form.resetFields();
      onClose();
      onDone();
    },
  });

  return (
    <Modal
      title="Thêm tài khoản nội bộ"
      open={open}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      onOk={() => form.submit()}
      confirmLoading={saving}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" preserve={false} onFinish={(v) => createAccount(v).catch(() => {})}>
        <Form.Item name="fullName" label="Họ và tên" rules={[{ required: true, message: 'Vui lòng nhập họ và tên' }]}>
          <Input placeholder="vd: Nguyễn Văn Quản" />
        </Form.Item>

        <Form.Item name="phone" label="Số điện thoại (dùng để đăng nhập)" rules={PHONE_RULES}>
          <Input placeholder="vd: 0901234567" />
        </Form.Item>

        <Form.Item
          name="email"
          label="Email (không bắt buộc)"
          extra="Có email thì nhân viên nhận thư mời kích hoạt. Không có email thì cấp mã tại menu Cấp mã kích hoạt."
          rules={[{ type: 'email', message: 'Email không đúng định dạng' }]}
        >
          <Input placeholder="vd: ketoan@sapms.vn" />
        </Form.Item>

        <Form.Item name="role" label="Vai trò hệ thống" rules={[{ required: true, message: 'Vui lòng chọn vai trò' }]}>
          <Select options={enumOptions(CREATABLE_ROLES)} placeholder="Chọn vai trò" />
        </Form.Item>

        {selectedRole === 'STAFF' && (
          <Form.Item name="roleTitle" label="Chức danh nhân viên" rules={[{ required: true, message: 'Vui lòng chọn chức danh' }]}>
            <Select options={enumOptions(ROLE_TITLES)} placeholder="Chọn chức danh" />
          </Form.Item>
        )}

        {selectedRole === 'BOARD' && (
          <Form.Item name="boardTitle" label="Chức danh Ban quản trị" rules={[{ required: true, message: 'Vui lòng chọn chức danh' }]}>
            <Select options={enumOptions(BOARD_TITLES)} placeholder="Chọn chức danh" />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

// Modal sửa tài khoản nội bộ (Trưởng BQL)
function EditAccountModal({ user, open, onClose, onDone }) {
  const [form] = Form.useForm();
  const selectedRole = Form.useWatch('role', form);

  const [updateAccount, saving] = useAction(
    (values) => usersApi.updateInternal(user._id, values),
    {
      success: 'Cập nhật tài khoản thành công',
      onDone: () => {
        onClose();
        onDone();
      },
    },
  );

  return (
    <Modal
      title="Chỉnh sửa tài khoản nội bộ"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={saving}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{
          fullName: user?.fullName,
          email: user?.email,
          phone: user?.phone,
          role: user?.role,
          roleTitle: user?.roleTitle,
          boardTitle: user?.boardTitle,
        }}
        // Tài khoản Trưởng BQL: không gửi vai trò, vì không tự đổi vai trò của mình được
        onFinish={({ role, roleTitle, boardTitle, ...v }) =>
          updateAccount(user?.role === 'MANAGER' ? v : { ...v, role, roleTitle, boardTitle }).catch(() => {})
        }
      >
        <Form.Item
          name="email"
          label="Email (không bắt buộc)"
          rules={[{ type: 'email', message: 'Email không đúng định dạng' }]}
        >
          <Input />
        </Form.Item>

        <Form.Item
          name="fullName"
          label="Họ và tên"
          rules={[{ required: true, message: 'Vui lòng nhập họ và tên' }]}
        >
          <Input />
        </Form.Item>

        <Form.Item
          name="phone"
          label="Số điện thoại"
          rules={PHONE_RULES}
        >
          <Input />
        </Form.Item>

        <Form.Item
          name="role"
          label="Vai trò hệ thống"
          rules={[{ required: true, message: 'Vui lòng chọn vai trò' }]}
        >
          <Select
            options={enumOptions(user?.role === 'MANAGER' ? INTERNAL_ROLES : CREATABLE_ROLES)}
            disabled={user?.role === 'MANAGER'}
          />
        </Form.Item>

        {selectedRole === 'STAFF' && (
          <Form.Item
            name="roleTitle"
            label="Chức danh nhân viên"
            rules={[{ required: true, message: 'Vui lòng chọn chức danh' }]}
          >
            <Select options={enumOptions(ROLE_TITLES)} />
          </Form.Item>
        )}

        {selectedRole === 'BOARD' && (
          <Form.Item
            name="boardTitle"
            label="Chức danh Ban quản trị"
            rules={[{ required: true, message: 'Vui lòng chọn chức danh' }]}
          >
            <Select options={enumOptions(BOARD_TITLES)} />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

// UC-A04: Quản lý danh sách tài khoản nội bộ (/app/internal-accounts, Trưởng BQL)
export default function InternalAccountsPage() {
  const { user: currentUser } = useAuth();
  const { message } = App.useApp();

  const [filters, setFilters] = useState({ page: 1, limit: 15 });
  const [openCreate, setOpenCreate] = useState(false);
  const [editingUser, setEditingUser] = useState(null);

  const { data = [], pagination, loading, reload } = useApi(
    () => usersApi.listInternal(filters),
    [filters],
  );

  const handleFilterChange = (patch) => {
    setFilters((prev) => ({ ...prev, page: 1, ...patch }));
  };

  const handleToggleStatus = async (targetUser, isActive = !targetUser.isActive) => {
    try {
      await usersApi.setStatus(targetUser._id, isActive);
      message.success(
        isActive ? `Đã mở khóa tài khoản ${targetUser.fullName}` : `Đã khóa tài khoản ${targetUser.fullName}`,
      );
      reload();
    } catch (err) {
      message.error(err.message || 'Thao tác thất bại');
    }
  };

  const columns = [
    {
      title: 'Họ và tên',
      dataIndex: 'fullName',
      key: 'fullName',
      render: (text, record) => (
        <div>
          <span className="font-semibold text-ink dark:text-[#EEF1F6]">{text}</span>
          {record._id === currentUser?.id && (
            <Tag color="cyan" className="ml-2 text-[10px]">
              Tài khoản của bạn
            </Tag>
          )}
        </div>
      ),
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      render: (email) => email || <span className="text-ink-3 italic">Chưa có</span>,
    },
    {
      title: 'Số điện thoại',
      dataIndex: 'phone',
      key: 'phone',
      render: (phone) => phone || <span className="text-ink-3 italic">Chưa có</span>,
    },
    {
      title: 'Vai trò / Chức danh',
      key: 'role',
      render: (_, record) => {
        const info = roleLabelOf(record);
        return info ? <Tag color={info.color}>{info.label}</Tag> : record.role;
      },
    },
    {
      title: 'Trạng thái',
      key: 'accountStatus',
      render: (_, record) => {
        const status = ACCOUNT_STATUS[record.accountStatus] ?? ACCOUNT_STATUS.ACTIVE;
        return (
          <Space size={4} wrap>
            <Tag color={status.color}>{status.label}</Tag>
            {record.tempLockedUntil && (
              <Tooltip title={`Nhập sai mật khẩu 5 lần, tự mở lúc ${formatDateTime(record.tempLockedUntil)}`}>
                <Tag color="orange">Khóa tạm</Tag>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Hành động',
      key: 'action',
      width: 140,
      render: (_, record) => {
        const isSelf = record._id === currentUser?.id;

        return (
          <Space orientation="horizontal" size="small">
            <Tooltip title="Chỉnh sửa">
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={() => setEditingUser(record)}
              />
            </Tooltip>

            {record.tempLockedUntil && (
              <Popconfirm
                title="Gỡ khóa tạm"
                description={`Cho "${record.fullName}" đăng nhập lại ngay, không chờ hết 15 phút?`}
                onConfirm={() => handleToggleStatus(record, true)}
                okText="Gỡ khóa"
                cancelText="Hủy"
              >
                <Tooltip title="Gỡ khóa tạm do nhập sai mật khẩu">
                  <Button type="text" size="small" className="text-amber-600" icon={<UnlockOutlined />} />
                </Tooltip>
              </Popconfirm>
            )}

            {record.isActive ? (
              <Popconfirm
                title="Khóa tài khoản"
                description={`Bạn có chắc muốn khóa tài khoản "${record.fullName}"? Người dùng sẽ không thể đăng nhập.`}
                onConfirm={() => handleToggleStatus(record)}
                okText="Khóa"
                cancelText="Hủy"
                okButtonProps={{ danger: true }}
                disabled={isSelf}
              >
                <Tooltip title={isSelf ? 'Không thể tự khóa tài khoản của bạn' : 'Khóa tài khoản'}>
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<LockOutlined />}
                    disabled={isSelf}
                  />
                </Tooltip>
              </Popconfirm>
            ) : (
              <Popconfirm
                title="Mở khóa tài khoản"
                description={`Mở khóa cho tài khoản "${record.fullName}"?`}
                onConfirm={() => handleToggleStatus(record)}
                okText="Mở khóa"
                cancelText="Hủy"
              >
                <Tooltip title="Mở khóa">
                  <Button
                    type="text"
                    size="small"
                    className="text-emerald-600 hover:text-emerald-700"
                    icon={<UnlockOutlined />}
                  />
                </Tooltip>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Tài khoản nội bộ"
        subtitle="Quản trị tài khoản cho Trưởng Ban quản lý, Kế toán, Nhân viên và Ban quản trị"
        breadcrumb={[
          { label: 'Trang chủ', path: '/app/home' },
          { label: 'Cấu hình' },
          { label: 'Tài khoản nội bộ' },
        ]}
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setOpenCreate(true)}
          >
            Thêm tài khoản
          </Button>
        }
      />

      <Card className="shadow-xs border-line">
        {/* Filters */}
        <Flex gap={12} wrap className="mb-4" justify="space-between" align="center">
          <Flex gap={12} wrap align="center">
            <Input
              placeholder="Tìm theo tên, email, SĐT..."
              prefix={<SearchOutlined className="text-ink-3" />}
              allowClear
              style={{ width: 260 }}
              onPressEnter={(e) => handleFilterChange({ q: e.target.value })}
              onChange={(e) => !e.target.value && handleFilterChange({ q: '' })}
            />

            <Select
              placeholder="Lọc theo vai trò"
              allowClear
              style={{ width: 180 }}
              options={enumOptions(INTERNAL_ROLES)}
              onChange={(role) => handleFilterChange({ role })}
            />

            <Select
              placeholder="Trạng thái"
              allowClear
              style={{ width: 160 }}
              options={Object.entries(ACCOUNT_STATUS).map(([value, { label }]) => ({ value, label }))}
              onChange={(status) => handleFilterChange({ status })}
            />
          </Flex>
        </Flex>

        <Table
          rowKey="_id"
          columns={columns}
          dataSource={data}
          loading={loading}
          pagination={{
            current: filters.page,
            pageSize: filters.limit,
            total: pagination?.total,
            onChange: (page, limit) => setFilters((f) => ({ ...f, page, limit })),
            showSizeChanger: true,
          }}
        />
      </Card>

      <CreateAccountModal
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        onDone={reload}
      />

      {editingUser && (
        <EditAccountModal
          user={editingUser}
          open={Boolean(editingUser)}
          onClose={() => setEditingUser(null)}
          onDone={reload}
        />
      )}
    </div>
  );
}

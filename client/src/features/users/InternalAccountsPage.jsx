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
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  CopyOutlined,
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

const { Paragraph, Text } = Typography;

// Vai trò nội bộ có thể tạo/sửa
const INTERNAL_ROLES = {
  MANAGER: ROLES.MANAGER,
  ACCOUNTANT: ROLES.ACCOUNTANT,
  STAFF: ROLES.STAFF,
  BOARD: ROLES.BOARD,
};

// Modal tạo mới tài khoản nội bộ (Admin)
function CreateAccountModal({ open, onClose, onDone }) {
  const [form] = Form.useForm();
  const selectedRole = Form.useWatch('role', form);
  const [createdResult, setCreatedResult] = useState(null);

  const [createAccount, saving] = useAction(
    (values) => usersApi.createInternal(values),
    {
      onDone: (res) => {
        if (res.data?.temporaryPassword) {
          // Lưu kết quả để hiển thị mật khẩu tạm
          setCreatedResult(res.data);
        } else {
          onClose();
          onDone();
        }
      },
    },
  );

  const handleClose = () => {
    form.resetFields();
    if (createdResult) {
      setCreatedResult(null);
      onDone();
    }
    onClose();
  };

  return (
    <>
      <Modal
        title="Thêm tài khoản nội bộ"
        open={open && !createdResult}
        onCancel={handleClose}
        onOk={() => form.submit()}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          preserve={false}
          onFinish={(v) => createAccount(v).catch(() => {})}
        >
          <Form.Item
            name="fullName"
            label="Họ và tên"
            rules={[{ required: true, message: 'Vui lòng nhập họ và tên' }]}
          >
            <Input placeholder="vd: Nguyễn Văn Quản" />
          </Form.Item>

          <Form.Item
            name="email"
            label="Email"
            rules={[
              { required: true, message: 'Vui lòng nhập email' },
              { type: 'email', message: 'Email không đúng định dạng' },
            ]}
          >
            <Input placeholder="vd: manager@sapms.vn" />
          </Form.Item>

          <Form.Item
            name="phone"
            label="Số điện thoại"
            rules={[{ pattern: /^(0|\+84)\d{9,10}$/, message: 'Số điện thoại không hợp lệ' }]}
          >
            <Input placeholder="vd: 0901234567" />
          </Form.Item>

          <Form.Item
            name="role"
            label="Vai trò hệ thống"
            rules={[{ required: true, message: 'Vui lòng chọn vai trò' }]}
          >
            <Select options={enumOptions(INTERNAL_ROLES)} placeholder="Chọn vai trò" />
          </Form.Item>

          {selectedRole === 'STAFF' && (
            <Form.Item
              name="roleTitle"
              label="Chức danh nhân viên"
              rules={[{ required: true, message: 'Vui lòng chọn chức danh' }]}
            >
              <Select options={enumOptions(ROLE_TITLES)} placeholder="Chọn chức danh" />
            </Form.Item>
          )}

          {selectedRole === 'BOARD' && (
            <Form.Item
              name="boardTitle"
              label="Chức danh Ban quản trị"
              rules={[{ required: true, message: 'Vui lòng chọn chức danh' }]}
            >
              <Select options={enumOptions(BOARD_TITLES)} placeholder="Chọn chức danh" />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* Modal hiển thị mật khẩu tạm khi chưa gửi được email */}
      <Modal
        title="Thông tin tài khoản vừa tạo"
        open={Boolean(createdResult)}
        onOk={handleClose}
        onCancel={handleClose}
        cancelButtonProps={{ style: { display: 'none' } }}
        okText="Đã lưu mật khẩu"
      >
        <div className="py-2">
          <p className="text-sm text-ink mb-3">
            Tài khoản cho nhân sự <Text strong>{createdResult?.user?.fullName}</Text> ({createdResult?.user?.email}) đã được tạo thành công!
          </p>

          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-4">
            <Text type="warning" className="block text-xs font-semibold uppercase tracking-wider mb-1">
              Mật khẩu tạm thời (Chỉ hiển thị một lần duy nhất)
            </Text>
            <Paragraph
              copyable={{
                text: createdResult?.temporaryPassword,
                icon: [<CopyOutlined key="copy" />, <CheckCircleOutlined key="copied" />],
              }}
              className="text-lg font-mono font-bold text-navy dark:text-gold m-0 select-all"
            >
              {createdResult?.temporaryPassword}
            </Paragraph>
          </div>

          <p className="text-xs text-ink-3 m-0">
            Hệ thống chưa gửi được email tự động đến người dùng. Vui lòng sao chép mật khẩu trên và gửi trực tiếp cho nhân sự này.
          </p>
        </div>
      </Modal>
    </>
  );
}

// Modal sửa tài khoản nội bộ (Admin)
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
        onFinish={(v) => updateAccount(v).catch(() => {})}
      >
        <Form.Item name="email" label="Email (Không thể thay đổi)">
          <Input disabled />
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
          rules={[{ pattern: /^(0|\+84)\d{9,10}$/, message: 'Số điện thoại không hợp lệ' }]}
        >
          <Input />
        </Form.Item>

        <Form.Item
          name="role"
          label="Vai trò hệ thống"
          rules={[{ required: true, message: 'Vui lòng chọn vai trò' }]}
        >
          <Select options={enumOptions(INTERNAL_ROLES)} />
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

// UC-A04: Quản lý danh sách tài khoản nội bộ (/app/internal-accounts, ADMIN)
export default function InternalAccountsPage() {
  const { user: currentAdmin } = useAuth();
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

  const handleToggleStatus = async (targetUser) => {
    try {
      await usersApi.setStatus(targetUser._id, !targetUser.isActive);
      message.success(
        targetUser.isActive
          ? `Đã khóa tài khoản ${targetUser.fullName}`
          : `Đã mở khóa tài khoản ${targetUser.fullName}`,
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
          {record._id === currentAdmin?.id && (
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
      dataIndex: 'isActive',
      key: 'isActive',
      render: (isActive) =>
        isActive ? (
          <Tag color="success">Hoạt động</Tag>
        ) : (
          <Tag color="error">Đã khóa</Tag>
        ),
    },
    {
      title: 'Hành động',
      key: 'action',
      width: 140,
      render: (_, record) => {
        const isSelf = record._id === currentAdmin?.id;

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
              options={[
                { value: true, label: 'Đang hoạt động' },
                { value: false, label: 'Đã khóa' },
              ]}
              onChange={(isActive) => handleFilterChange({ isActive })}
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

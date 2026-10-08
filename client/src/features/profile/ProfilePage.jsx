import { useState, useEffect } from 'react';
import { App, Avatar, Button, Card, DatePicker, Form, Input, Tabs, Upload, Tag } from 'antd';
import {
  CameraOutlined,
  KeyOutlined,
  LockOutlined,
  MailOutlined,
  PhoneOutlined,
  SaveOutlined,
  UserOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { usersApi } from '../../api/moduleA.api';
import { useAuth } from '../../hooks/useAuth';
import { roleLabelOf } from '../../constants/enums';
import PageHeader from '../../components/PageHeader';

// UC-A03: Trang hồ sơ cá nhân và đổi mật khẩu (/app/profile và /r/profile)
export default function ProfilePage() {
  const { user, updateUser, startSession } = useAuth();
  const { message } = App.useApp();

  const [profileForm] = Form.useForm();
  const [passwordForm] = Form.useForm();

  const [savingProfile, setSavingProfile] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => {
    if (user) {
      profileForm.setFieldsValue({
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        dateOfBirth: user.dateOfBirth ? dayjs(user.dateOfBirth) : null,
      });
    }
  }, [user, profileForm]);

  const onSaveProfile = async (values) => {
    setSavingProfile(true);
    try {
      const payload = {
        fullName: values.fullName?.trim(),
        phone: values.phone?.trim() || null,
        dateOfBirth: values.dateOfBirth ? values.dateOfBirth.format('YYYY-MM-DD') : null,
      };
      const res = await usersApi.updateMe(payload);
      updateUser(res.data);
      message.success('Cập nhật hồ sơ thành công');
    } catch (err) {
      message.error(err.message || 'Cập nhật thất bại');
    } finally {
      setSavingProfile(false);
    }
  };

  const onChangePassword = async (values) => {
    setChangingPassword(true);
    try {
      const res = await usersApi.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        confirmPassword: values.confirmPassword,
      });
      startSession(res.data);
      passwordForm.resetFields();
      message.success('Đổi mật khẩu thành công! Phiên đăng nhập đã được duy trì an toàn.');
    } catch (err) {
      message.error(err.message || 'Đổi mật khẩu thất bại');
    } finally {
      setChangingPassword(false);
    }
  };

  const handleAvatarUpload = async ({ file }) => {
    setUploadingAvatar(true);
    try {
      const res = await usersApi.updateAvatar(file);
      updateUser(res.data);
      message.success('Cập nhật ảnh đại diện thành công');
    } catch (err) {
      message.error(err.message || 'Tải ảnh đại diện thất bại');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const roleInfo = roleLabelOf(user);

  const tabItems = [
    {
      key: 'info',
      label: (
        <span>
          <UserOutlined /> Thông tin cá nhân
        </span>
      ),
      children: (
        <div className="max-w-xl py-2">
          {/* Avatar Section */}
          <div className="flex items-center gap-5 mb-8 p-4 bg-paper dark:bg-[#1E293B] rounded-xl border border-line">
            <div className="relative group">
              <Avatar
                size={84}
                src={user?.avatarUrl}
                icon={<UserOutlined />}
                className="border-2 border-gold/40 shadow-sm"
              />
              <Upload
                showUploadList={false}
                beforeUpload={() => false}
                onChange={handleAvatarUpload}
                accept="image/png,image/jpeg"
              >
                <button
                  type="button"
                  disabled={uploadingAvatar}
                  className="absolute bottom-0 right-0 bg-navy hover:bg-gold text-white p-2 rounded-full cursor-pointer shadow transition-colors border-0"
                  title="Thay đổi ảnh đại diện"
                >
                  <CameraOutlined className="text-xs" />
                </button>
              </Upload>
            </div>
            <div>
              <h3 className="m-0 text-base font-semibold text-ink dark:text-[#EEF1F6]">
                {user?.fullName}
              </h3>
              <div className="mt-1 flex items-center gap-2">
                {roleInfo && (
                  <Tag color={roleInfo.color || 'blue'} className="m-0 font-medium">
                    {roleInfo.label}
                  </Tag>
                )}
                <span className="text-xs text-ink-3 dark:text-[#94A3B8]">{user?.email}</span>
              </div>
              <p className="mt-2 mb-0 text-xs text-ink-3">
                Định dạng JPG, PNG. Dung lượng tối đa 5MB.
              </p>
            </div>
          </div>

          <Form
            form={profileForm}
            layout="vertical"
            requiredMark={false}
            onFinish={onSaveProfile}
            disabled={savingProfile}
          >
            <Form.Item
              name="fullName"
              label="Họ và tên"
              rules={[
                { required: true, message: 'Vui lòng nhập họ và tên' },
                { min: 2, message: 'Họ và tên tối thiểu 2 ký tự' },
              ]}
            >
              <Input size="large" prefix={<UserOutlined className="text-ink-3" />} />
            </Form.Item>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Form.Item name="email" label="Email (Chỉ xem)">
                <Input size="large" disabled prefix={<MailOutlined className="text-ink-3" />} />
              </Form.Item>

              <Form.Item
                name="phone"
                label="Số điện thoại"
                rules={[
                  {
                    pattern: /^(0|\+84)\d{9,10}$/,
                    message: 'Số điện thoại không hợp lệ',
                  },
                ]}
              >
                <Input size="large" prefix={<PhoneOutlined className="text-ink-3" />} placeholder="Chưa cập nhật" />
              </Form.Item>
            </div>

            <Form.Item
              name="dateOfBirth"
              label="Ngày sinh"
              extra="Ngày sinh dùng để tính ưu đãi giá tiện ích theo độ tuổi."
            >
              <DatePicker
                format="DD/MM/YYYY"
                size="large"
                style={{ width: '100%' }}
                placeholder="Chọn ngày sinh"
                disabledDate={(d) => d && d.isAfter(dayjs(), 'day')}
              />
            </Form.Item>

            <Button
              type="primary"
              htmlType="submit"
              size="large"
              icon={<SaveOutlined />}
              loading={savingProfile}
              className="mt-2"
            >
              Lưu thay đổi
            </Button>
          </Form>
        </div>
      ),
    },
    {
      key: 'password',
      label: (
        <span>
          <KeyOutlined /> Đổi mật khẩu
        </span>
      ),
      children: (
        <div className="max-w-xl py-2">
          <p className="text-xs text-ink-2 mb-6">
            Mật khẩu mới phải có tối thiểu 8 ký tự, bao gồm cả chữ cái và số để đảm bảo tính an toàn.
          </p>

          <Form
            form={passwordForm}
            layout="vertical"
            requiredMark={false}
            onFinish={onChangePassword}
            disabled={changingPassword}
          >
            <Form.Item
              name="currentPassword"
              label="Mật khẩu hiện tại"
              rules={[{ required: true, message: 'Vui lòng nhập mật khẩu hiện tại' }]}
            >
              <Input.Password
                size="large"
                prefix={<LockOutlined className="text-ink-3" />}
                placeholder="Nhập mật khẩu đang dùng"
              />
            </Form.Item>

            <Form.Item
              name="newPassword"
              label="Mật khẩu mới"
              rules={[
                { required: true, message: 'Vui lòng nhập mật khẩu mới' },
                { min: 8, message: 'Mật khẩu tối thiểu 8 ký tự' },
                {
                  pattern: /^(?=.*[A-Za-z])(?=.*\d)/,
                  message: 'Mật khẩu phải chứa ít nhất 1 chữ cái và 1 chữ số',
                },
              ]}
            >
              <Input.Password
                size="large"
                prefix={<LockOutlined className="text-ink-3" />}
                placeholder="Tối thiểu 8 ký tự có chữ và số"
              />
            </Form.Item>

            <Form.Item
              name="confirmPassword"
              label="Xác nhận mật khẩu mới"
              dependencies={['newPassword']}
              rules={[
                { required: true, message: 'Vui lòng xác nhận mật khẩu mới' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('newPassword') === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error('Xác nhận mật khẩu không khớp'));
                  },
                }),
              ]}
            >
              <Input.Password
                size="large"
                prefix={<LockOutlined className="text-ink-3" />}
                placeholder="Nhập lại mật khẩu mới"
              />
            </Form.Item>

            <Button
              type="primary"
              htmlType="submit"
              size="large"
              icon={<SaveOutlined />}
              loading={changingPassword}
              className="mt-2"
            >
              Cập nhật mật khẩu
            </Button>
          </Form>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Hồ sơ cá nhân"
        subtitle="Quản lý thông tin tài khoản và bảo mật mật khẩu của bạn"
        breadcrumb={[
          { label: 'Trang chủ', path: user?.role === 'RESIDENT' ? '/r/home' : '/app/home' },
          { label: 'Hồ sơ cá nhân' },
        ]}
      />

      <Card className="shadow-xs border-line">
        <Tabs items={tabItems} defaultActiveKey="info" />
      </Card>
    </div>
  );
}

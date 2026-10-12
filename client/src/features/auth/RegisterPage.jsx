import { useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { Alert, Button, Form, Input } from 'antd';
import { ArrowRightOutlined, LockOutlined, MailOutlined, PhoneOutlined, UserOutlined } from '@ant-design/icons';
import { authApi } from '../../api/auth.api';

// Trang đăng ký tài khoản cư dân (Module A — Vũ Việt, UC-A01)
export default function RegisterPage() {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [generalError, setGeneralError] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (values) => {
    setGeneralError(null);
    setLoading(true);

    try {
      await authApi.register({
        fullName: values.fullName?.trim(),
        email: values.email?.trim(),
        phone: values.phone?.trim() || undefined,
        password: values.password,
        confirmPassword: values.confirmPassword,
      });

      navigate('/login', { state: { registered: true } });
    } catch (err) {
      if (err.details && Array.isArray(err.details) && err.details.length > 0) {
        // Ánh xạ lỗi chi tiết từng trường vào ô nhập liệu của Ant Design Form
        const fieldErrors = err.details.map((d) => ({
          name: d.field,
          errors: [d.message],
        }));
        form.setFields(fieldErrors);
      } else {
        setGeneralError(err.message || 'Đăng ký không thành công. Vui lòng thử lại.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <h2 className="m-0 text-2xl font-semibold tracking-tight text-ink">Đăng ký tài khoản</h2>
      <div className="w-8 h-0.5 bg-gold mt-2 mb-2" />
      <p className="m-0 mb-6 text-[13px] text-ink-2">Dành cho cư dân đăng ký tài khoản tự phục vụ.</p>

      {generalError && (
        <Alert
          type="error"
          showIcon
          message={generalError}
          className="mb-4"
          closable
          onClose={() => setGeneralError(null)}
        />
      )}

      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={submit}
        disabled={loading}
      >
        <Form.Item
          name="fullName"
          label="Họ và tên"
          rules={[
            { required: true, message: 'Vui lòng nhập họ và tên' },
            { min: 2, message: 'Họ và tên tối thiểu 2 ký tự' },
          ]}
        >
          <Input
            size="large"
            prefix={<UserOutlined className="text-ink-3" />}
            placeholder="vd: Nguyễn Văn A"
            autoComplete="name"
          />
        </Form.Item>

        <Form.Item
          name="email"
          label="Email"
          rules={[
            { required: true, message: 'Vui lòng nhập email' },
            { type: 'email', message: 'Email không đúng định dạng' },
          ]}
        >
          <Input
            size="large"
            prefix={<MailOutlined className="text-ink-3" />}
            placeholder="vd: cudan@sapms.vn"
            autoComplete="email"
          />
        </Form.Item>

        <Form.Item
          name="phone"
          label="Số điện thoại"
          rules={[
            {
              pattern: /^(0|\+84)\d{9,10}$/,
              message: 'Số điện thoại không hợp lệ (10-11 số, bắt đầu bằng 0 hoặc +84)',
            },
          ]}
        >
          <Input
            size="large"
            prefix={<PhoneOutlined className="text-ink-3" />}
            placeholder="vd: 0901234567"
            autoComplete="tel"
          />
        </Form.Item>

        <Form.Item
          name="password"
          label="Mật khẩu"
          rules={[
            { required: true, message: 'Vui lòng nhập mật khẩu' },
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
            autoComplete="new-password"
          />
        </Form.Item>

        <Form.Item
          name="confirmPassword"
          label="Xác nhận mật khẩu"
          dependencies={['password']}
          rules={[
            { required: true, message: 'Vui lòng xác nhận mật khẩu' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) {
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
            placeholder="Nhập lại mật khẩu"
            autoComplete="new-password"
          />
        </Form.Item>

        <Button type="primary" htmlType="submit" size="large" block loading={loading} className="mt-2">
          Đăng ký <ArrowRightOutlined />
        </Button>
      </Form>

      <div className="mt-5 text-center text-[13px] text-ink-2">
        Đã có tài khoản?{' '}
        <Link to="/login" className="font-semibold text-navy hover:text-gold transition-colors">
          Đăng nhập
        </Link>
      </div>
    </>
  );
}

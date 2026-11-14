import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Alert, Button, Form, Input } from 'antd';
import { ArrowRightOutlined, LockOutlined, PhoneOutlined } from '@ant-design/icons';
import { authApi } from '../../api/auth.api';
import { PHONE_RULES } from '../../utils/phone';
import VerificationCodeField from './VerificationCodeField';

const RESEND_SECONDS = 60;
const icon = (Icon) => <Icon className="text-ink-3" />;

// UC02 bước 1–4: SĐT → OTP qua email → mật khẩu mới. Không có email thì ra quầy lấy mã in.
export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const desk = searchParams.get('method') === 'desk';
  const [phone, setPhone] = useState(null); // null = chưa gửi mã
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const run = async (action) => {
    setError(null);
    setLoading(true);
    try {
      return await action();
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const sendCode = async (value) => {
    if (await run(() => authApi.forgotPassword(value))) {
      setPhone(value);
      setResendIn(RESEND_SECONDS);
    }
  };

  const reset = async (values) => {
    if (await run(() => authApi.resetPassword({ ...values, phone: desk ? values.phone : phone }))) {
      navigate('/login', { replace: true, state: { passwordReset: true } });
    }
  };

  return (
    <>
      <h2 className="m-0 text-2xl font-semibold tracking-tight text-ink">Quên mật khẩu</h2>
      <div className="w-8 h-0.5 bg-gold mt-2 mb-2" />
      <p className="m-0 mb-6 text-[13px] text-ink-2">
        {desk
          ? 'Nhập số điện thoại và mã in tại quầy để đặt mật khẩu mới.'
          : phone
            ? 'Nhập mã đã gửi tới email và đặt mật khẩu mới.'
            : 'Nhập số điện thoại đăng nhập, mã đặt lại mật khẩu sẽ gửi tới email của tài khoản.'}
      </p>

      {error && <Alert type="error" showIcon title={error} className="mb-4" closable onClose={() => setError(null)} />}

      {!desk && !phone ? (
        <Form layout="vertical" requiredMark={false} disabled={loading} onFinish={({ phone: value }) => sendCode(value)}>
          <Form.Item name="phone" label="Số điện thoại" rules={PHONE_RULES}>
            <Input size="large" prefix={icon(PhoneOutlined)} placeholder="0912345678" autoComplete="tel" />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={loading}>
            Gửi mã <ArrowRightOutlined />
          </Button>
        </Form>
      ) : (
        <Form key={desk ? 'desk' : 'email'} layout="vertical" requiredMark={false} disabled={loading} initialValues={{ phone }} onFinish={reset}>
          {desk ? (
            <Form.Item name="phone" label="Số điện thoại" rules={PHONE_RULES}>
              <Input size="large" prefix={icon(PhoneOutlined)} placeholder="0912345678" autoComplete="tel" />
            </Form.Item>
          ) : (
            <Alert
              type="info"
              showIcon
              className="mb-4"
              title={`Nếu số ${phone} có tài khoản và email, mã đã được gửi tới email, có hiệu lực 10 phút.`}
              description="Không nhận được email hoặc tài khoản không có email: mang CCCD đến quầy lễ tân để lấy mã in."
            />
          )}
          <VerificationCodeField desk={desk} />
          <Form.Item
            name="password"
            label="Mật khẩu mới"
            rules={[
              { required: true, message: 'Vui lòng nhập mật khẩu mới' },
              { pattern: /^(?=.*[A-Za-z])(?=.*\d).{8,100}$/, message: 'Mật khẩu có ít nhất 8 ký tự, gồm cả chữ và số' },
            ]}
          >
            <Input.Password size="large" prefix={icon(LockOutlined)} autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="Nhập lại mật khẩu mới"
            dependencies={['password']}
            rules={[
              { required: true, message: 'Vui lòng nhập lại mật khẩu' },
              ({ getFieldValue }) => ({
                validator: (_, value) =>
                  !value || value === getFieldValue('password')
                    ? Promise.resolve()
                    : Promise.reject(new Error('Hai mật khẩu chưa khớp')),
              }),
            ]}
          >
            <Input.Password size="large" prefix={icon(LockOutlined)} autoComplete="new-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={loading}>
            Đặt lại mật khẩu <ArrowRightOutlined />
          </Button>
          {!desk && (
            <>
              <Button type="link" block className="mt-2" disabled={resendIn > 0 || loading} onClick={() => sendCode(phone)}>
                {resendIn > 0 ? `Gửi lại mã sau ${resendIn} giây` : 'Gửi lại mã'}
              </Button>
              <Button type="link" block onClick={() => setPhone(null)}>
                Đổi số điện thoại
              </Button>
            </>
          )}
        </Form>
      )}

      <div className="mt-4 text-center text-[13px] text-ink-2">
        <Link
          to={desk ? '/forgot-password' : '/forgot-password?method=desk'}
          onClick={() => setError(null)}
          className="font-semibold text-navy hover:text-gold transition-colors"
        >
          {desk ? 'Nhận mã qua email' : 'Tôi đã có mã in tại quầy'}
        </Link>
        {' · '}
        <Link to="/login" className="font-semibold text-navy hover:text-gold transition-colors">
          Đăng nhập
        </Link>
      </div>
    </>
  );
}

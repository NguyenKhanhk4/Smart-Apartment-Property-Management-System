import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Alert, Button, Form, Input } from 'antd';
import { ArrowRightOutlined, LockOutlined, PhoneOutlined, SafetyOutlined } from '@ant-design/icons';
import { authApi } from '../../api/auth.api';
import { ALERT_GAP } from './authStyles';
import { portalPath, useAuthPortal } from './authPortal';
import { PHONE_RULES } from '../../utils/phone';

const RESEND_SECONDS = 60;
const icon = (Icon) => <Icon className="text-ink-3" />;

// UC02 bước 1–4: SĐT → OTP qua email → mật khẩu mới. Không có email thì ra quầy lấy mã in.
export default function ForgotPasswordPage() {
  const portal = useAuthPortal(); // cổng cư dân / Ban quản lý: link quay lại đúng cổng
  const navigate = useNavigate();
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
    if (await run(() => authApi.resetPassword({ ...values, phone }))) {
      navigate(portalPath(portal, '/login'), { replace: true, state: { passwordReset: true, phone } });
    }
  };

  return (
    <>
      <h2 className="m-0 text-[22px] font-semibold tracking-tight text-ink">Quên mật khẩu</h2>
      <p className="mt-1 mb-6 text-[13px] text-ink-2">
        {phone ? 'Nhập mã đã gửi tới email và đặt mật khẩu mới.' : 'Nhập số điện thoại đăng nhập, mã đặt lại mật khẩu sẽ gửi tới email của tài khoản.'}
      </p>

      {error && <Alert type="error" showIcon title={error} style={ALERT_GAP} closable={{ onClose: () => setError(null) }} />}

      {!phone ? (
        <Form layout="vertical" requiredMark={false} disabled={loading} onFinish={({ phone: value }) => sendCode(value)}>
          <Form.Item name="phone" label="Số điện thoại" rules={PHONE_RULES}>
            <Input size="large" prefix={icon(PhoneOutlined)} placeholder="0912345678" autoComplete="tel" />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={loading}>
            Gửi mã <ArrowRightOutlined />
          </Button>
        </Form>
      ) : (
        <Form layout="vertical" requiredMark={false} disabled={loading} onFinish={reset}>
          <Alert
            type="info"
            showIcon
            style={ALERT_GAP}
            title={`Nếu số ${phone} có tài khoản và email, mã đã được gửi tới email, có hiệu lực 10 phút.`}
            description="Không nhận được email hoặc tài khoản không có email: mang CCCD đến quầy lễ tân để lấy mã in."
          />
          <Form.Item name="code" label="Mã xác minh" rules={[{ required: true, message: 'Vui lòng nhập mã xác minh' }]}>
            <Input size="large" prefix={icon(SafetyOutlined)} placeholder="6 số trong email" autoComplete="one-time-code" />
          </Form.Item>
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
          <Button type="link" block className="mt-2" disabled={resendIn > 0 || loading} onClick={() => sendCode(phone)}>
            {resendIn > 0 ? `Gửi lại mã sau ${resendIn} giây` : 'Gửi lại mã'}
          </Button>
          <Button type="link" block onClick={() => setPhone(null)}>
            Đổi số điện thoại
          </Button>
        </Form>
      )}

      <div className="mt-4 text-center text-[13px] text-ink-2">
        Có mã in tại quầy?{' '}
        <Link to={portalPath(portal, '/activate')} className="font-medium text-navy hover:text-navy-hover">
          Nhập mã tại đây
        </Link>
        {' · '}
        <Link to={portalPath(portal, '/login')} className="font-medium text-navy hover:text-navy-hover">
          Đăng nhập
        </Link>
      </div>
    </>
  );
}

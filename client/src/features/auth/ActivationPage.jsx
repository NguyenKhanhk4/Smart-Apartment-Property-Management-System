import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Alert, Button, Form, Input, Steps } from 'antd';
import { ArrowRightOutlined, HomeOutlined, LockOutlined, MailOutlined, PhoneOutlined, SafetyOutlined } from '@ant-design/icons';
import { authApi } from '../../api/auth.api';
import { ALERT_GAP } from './authStyles';
import { portalPath, useAuthPortal } from './authPortal';
import { PHONE_RULES } from '../../utils/phone';
import PersonalDataTerms from './PersonalDataTerms';

const RESEND_SECONDS = 60;
const icon = (Icon) => <Icon className="text-ink-3" />;

const PASSWORD_RULES = [
  { required: true, message: 'Vui lòng nhập mật khẩu' },
  {
    pattern: /^(?=.*[A-Za-z])(?=.*\d).{8,100}$/,
    message: 'Mật khẩu có ít nhất 8 ký tự, gồm cả chữ và số',
  },
];

// UC11: nhập thông tin → nhập mã và đặt mật khẩu → đồng ý hoặc từ chối điều khoản. Mã in tại quầy vào thẳng bước 2.
export default function ActivationPage() {
  const portal = useAuthPortal(); // cổng cư dân / Ban quản lý: link quay lại đúng cổng
  const navigate = useNavigate();
  const prefillPhone = useLocation().state?.phone; // từ trang đăng nhập khi tài khoản chưa kích hoạt
  const [step, setStep] = useState(0);
  const [identity, setIdentity] = useState(null); // Thông tin bước 1; null = dùng mã in tại quầy
  const [deskPhone, setDeskPhone] = useState(null); // SĐT đã gõ ở bước 1 trước khi chuyển sang mã in tại quầy
  const [infoForm] = Form.useForm();
  const [credentials, setCredentials] = useState(null);
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

  const sendOtp = async (values) => {
    const res = await run(() => authApi.startActivation(values));
    if (!res) return;
    setIdentity(values);
    setResendIn(RESEND_SECONDS);
    setStep(1);
  };

  const finish = async (consent) => {
    const { phone, code, password, confirmPassword } = credentials;
    const res = await run(() => authApi.confirmActivation({ phone, code, password, confirmPassword, consent }));
    if (res) {
      // Mã đặt lại mật khẩu in tại quầy cũng nhập ở đây (UC02 bước 7)
      const mode = res.data?.mode;
      const done = mode === 'PASSWORD_RESET' ? { passwordReset: true } : { activated: true };
      navigate(portalPath(portal, '/login'), { replace: true, state: { ...done, phone } }); // trang đăng nhập điền sẵn SĐT
    } else {
      // Mã sai hoặc hết hạn thì phải quay lại nhập mã
      setStep(1);
    }
  };

  return (
    <>
      <h2 className="m-0 text-lg font-semibold tracking-tight text-ink">Kích hoạt tài khoản</h2>
      <p className="mt-1 mb-5 text-[13px] text-ink-2">
        {step === 0 && 'Nhập số điện thoại, mã căn hộ và email đã đăng ký với Ban quản lý.'}
        {step === 1 && (identity ? 'Nhập mã đã gửi tới email và tự đặt mật khẩu.' : 'Nhập mã in tại quầy lễ tân và tự đặt mật khẩu.')}
        {step === 2 && 'Đọc điều khoản dữ liệu cá nhân rồi chọn đồng ý hoặc không đồng ý.'}
      </p>

      <div className="mb-6">
        <Steps
          size="small"
          current={step}
          titlePlacement="vertical"
          responsive={false}
          items={[{ title: 'Thông tin' }, { title: 'Xác minh' }, { title: 'Điều khoản' }]}
        />
      </div>

      {error && <Alert type="error" showIcon title={error} style={ALERT_GAP} closable={{ onClose: () => setError(null) }} />}

      {step === 0 && (
        <Form form={infoForm} layout="vertical" requiredMark={false} onFinish={sendOtp} disabled={loading} initialValues={identity ?? { phone: deskPhone ?? prefillPhone }}>
          <Form.Item name="phone" label="Số điện thoại" rules={PHONE_RULES}>
            <Input size="large" prefix={icon(PhoneOutlined)} placeholder="0912345678" autoComplete="tel" />
          </Form.Item>
          <Form.Item name="apartmentCode" label="Mã căn hộ" extra="Cư dân bắt buộc nhập. Nhân viên để trống.">
            <Input size="large" prefix={icon(HomeOutlined)} placeholder="Vd: A-1001" />
          </Form.Item>
          <Form.Item
            name="email"
            label="Email đã đăng ký"
            rules={[
              { required: true, message: 'Vui lòng nhập email' },
              { type: 'email', message: 'Email không hợp lệ' },
            ]}
          >
            <Input size="large" prefix={icon(MailOutlined)} placeholder="ban@gmail.com" autoComplete="email" />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={loading}>
            Gửi mã xác minh <ArrowRightOutlined />
          </Button>
          <Button
            type="link"
            block
            className="mt-2"
            onClick={() => {
              setError(null);
              setIdentity(null);
              setDeskPhone(infoForm.getFieldValue('phone')?.trim() || null); // không bắt gõ lại SĐT
              setStep(1);
            }}
          >
            Tôi đã có mã in tại quầy
          </Button>
        </Form>
      )}

      {step === 1 && (
        <Form
          layout="vertical"
          requiredMark={false}
          initialValues={{ phone: identity?.phone ?? deskPhone, ...credentials }}
          onFinish={(values) => {
            setError(null);
            setCredentials(values);
            setStep(2);
          }}
        >
          {identity && (
            <Alert type="info" showIcon style={ALERT_GAP} title="Mã xác minh đã được gửi tới email của bạn, có hiệu lực 10 phút." />
          )}
          <Form.Item name="phone" label="Số điện thoại" rules={PHONE_RULES}>
            <Input size="large" prefix={icon(PhoneOutlined)} disabled={Boolean(identity)} />
          </Form.Item>
          <Form.Item name="code" label="Mã xác minh" rules={[{ required: true, message: 'Vui lòng nhập mã xác minh' }]}>
            <Input size="large" prefix={icon(SafetyOutlined)} placeholder="6 số trong email hoặc mã in tại quầy" autoComplete="one-time-code" />
          </Form.Item>
          <Form.Item name="password" label="Mật khẩu" rules={PASSWORD_RULES}>
            <Input.Password size="large" prefix={icon(LockOutlined)} autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="Nhập lại mật khẩu"
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
          <Button type="primary" htmlType="submit" size="large" block>
            Tiếp tục <ArrowRightOutlined />
          </Button>
          {identity && (
            <Button
              type="link"
              block
              className="mt-2"
              disabled={resendIn > 0 || loading}
              onClick={() => sendOtp(identity)}
            >
              {resendIn > 0 ? `Gửi lại mã sau ${resendIn} giây` : 'Gửi lại mã'}
            </Button>
          )}
          <Button
            type="link"
            block
            onClick={() => {
              setError(null);
              setStep(0);
            }}
          >
            Quay lại
          </Button>
        </Form>
      )}

      {step === 2 && (
        <>
          <PersonalDataTerms />
          <Button type="primary" size="large" block className="mt-4" loading={loading} onClick={() => finish('ACCEPTED')}>
            Đồng ý và kích hoạt
          </Button>
          {/* Chữ dài: cho xuống dòng và có khoảng đệm, không để chạm mép nút trên màn hẹp */}
          <Button
            size="large"
            block
            className="mt-2"
            disabled={loading}
            onClick={() => finish('DECLINED')}
            style={{ height: 'auto', minHeight: 40, whiteSpace: 'normal', paddingInline: 16, paddingBlock: 8, lineHeight: 1.4 }}
          >
            Không đồng ý, kích hoạt với chức năng giới hạn
          </Button>
          <Button type="link" block className="mt-2" disabled={loading} onClick={() => setStep(1)}>
            Quay lại
          </Button>
        </>
      )}

      <div className="mt-4 text-center text-[13px] text-ink-2">
        Đã kích hoạt?{' '}
        <Link to={portalPath(portal, '/login')} className="font-medium text-navy hover:text-navy-hover">
          Đăng nhập
        </Link>
      </div>
    </>
  );
}

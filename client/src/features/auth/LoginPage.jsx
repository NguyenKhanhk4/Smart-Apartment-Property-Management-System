import { useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router';
import { Alert, Button, Form, Input } from 'antd';
import { ArrowRightOutlined, LockOutlined, PhoneOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { PHONE_RULES } from '../../utils/phone';
import { authApi } from '../../api/auth.api';
import { SESSION_EXPIRED_FLAG } from '../../utils/authStorage';
import { useAuth } from '../../hooks/useAuth';
import { useApi } from '../../hooks/useApi';
import { roleLabelOf } from '../../constants/enums';
import { roleHome } from '../../routes/roleHome';

// Trang đăng nhập (Module A — Vũ Việt). Gọi POST /auth/login thật.
// Khi chạy dev, có thêm "Đăng nhập nhanh" bằng tài khoản seed để tiện kiểm thử.
export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { startSession } = useAuth();
  const [error, setError] = useState(null);
  const [pendingPhone, setPendingPhone] = useState(null); // tài khoản chưa kích hoạt (UC01 Step 2c)
  const [loading, setLoading] = useState(false);

  const activated = location.state?.activated;
  const passwordReset = location.state?.passwordReset;
  const [sessionExpired] = useState(() => {
    try {
      const expired = window.sessionStorage.getItem(SESSION_EXPIRED_FLAG) === '1';
      window.sessionStorage.removeItem(SESSION_EXPIRED_FLAG);
      return expired;
    } catch {
      return false;
    }
  });

  const enter = (session) => {
    startSession(session);
    // UC01 bước 5: cư dân có từ 2 căn thì chọn căn làm việc trước
    const target = session.apartments?.length > 1 ? '/r/select-apartment' : roleHome(session.user);
    navigate(target, { replace: true, viewTransition: true });
  };

  const submit = async (values) => {
    setError(null);
    setPendingPhone(null);
    setLoading(true);
    try {
      const { data } = await authApi.login({
        phone: values.phone?.trim(),
        password: values.password,
      });
      enter(data);
    } catch (e) {
      if (e.errorCode === 'ACCOUNT_NOT_ACTIVATED') setPendingPhone(values.phone?.trim());
      setError(e.message || 'Đăng nhập không thành công');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <h2 className="m-0 text-2xl font-semibold tracking-tight text-ink">Đăng nhập</h2>
      <div className="w-8 h-0.5 bg-gold mt-2 mb-2" />
      <p className="m-0 mb-6 text-[13px] text-ink-2">Nhập thông tin tài khoản để truy cập hệ thống.</p>

      {sessionExpired && (
        <Alert type="warning" showIcon title="Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." className="mb-4" closable />
      )}

      {(activated || passwordReset) && (
        <Alert
          type="success"
          showIcon
          title={passwordReset ? 'Mật khẩu đã được đặt lại. Vui lòng đăng nhập.' : 'Tài khoản đã được kích hoạt. Vui lòng đăng nhập.'}
          className="mb-4"
          closable
        />
      )}

      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          className="mb-4"
          closable
          onClose={() => setError(null)}
          action={
            pendingPhone && (
              <Button size="small" type="primary" onClick={() => navigate('/activate', { state: { phone: pendingPhone } })}>
                Kích hoạt
              </Button>
            )
          }
        />
      )}

      <Form layout="vertical" requiredMark={false} onFinish={submit} disabled={loading}>
        <Form.Item name="phone" label="Số điện thoại" rules={PHONE_RULES}>
          <Input size="large" prefix={<PhoneOutlined className="text-ink-3" />} placeholder="0912345678" autoComplete="username" />
        </Form.Item>
        <Form.Item
          name="password"
          label="Mật khẩu"
          rules={[{ required: true, message: 'Vui lòng nhập mật khẩu' }]}
        >
          <Input.Password size="large" prefix={<LockOutlined className="text-ink-3" />} autoComplete="current-password" placeholder="Mật khẩu của bạn" />
        </Form.Item>
        <Button type="primary" htmlType="submit" size="large" block loading={loading}>
          Đăng nhập <ArrowRightOutlined />
        </Button>
      </Form>

      <div className="mt-4 text-center text-[13px] text-ink-2">
        <Link to="/forgot-password" className="font-semibold text-navy hover:text-gold transition-colors">
          Quên mật khẩu?
        </Link>
        {' · '}
        Lần đầu sử dụng?{' '}
        <Link to="/activate" className="font-semibold text-navy hover:text-gold transition-colors">
          Kích hoạt tài khoản
        </Link>
      </div>

      {import.meta.env.DEV && <DevQuickLogin onEnter={enter} />}
    </>
  );
}

// Chỉ hiện khi `npm run dev` — chọn 1 tài khoản seed để vào ngay (backend /api/dev/login)
function DevQuickLogin({ onEnter }) {
  const { data: accounts = [], error } = useApi(() => authApi.devAccounts(), []);
  const [busy, setBusy] = useState(null);

  const pick = async (email) => {
    setBusy(email);
    try {
      const { data } = await authApi.devLogin(email);
      onEnter(data);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-8 pt-6 border-t border-line">
      <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
        <ThunderboltOutlined className="text-gold" /> Đăng nhập nhanh (chỉ khi dev)
      </div>
      {error && <div className="text-xs text-ink-3">Backend chưa chạy hoặc chưa seed dữ liệu (npm run db:seed).</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto">
        {accounts.map((u) => (
          <button
            key={u._id}
            type="button"
            disabled={Boolean(busy)}
            onClick={() => pick(u.email)}
            className="cursor-pointer rounded-md border border-line bg-white p-2 text-left text-xs transition-colors hover:border-navy hover:bg-gold-bg/40 disabled:opacity-60"
          >
            <div className="truncate font-medium text-ink">{u.fullName}</div>
            <div className="truncate text-[11px] text-ink-3">
              {roleLabelOf(u)?.label} · {u.email}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

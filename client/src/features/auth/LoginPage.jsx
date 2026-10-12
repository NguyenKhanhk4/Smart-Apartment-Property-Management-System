import { useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router';
import { Alert, Button, Form, Input } from 'antd';
import { ArrowRightOutlined, LockOutlined, ThunderboltOutlined, UserOutlined } from '@ant-design/icons';
import { authApi } from '../../api/auth.api';
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
  const [loading, setLoading] = useState(false);

  const registeredSuccess = location.state?.registered;

  const enter = (session) => {
    startSession(session);
    navigate(roleHome(session.user), { replace: true, viewTransition: true });
  };

  const submit = async (values) => {
    setError(null);
    setLoading(true);
    try {
      const { data } = await authApi.login({
        email: values.email?.trim(),
        password: values.password,
      });
      enter(data);
    } catch (e) {
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

      {registeredSuccess && (
        <Alert
          type="success"
          showIcon
          message="Đăng ký tài khoản thành công! Vui lòng đăng nhập."
          className="mb-4"
          closable
        />
      )}

      {error && <Alert type="error" showIcon message={error} className="mb-4" closable onClose={() => setError(null)} />}

      <Form layout="vertical" requiredMark={false} onFinish={submit} disabled={loading}>
        <Form.Item
          name="email"
          label="Email"
          rules={[
            { required: true, message: 'Vui lòng nhập email' },
            { type: 'email', message: 'Email không đúng định dạng' },
          ]}
        >
          <Input size="large" prefix={<UserOutlined className="text-ink-3" />} placeholder="vd: cudan1@sapms.vn" autoComplete="username" />
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
        Chưa có tài khoản?{' '}
        <Link to="/register" className="font-semibold text-navy hover:text-gold transition-colors">
          Đăng ký
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

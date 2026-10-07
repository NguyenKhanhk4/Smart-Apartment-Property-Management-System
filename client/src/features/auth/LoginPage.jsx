import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert, Button, Form, Input } from 'antd';
import { ArrowRightOutlined, LockOutlined, ThunderboltOutlined, UserOutlined } from '@ant-design/icons';
import { authApi } from '../../api/auth.api';
import { useAuth } from '../../hooks/useAuth';
import { useApi } from '../../hooks/useApi';
import { roleLabelOf } from '../../constants/enums';
import { roleHome } from '../../routes/roleHome';

// Dev: Module A chưa xong nên bấm "Đăng nhập" là vào luôn (không kiểm tra mật khẩu).
// Để trống email → vào bằng DEV_DEFAULT_EMAIL; nhập email seed khác → vào bằng tài khoản đó.
// Khi Module A có POST /auth/login, đặt DEV_SKIP_LOGIN = false để dùng đăng nhập thật.
const DEV_SKIP_LOGIN = import.meta.env.DEV;
const DEV_DEFAULT_EMAIL = 'manager@sapms.vn';

// Trang đăng nhập (giao diện chung). Gọi POST /auth/login của Module A.
// Khi chạy dev, có thêm "Đăng nhập nhanh" bằng tài khoản seed để test giao diện trước khi Module A xong.
export default function LoginPage() {
  const navigate = useNavigate();
  const { startSession } = useAuth();
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const enter = (session) => {
    startSession(session);
    navigate(roleHome(session.user), { replace: true, viewTransition: true });
  };

  const submit = async (values) => {
    setError(null);
    setLoading(true);
    try {
      const { data } = DEV_SKIP_LOGIN
        ? await authApi.devLogin(values.email?.trim() || DEV_DEFAULT_EMAIL)
        : await authApi.login(values);
      enter(data);
    } catch (e) {
      setError(e.status === 404 ? 'Chức năng đăng nhập (Module A) chưa sẵn sàng. Dùng "Đăng nhập nhanh" bên dưới khi đang dev.' : e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <h2 className="m-0 text-2xl font-semibold tracking-tight text-ink">Đăng nhập</h2>
      <div className="w-8 h-0.5 bg-gold mt-2 mb-2" />
      <p className="m-0 mb-6 text-[13px] text-ink-2">Dùng tài khoản do Ban quản lý cấp.</p>

      {error && <Alert type="error" showIcon message={error} className="mb-4" closable onClose={() => setError(null)} />}

      <Form layout="vertical" requiredMark={false} onFinish={submit} disabled={loading}>
        <Form.Item name="email" label="Email" rules={[{ required: !DEV_SKIP_LOGIN, type: 'email', message: 'Nhập email hợp lệ' }]}>
          <Input size="large" prefix={<UserOutlined className="text-ink-3" />} placeholder="vd: manager@sapms.vn" autoComplete="username" />
        </Form.Item>
        <Form.Item name="password" label="Mật khẩu" rules={[{ required: !DEV_SKIP_LOGIN, message: 'Nhập mật khẩu' }]}>
          <Input.Password size="large" prefix={<LockOutlined className="text-ink-3" />} autoComplete="current-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" size="large" block loading={loading}>
          Đăng nhập <ArrowRightOutlined />
        </Button>
      </Form>

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

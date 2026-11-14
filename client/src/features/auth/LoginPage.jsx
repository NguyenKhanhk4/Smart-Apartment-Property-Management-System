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
import { ALERT_GAP } from './authStyles';
import { PORTALS, belongsToPortal, portalPath, useAuthPortal } from './authPortal';

// Lời chào và gợi ý theo cổng
const COPY = {
  resident: { title: 'Chào mừng về nhà', desc: 'Đăng nhập bằng số điện thoại đã đăng ký với Ban quản lý.' },
  staff: { title: 'Đăng nhập nội bộ', desc: 'Dành cho Ban quản lý, kế toán, lễ tân, kỹ thuật, bảo vệ và Ban quản trị.' },
};
const WRONG_PORTAL = {
  resident: 'Đây là tài khoản nội bộ. Vui lòng đăng nhập ở Cổng Ban quản lý.',
  staff: 'Đây là tài khoản cư dân. Vui lòng đăng nhập ở Cổng cư dân.',
};

// Trang đăng nhập (Module A — Vũ Việt). Gọi POST /auth/login thật. Có 2 cổng (cư dân / Ban quản lý):
// tài khoản đăng nhập nhầm cổng thì không vào, hủy phiên vừa cấp và chỉ sang cổng đúng.
// Khi chạy dev, có thêm "Đăng nhập nhanh" bằng tài khoản seed để tiện kiểm thử.
export default function LoginPage() {
  const portal = useAuthPortal();
  const otherPortal = PORTALS[portal].other;
  const [wrongPortal, setWrongPortal] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { startSession } = useAuth();
  const [error, setError] = useState(null);
  const [pendingPhone, setPendingPhone] = useState(null); // tài khoản chưa kích hoạt (UC01 Step 2c)
  const [loading, setLoading] = useState(false);

  // Thông báo xanh sau khi kích hoạt / đặt lại mật khẩu: tắt khi bấm đăng nhập để không chồng với lỗi đỏ
  const [notice, setNotice] = useState(() => {
    if (location.state?.passwordReset) return 'Mật khẩu đã được đặt lại. Vui lòng đăng nhập.';
    if (location.state?.activated) return 'Tài khoản đã được kích hoạt. Vui lòng đăng nhập.';
    return null;
  });
  const prefillPhone = location.state?.phone; // SĐT vừa kích hoạt / đặt lại mật khẩu
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
    if (!belongsToPortal(session.user, portal)) {
      if (session.refreshToken) authApi.logout(session.refreshToken).catch(() => {});
      setError(WRONG_PORTAL[portal]);
      setWrongPortal(true);
      return;
    }
    startSession(session);
    // UC01 bước 5: cư dân có từ 2 căn thì chọn căn làm việc trước
    const target = session.apartments?.length > 1 ? '/r/select-apartment' : roleHome(session.user);
    navigate(target, { replace: true, viewTransition: true });
  };

  const submit = async (values) => {
    setError(null);
    setNotice(null);
    setPendingPhone(null);
    setWrongPortal(false);
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
      <h2 className="m-0 text-lg font-semibold tracking-tight text-ink">{COPY[portal].title}</h2>
      <p className="mt-1 mb-7 text-[13px] text-ink-2">{COPY[portal].desc}</p>

      {sessionExpired && (
        <Alert type="warning" showIcon title="Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." style={ALERT_GAP} closable />
      )}

      {notice && <Alert type="success" showIcon title={notice} style={ALERT_GAP} closable={{ onClose: () => setNotice(null) }} />}

      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          style={ALERT_GAP}
          closable={{ onClose: () => setError(null) }}
          action={
            (pendingPhone && (
              <Button size="small" type="primary" onClick={() => navigate(portalPath(portal, '/activate'), { state: { phone: pendingPhone } })}>
                Kích hoạt
              </Button>
            )) ||
            (wrongPortal && (
              <Button size="small" type="primary" onClick={() => navigate(portalPath(otherPortal, '/login'))}>
                Sang {PORTALS[otherPortal].label}
              </Button>
            ))
          }
        />
      )}

      <Form layout="vertical" requiredMark={false} onFinish={submit} disabled={loading} initialValues={prefillPhone ? { phone: prefillPhone } : undefined}>
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
        <div className="-mt-2 mb-5 text-right text-[13px]">
          <Link to={portalPath(portal, '/forgot-password')} className="font-medium text-navy hover:text-navy-hover">
            Quên mật khẩu?
          </Link>
        </div>
        <Button type="primary" htmlType="submit" size="large" block loading={loading}>
          Đăng nhập <ArrowRightOutlined />
        </Button>
      </Form>

      <div className="mt-6 pt-5 border-t border-line text-center text-[13px] text-ink-2">
        Lần đầu sử dụng?{' '}
        <Link to={portalPath(portal, '/activate')} className="font-medium text-navy hover:text-navy-hover">
          Kích hoạt tài khoản
        </Link>
      </div>

      {import.meta.env.DEV && <DevQuickLogin portal={portal} onEnter={enter} />}
    </>
  );
}

// Chỉ hiện khi `npm run dev` — chọn 1 tài khoản seed để vào ngay (backend /api/dev/login)
function DevQuickLogin({ portal, onEnter }) {
  const { data: all = [], error } = useApi(() => authApi.devAccounts(), []);
  const accounts = all.filter((u) => belongsToPortal(u, portal)); // chỉ tài khoản của cổng đang đứng
  const [busy, setBusy] = useState(null);

  const pick = async (id) => {
    setBusy(id);
    try {
      const { data } = await authApi.devLogin(id);
      onEnter(data);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-6 pt-5 border-t border-dashed border-line-strong">
      <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-3">
        <ThunderboltOutlined className="text-navy" /> Đăng nhập nhanh (chỉ khi dev)
      </div>
      {error && <div className="text-xs text-ink-3">Backend chưa chạy hoặc chưa seed dữ liệu (npm run db:seed).</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto">
        {accounts.map((u) => (
          <button
            key={u._id}
            type="button"
            disabled={Boolean(busy)}
            onClick={() => pick(u._id)}
            className="cursor-pointer rounded-lg border border-line bg-white p-2 text-left text-xs transition-colors hover:border-navy hover:bg-navy-bg disabled:opacity-60"
          >
            <div className="truncate font-medium text-ink">{u.fullName}</div>
            <div className="truncate text-[11px] text-ink-3">
              {roleLabelOf(u)?.label} · {u.email ?? u.phone}
              {!u.activatedAt && ' · chưa kích hoạt'}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

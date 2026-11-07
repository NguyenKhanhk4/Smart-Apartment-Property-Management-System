import { Button, Popconfirm, Spin, Tag } from 'antd';
import { usersApi } from '../../api/moduleA.api';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import PersonalDataTerms from '../auth/PersonalDataTerms';

// BR-X7: xem trạng thái, đồng ý hoặc rút lại đồng ý về dữ liệu cá nhân
export default function ConsentTab() {
  const { updateUser } = useAuth();
  const { data: profile, loading, reload } = useApi(() => usersApi.me(), []);
  const [change, changing] = useAction((action) => usersApi.updateConsent(action), {
    success: (res) =>
      res.data.consentStatus === 'ACCEPTED'
        ? 'Bạn đã đồng ý với điều khoản dữ liệu cá nhân.'
        : 'Bạn đã rút lại đồng ý. Khai báo nhân khẩu, đăng ký xe và tải ảnh đã bị khóa.',
    onDone: async (res) => {
      updateUser(res.data);
      await reload();
    },
  });

  if (loading && !profile) return <Spin />;
  const accepted = profile?.consentStatus === 'ACCEPTED';

  return (
    <div className="max-w-2xl">
      <p className="mt-0">
        Trạng thái: <Tag color={accepted ? 'success' : 'default'}>{accepted ? 'Đã đồng ý' : 'Chưa đồng ý'}</Tag>
      </p>
      <PersonalDataTerms />
      <div className="mt-4">
        {accepted ? (
          <Popconfirm
            title="Rút lại đồng ý?"
            description="Khai báo nhân khẩu, đăng ký xe và tải ảnh sẽ bị khóa."
            okText="Rút lại"
            cancelText="Hủy"
            onConfirm={() => change('WITHDRAWN').catch(() => {})}
          >
            <Button danger loading={changing}>Rút lại đồng ý</Button>
          </Popconfirm>
        ) : (
          <Button type="primary" loading={changing} onClick={() => change('ACCEPTED').catch(() => {})}>
            Đồng ý với điều khoản
          </Button>
        )}
      </div>
    </div>
  );
}

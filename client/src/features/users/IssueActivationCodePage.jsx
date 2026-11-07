import { useState } from 'react';
import { Alert, Button, Card, Checkbox, Descriptions, Form, Input, Modal, Tag, Typography } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import { activationCodeApi } from '../../api/moduleA.api';
import PageHeader from '../../components/PageHeader';
import { roleLabelOf } from '../../constants/enums';
import { useAction } from '../../hooks/useApi';
import { formatDateTime } from '../../utils/format';
import { PHONE_RULES, isValidPhone } from '../../utils/phone';

const STATUS = {
  PENDING: { label: 'Chờ kích hoạt', color: 'warning' },
  ACTIVE: { label: 'Đang hoạt động', color: 'success' },
  LOCKED: { label: 'Đã khóa', color: 'error' },
};
const PURPOSE = { ACTIVATION: 'kích hoạt tài khoản', PASSWORD_RESET: 'đặt lại mật khẩu' };
const formatCode = (code) => code.replace(/(.{4})(?=.)/g, '$1-');

/** Mở cửa sổ in chỉ gồm phiếu mã; dựng bằng DOM để tên người dùng không bị hiểu là HTML */
function printSlip(issued) {
  const win = window.open('', '_blank', 'width=420,height=520');
  if (!win) return;
  const doc = win.document;
  doc.title = 'Mã kích hoạt SAPMS';
  doc.body.style.cssText = 'font-family: sans-serif; padding: 24px; text-align: center;';
  const line = (text, style = '') => {
    const p = doc.createElement('p');
    p.textContent = text;
    p.style.cssText = style;
    doc.body.appendChild(p);
  };
  line('SAPMS – Mã ' + PURPOSE[issued.purpose], 'font-weight: 600;');
  line(issued.fullName);
  line('SĐT: ' + issued.phone);
  line(formatCode(issued.code), 'font-size: 28px; letter-spacing: 4px; font-weight: 700; margin: 24px 0;');
  line('Có hiệu lực đến ' + formatDateTime(issued.expiresAt) + '. Mã chỉ dùng 1 lần.');
  line('Vào trang Kích hoạt tài khoản, chọn "Tôi đã có mã in tại quầy", nhập SĐT, mã này và mật khẩu mới.');
  win.focus();
  win.print();
}

// UC02 bước 5–6 (Lễ tân, Trưởng BQL): tra SĐT, đối chiếu CCCD, cấp mã in hạn 48 giờ (MSG-S09)
export default function IssueActivationCodePage() {
  const [account, setAccount] = useState(null);
  const [checked, setChecked] = useState(false);
  const [issued, setIssued] = useState(null);
  const [phoneError, setPhoneError] = useState(null);
  const [changingPhone, setChangingPhone] = useState(false);

  const [lookup, looking] = useAction((phone) => activationCodeApi.lookup(phone), {
    success: () => null, // kết quả hiện ngay trên trang, không cần thông báo
    onDone: (res) => {
      setAccount(res.data);
      setChecked(false);
    },
  });
  const [issue, issuing] = useAction(() => activationCodeApi.issue(account.userId), {
    success: () => null, // kết quả hiện ngay trên trang, không cần thông báo
    onDone: (res) => {
      setIssued(res.data);
      setChecked(false);
    },
  });

  // Đổi SĐT đăng nhập sau khi đối chiếu CCCD; số mới đã có tài khoản thì server từ chối (BR-X5)
  const [phoneForm] = Form.useForm();
  const [changePhone, savingPhone] = useAction(({ phone }) => activationCodeApi.changePhone(account.userId, phone.trim()), {
    success: (res) => `Đã đổi số điện thoại sang ${res.data.phone}. Người dùng đăng nhập bằng số mới, mật khẩu giữ nguyên.`,
    onDone: (res) => {
      setAccount(res.data);
      setChecked(false);
      setChangingPhone(false);
      phoneForm.resetFields();
    },
  });

  const search = (value) => {
    const phone = value.trim();
    if (!isValidPhone(phone)) {
      setPhoneError('Số điện thoại không hợp lệ');
      return;
    }
    setPhoneError(null);
    setAccount(null);
    lookup(phone).catch(() => {});
  };

  return (
    <>
      <PageHeader
        title="Cấp mã kích hoạt, đổi số điện thoại"
        subtitle="Cấp mã in hoặc đổi số điện thoại đăng nhập tại quầy, sau khi đối chiếu CCCD."
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Cấp mã kích hoạt' }]}
      />
      <Card className="max-w-2xl">
        <Input.Search
          size="large"
          placeholder="Số điện thoại của người cần cấp mã"
          enterButton="Tra cứu"
          loading={looking}
          onSearch={search}
          status={phoneError ? 'error' : undefined}
        />
        {phoneError && <Typography.Text type="danger">{phoneError}</Typography.Text>}

        {account && (
          <div className="mt-6">
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Họ tên">{account.fullName}</Descriptions.Item>
              <Descriptions.Item label="Số điện thoại">{account.phone}</Descriptions.Item>
              <Descriptions.Item label="Vai trò">{roleLabelOf(account)}</Descriptions.Item>
              <Descriptions.Item label="Trạng thái">
                <Tag color={STATUS[account.status].color}>{STATUS[account.status].label}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="CCCD (4 số cuối)">{account.idNumber ?? 'Chưa có trên hệ thống'}</Descriptions.Item>
              {account.apartments.length > 0 && (
                <Descriptions.Item label="Căn hộ">{account.apartments.join(', ')}</Descriptions.Item>
              )}
              <Descriptions.Item label="Email">{account.hasEmail ? 'Có' : 'Không có'}</Descriptions.Item>
            </Descriptions>

            {account.canIssue ? (
              <>
                <Alert
                  type="info"
                  showIcon
                  className="mt-4"
                  title={`Mã dùng để ${PURPOSE[account.purpose]}, có hiệu lực 48 giờ.`}
                  description="Cấp mã mới sẽ hủy mọi mã và OTP chưa dùng trước đó của tài khoản này."
                />
                <Checkbox className="mt-4" checked={checked} onChange={(e) => setChecked(e.target.checked)}>
                  Đã đối chiếu CCCD và họ tên của người đến quầy với thông tin trên
                </Checkbox>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="primary" disabled={!checked} loading={issuing} onClick={() => issue().catch(() => {})}>
                    Cấp mã
                  </Button>
                  <Button disabled={!checked} onClick={() => setChangingPhone(true)}>
                    Đổi số điện thoại
                  </Button>
                </div>
              </>
            ) : (
              <Alert type="warning" showIcon className="mt-4" title={account.blockReason} />
            )}
          </div>
        )}
      </Card>

      <Modal
        open={changingPhone}
        title="Đổi số điện thoại đăng nhập"
        okText="Đổi số"
        cancelText="Hủy"
        confirmLoading={savingPhone}
        onOk={() => phoneForm.submit()}
        onCancel={() => {
          setChangingPhone(false);
          phoneForm.resetFields();
        }}
        destroyOnHidden
      >
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          title={`Đổi số cho ${account?.fullName ?? ''} (số hiện tại ${account?.phone ?? ''})`}
          description="Mọi thiết bị đang đăng nhập sẽ bị đăng xuất và các mã chưa dùng bị hủy. Người dùng nhận thông báo về việc đổi số."
        />
        <Form form={phoneForm} layout="vertical" onFinish={(values) => changePhone(values).catch(() => {})}>
          <Form.Item name="phone" label="Số điện thoại mới" rules={PHONE_RULES}>
            <Input placeholder="0912345678" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(issued)}
        title="Đã cấp mã"
        onCancel={() => setIssued(null)}
        footer={[
          <Button key="close" onClick={() => setIssued(null)}>
            Đóng
          </Button>,
          <Button key="print" type="primary" icon={<PrinterOutlined />} onClick={() => printSlip(issued)}>
            In mã
          </Button>,
        ]}
      >
        {issued && (
          <div className="text-center">
            <p>
              Mã {PURPOSE[issued.purpose]} cho <b>{issued.phone}</b>, có hiệu lực đến <b>{formatDateTime(issued.expiresAt)}</b>.
            </p>
            <Typography.Title level={2} copyable={{ text: issued.code }} className="tracking-widest">
              {formatCode(issued.code)}
            </Typography.Title>
            <Typography.Text type="secondary">
              Mã chỉ hiện một lần. Đóng hộp thoại này thì phải cấp mã mới.
            </Typography.Text>
          </div>
        )}
      </Modal>
    </>
  );
}

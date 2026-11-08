import { Alert, Button, Checkbox, Form, Input, Modal, Select, Space } from 'antd';
import { contractsApi } from '../../api/moduleA.api';
import { debtApi } from '../../api/moduleB.api';
import PhoneAccountNotice from '../../components/PhoneAccountNotice';
import { OWNERSHIP_DOCUMENT_TYPES } from '../../constants/enums';
import { useAction, useApi } from '../../hooks/useApi';
import { usePhoneAccount } from '../../hooks/usePhoneAccount';
import { formatDateTime, formatMoney } from '../../utils/format';
import { PHONE_RULES } from '../../utils/phone';

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const proofOptions = ['TRANSFER_DOCUMENT', 'OWNERSHIP_CERTIFICATE']
  .map((value) => ({ value, label: OWNERSHIP_DOCUMENT_TYPES[value].label }));

export default function TransferOwnerModal({ apartment, sale, onClose, reloadApartment, onTransferred }) {
  const [form] = Form.useForm();
  const check = usePhoneAccount(Form.useWatch('phone', form));
  const { data: debt, loading: checkingDebt, error: debtError, reload: reloadDebt } = useApi(
    () => debtApi.check(apartment._id), [apartment._id],
  );
  const requestedAt = sale.transferDebtRequestedAt;
  const deadline = requestedAt ? new Date(requestedAt).getTime() + TWO_DAYS_MS : null;
  const waitingForDebt = debt?.amount > 0 && !sale.transferDebtAcknowledgedAt;
  const debtBlocked = waitingForDebt && (!deadline || new Date(debt.at).getTime() < deadline);

  const [requestReview, requesting] = useAction(
    () => contractsApi.requestTransferDebtReview(apartment._id, sale._id),
    { success: 'Đã gửi yêu cầu cho kế toán', onDone: reloadApartment },
  );
  const [transfer, transferring] = useAction(
    ({ phone, fullName, email, ...values }) => contractsApi.transferOwner(apartment._id, {
      ...values,
      contractId: sale._id,
      owner: check.isExisting ? { phone, userId: check.userId } : { phone, fullName, email },
    }),
    {
      success: (result) => result.data.keptTenancy
        ? 'Đã đổi chủ và chuyển quyền quản lý lượt thuê sang chủ mới'
        : 'Đã cập nhật chủ sở hữu',
      onDone: () => {
        onClose();
        return onTransferred();
      },
    },
  );

  return (
    <Modal
      title="Cập nhật chủ sở hữu"
      open
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Xác nhận đổi chủ"
      cancelText="Hủy"
      confirmLoading={transferring}
      okButtonProps={{ disabled: checkingDebt || !debt || Boolean(debtError) || debtBlocked || Boolean(check.blockReason) }}
    >
      <Space direction="vertical" className="mb-4 w-full">
        <Alert
          type="info"
          showIcon
          title={`Căn ${apartment.code} · Chủ hiện tại ${sale.ownerId?.fullName ?? '—'}`}
          description="Quyền của chủ mới có hiệu lực khi xác nhận. Nếu căn đang cho thuê, khách thuê tiếp tục sử dụng tài khoản và chủ mới quản lý lượt thuê."
        />
        {debtError && (
          <Alert type="error" title="Chưa đọc được công nợ"
            action={<Button onClick={reloadDebt}>Thử lại</Button>} />
        )}
        {debt?.amount > 0 && (
          <Alert
            type="warning"
            showIcon
            title={`Công nợ còn lại ${formatMoney(debt.amount)}`}
            description={
              <>
                {debt.byPayer.filter((payer) => payer.net > 0).map((payer) => (
                  <div key={payer.payerId ?? 'unknown'}>{payer.fullName ?? 'Người nộp phí'} · {formatMoney(payer.net)}</div>
                ))}
                {sale.transferDebtAcknowledgedAt
                  ? <div>Kế toán đã ghi nhận công nợ.</div>
                  : requestedAt && <div>{debtBlocked
                    ? `Có thể xác nhận từ ${formatDateTime(deadline)} nếu kế toán chưa ghi nhận.`
                    : 'Đã đủ 2 ngày chờ kế toán. Hệ thống sẽ ghi nhật ký khi xác nhận.'}</div>}
              </>
            }
            action={waitingForDebt && (
              requestedAt
                ? <Button onClick={() => Promise.all([reloadApartment(), reloadDebt()])}>Làm mới</Button>
                : <Button loading={requesting} onClick={() => requestReview().catch(() => {})}>Yêu cầu kế toán</Button>
            )}
          />
        )}
      </Space>

      <Form
        form={form}
        layout="vertical"
        initialValues={{ ownershipDocumentType: 'TRANSFER_DOCUMENT' }}
        onFinish={(values) => {
          if (!check.blockReason && !debtBlocked && debt && !checkingDebt && !debtError) {
            transfer(values).catch(() => {});
          }
        }}
      >
        <Form.Item name="phone" label="Số điện thoại chủ mới" rules={PHONE_RULES}>
          <Input />
        </Form.Item>
        <PhoneAccountNotice check={check} />
        {!check.isExisting && (
          <>
            <Form.Item name="fullName" label="Họ tên chủ mới" rules={[{ required: true, whitespace: true, min: 2, max: 100 }]}>
              <Input />
            </Form.Item>
            <Form.Item name="email" label="Email (không bắt buộc)" rules={[{ type: 'email' }]}>
              <Input />
            </Form.Item>
          </>
        )}
        <Form.Item name="ownershipDocumentType" label="Giấy tờ đối chiếu" rules={[{ required: true }]}>
          <Select options={proofOptions} />
        </Form.Item>
        <Form.Item name="ownershipDocumentNumber" label="Số tham chiếu giấy tờ" rules={[{ required: true, whitespace: true }]}>
          <Input maxLength={100} />
        </Form.Item>
        <Form.Item name="identityVerified" valuePropName="checked" rules={[{
          validator: (_, verified) => verified
            ? Promise.resolve()
            : Promise.reject(new Error('Cần đối chiếu hồ sơ và xác nhận ngày bàn giao đã có hiệu lực')),
        }]}>
          <Checkbox>Đã đối chiếu người nhận chuyển nhượng và xác nhận việc bàn giao có hiệu lực.</Checkbox>
        </Form.Item>
      </Form>
    </Modal>
  );
}

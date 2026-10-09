import { useState } from 'react';
import { Alert, App, Modal, Segmented, Select } from 'antd';
import { amenityPassApi } from '../../api/moduleD.api';
import { AGE_GROUPS } from '../../constants/enums';
import { formatMoney } from '../../utils/format';
import { monthLabel } from '../bookings/passUtils';

/**
 * Mua gói tháng (UC-D09) — chỉ chủ hộ. `info` = kết quả amenityPassApi.options cho tháng đang chọn;
 * đổi tháng thì gọi onMonthChange để cha tải lại `info`. Mount mới (đổi key) để khởi tạo lại lựa chọn.
 */
export default function PurchasePassModal({ open, onClose, info, loading, apartmentId, initial, onMonthChange, onDone }) {
  const { message } = App.useApp();
  const [memberId, setMemberId] = useState(initial.memberId);
  const [amenityId, setAmenityId] = useState(initial.amenityId);
  const [busy, setBusy] = useState(false);

  const member = info?.members.find((m) => m.userId === memberId);
  const amenity = info?.amenities.find((a) => String(a._id) === amenityId);
  const option = info?.options.find((o) => o.userId === memberId && o.amenityId === amenityId);
  const canBuy = Boolean(info) && !loading && !info.overdue && option?.status === 'AVAILABLE';

  const submit = async () => {
    setBusy(true);
    try {
      await amenityPassApi.purchase({ apartmentId, userId: memberId, amenityId, month: info.month });
      message.success('Đã mua gói tháng');
      await onDone();
      onClose();
    } catch (e) {
      message.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="Đăng ký gói tháng"
      okText="Mua gói"
      cancelText="Hủy"
      onOk={submit}
      okButtonProps={{ disabled: !canBuy, loading: busy }}
      destroyOnHidden
    >
      {info && (
        <div className="flex flex-col gap-3">
          {info.overdue && (
            <Alert type="warning" showIcon title="Căn hộ đang có hóa đơn quá hạn" description="Bạn chưa thể mua gói tháng cho tới khi thanh toán hóa đơn quá hạn." />
          )}
          <Segmented
            block
            value={info.month}
            onChange={onMonthChange}
            options={[
              { value: info.months[0], label: `Tháng này (${monthLabel(info.months[0])})` },
              { value: info.months[1], label: `Tháng sau (${monthLabel(info.months[1])})` },
            ]}
          />
          <Select
            value={memberId}
            onChange={setMemberId}
            options={info.members.map((m) => ({ value: m.userId, label: m.fullName }))}
            aria-label="Thành viên"
          />
          <Select
            value={amenityId}
            onChange={setAmenityId}
            options={info.amenities.map((a) => ({ value: String(a._id), label: a.name }))}
            aria-label="Tiện ích"
          />
          {amenity && member && option && (
            <div className="text-sm text-r-muted leading-relaxed">
              {option.status === 'NOT_REQUIRED' && 'Trẻ nhỏ được miễn phí, không cần gói.'}
              {option.status === 'OWNED' && `${member.fullName} đã có gói ${amenity.name} tháng ${monthLabel(info.month)}.`}
              {option.status === 'AVAILABLE' && (
                <>
                  Giá: <b className="text-r-text">{formatMoney(option.fee)}</b> ({AGE_GROUPS[option.ageGroup]?.label.toLowerCase()}). Hiệu lực ngay, tính trọn tháng; phí cộng vào hóa đơn đầu tháng sau.
                </>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

import { Descriptions, Modal, Tag } from 'antd';
import dayjs from 'dayjs';
import { DUTY_ROLE_TITLES } from '../../constants/enums';
import { SHIFT_KINDS, isOvernight, shiftKind, shiftLabel, shiftState } from './shiftLayout';

// Xem chi tiết một ca (chỉ đọc): ca đã kết thúc, hoặc người xem không phải Trưởng BQL. Lịch cũ không sửa được.
export default function ShiftDetailModal({ shift, onClose }) {
  const state = shiftState(shift, dayjs());
  return (
    <Modal title="Chi tiết ca trực" open onCancel={onClose} footer={null} width="min(460px, 94vw)">
      <Descriptions column={1} size="small" bordered className="mt-2">
        <Descriptions.Item label="Trạng thái">
          <Tag color={state.color} className="m-0">{state.label}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Bộ phận">{DUTY_ROLE_TITLES[shift.roleTitle]?.label ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="Ngày">{dayjs(shift.startAt).format('dddd, DD/MM/YYYY')}</Descriptions.Item>
        <Descriptions.Item label="Giờ">
          {shiftLabel(shift, dayjs)} · {SHIFT_KINDS[shiftKind(shift.startAt, dayjs)].label}
          {isOvernight(shift, dayjs) && <div className="text-[12px] text-ink-3">Qua đêm, kết thúc {dayjs(shift.endAt).format('HH:mm DD/MM')}</div>}
        </Descriptions.Item>
        <Descriptions.Item label="Người trực">
          {shift.userId?.fullName ?? '—'}
          {shift.userId?.phone && <div className="text-[12px] text-ink-3">{shift.userId.phone}</div>}
        </Descriptions.Item>
        {shift.note && <Descriptions.Item label="Ghi chú">{shift.note}</Descriptions.Item>}
      </Descriptions>
      {state.key === 'ENDED' && <p className="mt-3 mb-0 text-[12.5px] text-ink-3">Ca đã kết thúc chỉ để tra cứu, không sửa hay hủy được.</p>}
    </Modal>
  );
}

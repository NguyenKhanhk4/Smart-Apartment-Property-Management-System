import { Tooltip } from 'antd';
import { MoonOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { SHIFT_KINDS, isOvernight, shiftKind, shiftLabel } from './shiftLayout';

/** Nội dung tooltip của một ca: giờ, người trực, SĐT, ghi chú */
export function ShiftTip({ shift }) {
  return (
    <div className="text-[12.5px] leading-relaxed">
      <div className="font-semibold">{shiftLabel(shift, dayjs)}</div>
      <div>{shift.userId?.fullName ?? '—'}{shift.userId?.phone ? ` · ${shift.userId.phone}` : ''}</div>
      {isOvernight(shift, dayjs) && <div className="opacity-80">Ca qua đêm: kết thúc sáng hôm sau</div>}
      {shift.note && <div className="opacity-80">Ghi chú: {shift.note}</div>}
    </div>
  );
}

/**
 * Một ca dạng thẻ nhỏ (lịch tháng): chấm màu loại ca, giờ (ca qua đêm có 🌙 và "+1"), tên người trực.
 * Kéo thả được khi `drag` có (Trưởng BQL, ca chưa bắt đầu); bấm mở `onOpen`.
 */
export default function ShiftChip({ shift, mine, drag, onOpen }) {
  const kind = SHIFT_KINDS[shiftKind(shift.startAt, dayjs)];
  const overnight = isOvernight(shift, dayjs);
  const start = dayjs(shift.startAt).format('HH:mm');
  const end = dayjs(shift.endAt).format('HH:mm');
  const ended = !dayjs().isBefore(shift.endAt); // ca đã kết thúc: mờ đi, chỉ xem
  return (
    <Tooltip title={<ShiftTip shift={shift} />} mouseEnterDelay={0.3}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen?.(shift);
        }}
        {...drag}
        className={`w-full min-w-0 flex items-center gap-1.5 rounded-md border px-1.5 py-[3px] text-left text-[11.5px] leading-tight cursor-pointer ${kind.className} ${
          mine ? 'ring-2 ring-navy/40 font-semibold' : ''
        } ${drag?.draggable ? 'cursor-grab active:cursor-grabbing' : ''} ${ended ? 'opacity-55 saturate-50' : ''}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${kind.dot}`} aria-hidden />
        <span className="shrink-0 tabular-nums">
          {overnight && <MoonOutlined className="mr-0.5" />}
          {start}
          {overnight ? `→${end}` : ''}
        </span>
        <span className="truncate">{shift.userId?.fullName ?? '—'}</span>
      </button>
    </Tooltip>
  );
}

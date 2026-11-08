import { Popover } from 'antd';
import dayjs from 'dayjs';
import ShiftChip from './ShiftChip';
import { shiftsStartingOn } from './shiftLayout';

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const MAX_CHIPS = 3;

/**
 * Lịch tháng: mỗi ô ngày liệt kê các ca BẮT ĐẦU trong ngày (ca qua đêm có 🌙, giờ kết thúc ghi sau mũi tên).
 * Quá 3 ca thì "+N ca" mở danh sách đầy đủ. Trưởng BQL: bấm ô để xếp ca ngày đó, bấm ca để sửa, kéo ca sang ô khác để dời.
 */
export default function MonthCalendar({ month, shifts, userId, isManager, onOpen, onCreate, dnd }) {
  const gridStart = month.startOf('month').startOf('week');
  const weeks = Math.ceil(month.endOf('month').diff(gridStart, 'day') / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => gridStart.add(i, 'day'));
  const now = dayjs();

  const chip = (s) => (
    <ShiftChip
      key={s._id}
      shift={s}
      mine={s.userId?._id === userId}
      onOpen={onOpen}
      drag={
        dnd.canDrag(s)
          ? {
              draggable: true,
              onDragStart: (e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', s._id);
                dnd.setDragging(s);
              },
              onDragEnd: () => {
                dnd.setDragging(null);
                dnd.setOverDay(null);
              },
            }
          : undefined
      }
    />
  );

  return (
    <div className="rounded-xl border border-line overflow-hidden bg-white dark:bg-[#18181B] dark:border-[#2E2E33] overflow-x-auto">
      <div className="min-w-[760px]">
        <div className="grid grid-cols-7 bg-surface-alt border-b border-line dark:bg-[#1F1F23] dark:border-[#2E2E33]">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-2 text-[12px] font-medium text-ink-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day) => {
            const inMonth = day.isSame(month, 'month');
            const today = day.isSame(now, 'day');
            const past = day.isBefore(now, 'day');
            const items = shiftsStartingOn(shifts, day);
            const droppable = dnd.canDropOn(day);
            const over = droppable && dnd.overDay?.isSame(day, 'day');
            return (
              <div
                key={day.valueOf()}
                role="presentation"
                onClick={() => isManager && !past && onCreate(day.hour(6).minute(0))}
                title={isManager && past ? 'Ngày đã qua: chỉ xem, không xếp ca' : undefined}
                onDragOver={(e) => {
                  if (!droppable) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (!over) dnd.setOverDay(day);
                }}
                onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && dnd.setOverDay(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  dnd.dropOn(day);
                }}
                className={`min-h-[118px] border-b border-r border-line p-1.5 flex flex-col gap-1 dark:border-[#2E2E33] ${
                  inMonth ? '' : 'bg-black/[0.02] dark:bg-white/[0.02]'
                } ${today ? 'bg-navy-bg/60 dark:bg-blue-950/30' : ''} ${over ? 'outline-2 outline-dashed outline-navy -outline-offset-2 bg-navy-bg' : ''} ${
                  isManager && !past ? 'cursor-copy' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[12px] tabular-nums ${
                      today ? 'w-6 h-6 rounded-full bg-navy text-white flex items-center justify-center font-semibold' : inMonth ? 'text-ink font-medium' : 'text-ink-3'
                    }`}
                  >
                    {day.date()}
                  </span>
                  {items.length > 0 && <span className="text-[10.5px] text-ink-3">{items.length} ca</span>}
                </div>
                {items.slice(0, MAX_CHIPS).map(chip)}
                {items.length > MAX_CHIPS && (
                  <Popover
                    trigger="click"
                    title={`Ca trực ${day.format('dd DD/MM')}`}
                    content={<div className="flex flex-col gap-1 w-[240px]">{items.map(chip)}</div>}
                  >
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      className="text-left text-[11.5px] font-medium text-navy bg-transparent border-0 p-0 cursor-pointer hover:underline"
                    >
                      +{items.length - MAX_CHIPS} ca nữa
                    </button>
                  </Popover>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

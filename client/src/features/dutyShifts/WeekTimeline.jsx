import { useEffect, useRef } from 'react';
import { Tooltip } from 'antd';
import { MoonOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { ShiftTip } from './ShiftChip';
import { SHIFT_KINDS, segmentsForDay, shiftKind } from './shiftLayout';

const HOUR_PX = 40;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * Lịch tuần dạng lưới giờ: cột trái 00:00–23:00, 7 cột ngày; mỗi ca là một khối đặt đúng giờ.
 * Nhiều người cùng ca → các khối xếp cạnh nhau. Ca qua đêm cắt 2 đoạn: cuối ngày bắt đầu (↓ sang hôm sau) và
 * đầu ngày hôm sau (↳ tiếp ca đêm). Vạch đỏ = giờ hiện tại. Mở sẵn ở 06:00.
 * Trưởng BQL: bấm ô trống để xếp ca giờ đó, bấm khối để sửa, kéo khối (đoạn đầu của ca) sang cột ngày khác để dời.
 */
export default function WeekTimeline({ days, shifts, userId, isManager, onOpen, onCreate, dnd }) {
  const scroller = useRef(null);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 6 * HOUR_PX - 8;
  }, []);
  const now = dayjs();
  const nowMin = now.hour() * 60 + now.minute();

  return (
    <div className="rounded-xl border border-line bg-white dark:bg-[#18181B] dark:border-[#2E2E33] overflow-hidden">
      <div ref={scroller} className="max-h-[68vh] overflow-auto">
        <div className="min-w-[860px] grid grid-cols-[56px_repeat(7,minmax(0,1fr))]">
          {/* Hàng tiêu đề ngày (dính trên cùng khi cuộn) */}
          <div className="sticky top-0 z-20 bg-surface-alt border-b border-line dark:bg-[#1F1F23] dark:border-[#2E2E33]" />
          {days.map((day) => {
            const today = day.isSame(now, 'day');
            const count = new Set(shifts.filter((s) => day.isSame(s.startAt, 'day')).map((s) => s.userId?._id)).size;
            return (
              <div
                key={day.valueOf()}
                className={`sticky top-0 z-20 border-b border-l border-line px-2 py-2 dark:border-[#2E2E33] ${
                  today ? 'bg-navy-bg dark:bg-blue-950/40' : 'bg-surface-alt dark:bg-[#1F1F23]'
                }`}
              >
                <div className={`text-[12.5px] font-semibold ${today ? 'text-navy' : 'text-ink'}`}>
                  {day.format('dd')} {day.format('DD/MM')}
                  {today && <span className="ml-1.5 rounded-full bg-navy px-1.5 py-px text-[10.5px] font-medium text-white">Hôm nay</span>}
                </div>
                <div className="text-[11.5px] text-ink-3">{count ? `${count} người trực` : 'Chưa xếp ca'}</div>
              </div>
            );
          })}

          {/* Cột giờ */}
          <div className="relative">
            {HOURS.map((h) => (
              <div key={h} style={{ height: HOUR_PX }} className="pr-2 text-right text-[11px] text-ink-3 tabular-nums -translate-y-2">
                {h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
              </div>
            ))}
          </div>

          {/* 7 cột ngày */}
          {days.map((day) => {
            const past = day.isBefore(now, 'day');
            const droppable = dnd.canDropOn(day);
            const over = droppable && dnd.overDay?.isSame(day, 'day');
            return (
              <div
                key={day.valueOf()}
                role="presentation"
                className={`relative border-l border-line dark:border-[#2E2E33] ${past ? 'bg-black/[0.015] dark:bg-white/[0.02]' : ''} ${
                  over ? 'bg-navy-bg/70 outline-2 outline-dashed outline-navy -outline-offset-2' : ''
                } ${isManager && !past ? 'cursor-copy' : ''}`}
                title={isManager && past ? 'Ngày đã qua: chỉ xem, không xếp ca' : undefined}
                style={{
                  height: 24 * HOUR_PX,
                  backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, var(--color-line) ${HOUR_PX - 1}px, var(--color-line) ${HOUR_PX}px)`,
                }}
                onClick={(e) => {
                  if (!isManager || past) return;
                  const hour = Math.floor((e.clientY - e.currentTarget.getBoundingClientRect().top) / HOUR_PX);
                  if (!day.hour(hour + 1).minute(0).isAfter(now)) return; // giờ đã qua: không xếp ca
                  onCreate(day.hour(hour).minute(0));
                }}
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
              >
                {day.isSame(now, 'day') && (
                  <div className="absolute inset-x-0 z-10 pointer-events-none" style={{ top: (nowMin / 60) * HOUR_PX }}>
                    <div className="relative h-0.5 bg-red-500">
                      <span className="absolute -left-1 -top-[3px] w-2 h-2 rounded-full bg-red-500" />
                    </div>
                  </div>
                )}
                {segmentsForDay(shifts, day).map((seg) => {
                  const s = seg.shift;
                  const kind = SHIFT_KINDS[shiftKind(s.startAt, dayjs)];
                  const height = Math.max(((seg.endMin - seg.startMin) / 60) * HOUR_PX - 2, 18);
                  const mine = s.userId?._id === userId;
                  const draggable = !seg.fromPrev && dnd.canDrag(s);
                  const ended = !now.isBefore(s.endAt);
                  const start = dayjs(s.startAt).format('HH:mm');
                  const end = dayjs(s.endAt).format('HH:mm');
                  return (
                    <Tooltip key={`${s._id}-${seg.startMin}`} title={<ShiftTip shift={s} />} mouseEnterDelay={0.3}>
                      <div
                        role="button"
                        tabIndex={0}
                        draggable={draggable}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', s._id);
                          dnd.setDragging(s);
                        }}
                        onDragEnd={() => {
                          dnd.setDragging(null);
                          dnd.setOverDay(null);
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(s);
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && onOpen(s)}
                        className={`absolute z-[5] overflow-hidden rounded-md border px-1.5 py-1 text-[11.5px] leading-tight shadow-sm ${kind.className} ${
                          seg.fromPrev ? 'rounded-t-none' : ''
                        } ${seg.toNext ? 'rounded-b-none' : ''} ${mine ? 'ring-2 ring-navy/50' : ''} ${
                          draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                        } ${dnd.dragging?._id === s._id ? 'opacity-40' : ''} ${ended ? 'opacity-55 saturate-50' : ''}`}
                        style={{
                          top: (seg.startMin / 60) * HOUR_PX + 1,
                          height,
                          left: `calc(${(seg.lane / seg.lanes) * 100}% + 2px)`,
                          width: `calc(${100 / seg.lanes}% - 4px)`,
                          // Mép nét đứt = ca còn tiếp ở ngày bên cạnh (qua đêm)
                          ...(seg.fromPrev && { borderTopStyle: 'dashed', borderTopWidth: 2 }),
                          ...(seg.toNext && { borderBottomStyle: 'dashed', borderBottomWidth: 2 }),
                        }}
                      >
                        {seg.fromPrev && <div className="text-[10.5px] opacity-75">↳ tiếp ca đêm</div>}
                        <div className="font-semibold tabular-nums truncate">
                          {seg.toNext || seg.fromPrev ? <MoonOutlined className="mr-1" /> : null}
                          {start} – {end}
                          {seg.toNext ? ' (+1)' : ''}
                        </div>
                        {height > 34 && <div className="truncate">{s.userId?.fullName ?? '—'}</div>}
                        {height > 52 && s.note && <div className="truncate opacity-75">{s.note}</div>}
                        {seg.toNext && height > 52 && <div className="absolute bottom-0.5 left-1.5 text-[10.5px] opacity-75">↓ sang hôm sau</div>}
                      </div>
                    </Tooltip>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

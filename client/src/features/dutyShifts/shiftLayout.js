// Bố trí ca trực trên lịch (logic thuần, test không cần DOM). Thời gian là dayjs, truyền `dayjs` vào để không phụ thuộc locale.
//
// Quy ước hiển thị:
//  - Ca thuộc về NGÀY BẮT ĐẦU (lịch tháng chỉ liệt kê ca ở ngày bắt đầu).
//  - Ca qua đêm (vd 22:00 → 06:00) ở lịch tuần được cắt làm 2 đoạn: 22:00–24:00 ở ngày bắt đầu và 00:00–06:00 ở ngày
//    hôm sau (đoạn "tiếp"). Ca kết thúc đúng 00:00 hôm sau KHÔNG tính là qua đêm.
//  - Ca là khoảng nửa mở [startAt, endAt), giống server: 06:00–14:00 và 14:00–22:00 nối tiếp, không chồng nhau.

export const DAY_MIN = 24 * 60;

// Loại ca theo giờ bắt đầu — để tô màu và chú thích
export const SHIFT_KINDS = {
  MORNING: { label: 'Ca sáng', hint: 'bắt đầu 05:00–11:59', className: 'bg-amber-50 border-amber-300 text-amber-900', dot: 'bg-amber-400' },
  AFTERNOON: { label: 'Ca chiều', hint: 'bắt đầu 12:00–17:59', className: 'bg-sky-50 border-sky-300 text-sky-900', dot: 'bg-sky-500' },
  NIGHT: { label: 'Ca tối / đêm', hint: 'bắt đầu 18:00–04:59', className: 'bg-indigo-50 border-indigo-300 text-indigo-900', dot: 'bg-indigo-500' },
};

export function shiftKind(startAt, dayjs) {
  const h = dayjs(startAt).hour();
  if (h >= 5 && h < 12) return 'MORNING';
  if (h >= 12 && h < 18) return 'AFTERNOON';
  return 'NIGHT';
}

/** Ca kéo sang ngày hôm sau (kết thúc đúng 00:00 thì không tính) */
export function isOvernight(shift, dayjs) {
  const start = dayjs(shift.startAt);
  const end = dayjs(shift.endAt);
  return end.isAfter(start.endOf('day')) && !end.isSame(end.startOf('day'));
}

const hhmm = (d) => d.format('HH:mm');

/** "22:00 → 06:00 (+1)" cho ca qua đêm, "06:00 – 14:00" cho ca trong ngày */
export function shiftLabel(shift, dayjs) {
  const start = dayjs(shift.startAt);
  const end = dayjs(shift.endAt);
  return isOvernight(shift, dayjs) ? `${hhmm(start)} → ${hhmm(end)} (+1)` : `${hhmm(start)} – ${end.isSame(end.startOf('day')) ? '24:00' : hhmm(end)}`;
}

/** Trạng thái ca so với `now` (dayjs): đã kết thúc (chỉ xem) / đang diễn ra / sắp tới */
export function shiftState(shift, now) {
  if (!now.isBefore(shift.endAt)) return { key: 'ENDED', label: 'Đã kết thúc', color: 'default' };
  if (!now.isBefore(shift.startAt)) return { key: 'RUNNING', label: 'Đang diễn ra', color: 'green' };
  return { key: 'UPCOMING', label: 'Sắp tới', color: 'blue' };
}

/** Ca bắt đầu trong ngày `day`, sắp theo giờ bắt đầu (lịch tháng) */
export function shiftsStartingOn(shifts, day) {
  return shifts.filter((s) => day.isSame(s.startAt, 'day')).sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
}

/**
 * Các đoạn ca nằm trong ngày `day` (lịch tuần): { shift, startMin, endMin, fromPrev, toNext, lane, lanes }.
 * fromPrev: đoạn tiếp của ca bắt đầu từ hôm trước; toNext: ca còn kéo sang hôm sau.
 * lane / lanes: các đoạn chồng giờ nhau xếp thành cột cạnh nhau (1 ca nhiều người trực).
 */
export function segmentsForDay(shifts, day) {
  const dayStart = day.startOf('day');
  const dayEnd = dayStart.add(1, 'day');
  const segments = shifts
    .map((shift) => {
      const s = new Date(shift.startAt) > dayStart.toDate() ? new Date(shift.startAt) : dayStart.toDate();
      const e = new Date(shift.endAt) < dayEnd.toDate() ? new Date(shift.endAt) : dayEnd.toDate();
      if (e <= s) return null;
      return {
        shift,
        startMin: Math.round((s - dayStart.toDate()) / 60000),
        endMin: Math.round((e - dayStart.toDate()) / 60000),
        fromPrev: new Date(shift.startAt) < dayStart.toDate(),
        toNext: new Date(shift.endAt) > dayEnd.toDate(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  // Xếp cột: đoạn đặt vào cột đầu tiên đã trống; số cột của một đoạn = số cột lớn nhất trong nhóm chồng nhau
  const laneEnds = [];
  for (const seg of segments) {
    let lane = laneEnds.findIndex((end) => end <= seg.startMin);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = seg.endMin;
    seg.lane = lane;
  }
  for (const seg of segments) {
    const overlapping = segments.filter((o) => o.startMin < seg.endMin && seg.startMin < o.endMin);
    seg.lanes = Math.max(...overlapping.map((o) => o.lane)) + 1;
  }
  return segments;
}

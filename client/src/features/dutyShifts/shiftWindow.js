// Tính khung giờ ca trực (logic thuần để test không cần DOM). Dùng dayjs.

/** Ngày + [giờ bắt đầu, giờ kết thúc]; giờ kết thúc ≤ giờ bắt đầu = ca qua đêm, kết thúc vào ngày hôm sau (vd 22:00 – 06:00) */
export function toWindow(date, [from, to]) {
  const startAt = date.hour(from.hour()).minute(from.minute()).second(0).millisecond(0);
  let endAt = date.hour(to.hour()).minute(to.minute()).second(0).millisecond(0);
  if (!endAt.isAfter(startAt)) endAt = endAt.add(1, 'day');
  return { startAt: startAt.toISOString(), endAt: endAt.toISOString() };
}

/** Kéo thả ca sang ngày `day`: giữ nguyên giờ bắt đầu và độ dài ca */
export function moveToDay(shift, day, dayjs) {
  const start = dayjs(shift.startAt);
  const duration = dayjs(shift.endAt).diff(start);
  const startAt = day.hour(start.hour()).minute(start.minute()).second(0).millisecond(0);
  return { startAt: startAt.toISOString(), endAt: startAt.add(duration, 'ms').toISOString() };
}

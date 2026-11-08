export const unknownOccupancy = { label: 'Cần đối chiếu ngày bàn giao', color: '#f8fafc' };

const handoverFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function handoverDay(value) {
  return value ? handoverFormatter.format(new Date(value)) : '';
}

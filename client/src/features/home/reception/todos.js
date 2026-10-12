import dayjs from 'dayjs';
import { VEHICLE_TYPES } from '../../../constants/enums';

// Lễ tân không xem hợp đồng nên không có nguồn hợp đồng.
// Gom việc đang chờ từ nhiều nguồn thành một danh sách "Cần xử lý", sắp theo mức gấp:
// 0 = quá hạn, 1 = diễn ra hôm nay, 2 = còn lại (theo thời gian tạo, cũ trước).
const DAY_MS = 24 * 3600 * 1000;
const BOOKING_LEAD_MS = 60 * 60 * 1000; // booking hiện trong danh sách từ 60 phút trước giờ mở check-in

export const TODO_KINDS = {
  ticket: { label: 'Phản ánh', bg: '#FCEBEB', fg: '#A32D2D' },
  booking: { label: 'Đặt tiện ích', bg: '#E7EEF8', fg: '#1F4F8F' },
  vehicle: { label: 'Gửi xe', bg: '#EEEAF6', fg: '#4B3A86' },
};

const dm = (d) => dayjs(d).format('DD/MM');
const aptCode = (a) => a?.code ?? '—';

export function buildTodos(snapshot) {
  const { parts, fetchedAt: now } = snapshot;
  const items = [];

  if (parts.tickets.status === 'ok') {
    for (const t of parts.tickets.data) {
      const late = now - Date.parse(t.createdAt) > DAY_MS;
      items.push({
        key: `ticket:${t._id}`,
        kind: 'ticket',
        title: `${t.title} · ${aptCode(t.apartmentId)}`,
        sub: `Gửi ${dm(t.createdAt)} · ${late ? 'quá 24 giờ chưa phân công' : 'chưa phân công'}`,
        rank: late ? 0 : 2,
        time: Date.parse(t.createdAt),
        raw: t,
      });
    }
  }

  if (parts.bookings.status === 'ok') {
    for (const b of parts.bookings.data.bookings) {
      if (b.status !== 'APPROVED') continue;
      const opens = Date.parse(b.checkIn.opensAt);
      const closes = Date.parse(b.checkIn.closesAt);
      if (now < opens - BOOKING_LEAD_MS) continue;
      const expired = now > closes;
      items.push({
        key: `booking:${b._id}`,
        kind: 'booking',
        title: `${b.amenity?.name ?? 'Tiện ích'} · hôm nay, ${b.slotStart}–${b.slotEnd}`,
        sub: `Căn ${aptCode(b.apartment)} · ${b.bookedBy?.fullName ?? '—'}${expired ? ' · quá hạn check-in' : ''}`,
        rank: expired ? 0 : 1,
        time: Date.parse(b.startAt),
        raw: b,
      });
    }
  }

  if (parts.vehicles.status === 'ok') {
    for (const v of parts.vehicles.data) {
      items.push({
        key: `vehicle:${v._id}`,
        kind: 'vehicle',
        title: `Đăng ký ${(VEHICLE_TYPES[v.type]?.label ?? 'xe').toLowerCase()}${v.plateNumber ? ` ${v.plateNumber}` : ''}`,
        sub: `Căn ${aptCode(v.apartmentId)} · ${v.registeredBy?.fullName ?? '—'}`,
        rank: 2,
        time: Date.parse(v.createdAt),
        raw: v,
      });
    }
  }

  return items.sort((a, b) => a.rank - b.rank || a.time - b.time);
}

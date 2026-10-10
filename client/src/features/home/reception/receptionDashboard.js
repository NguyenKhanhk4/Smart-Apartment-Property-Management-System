import { useEffect, useSyncExternalStore } from 'react';
import dayjs from 'dayjs';
import { vehicleApi } from '../../../api/moduleA.api';
import { bookingApi } from '../../../api/moduleD.api';
import { guestApi, ticketApi } from '../../../api/moduleE.api';

// Dữ liệu trang chủ Lễ tân + badge ở sidebar dùng CHUNG một kho: layout tải và làm mới mỗi phút,
// trang chủ chỉ đọc; thao tác Duyệt / Check-in... gọi refreshReceptionDashboard() để mọi số đếm cập nhật cùng lúc.
const POLL_MS = 60 * 1000;
const LIST_LIMIT = 20;
const DAY_MS = 24 * 3600 * 1000;

const PARTS = {
  guestsAll: (today) => guestApi.list({ date: today, limit: 1 }),
  guestsExpected: (today) => guestApi.list({ date: today, status: 'EXPECTED', limit: LIST_LIMIT, sort: 'expectedTime' }),
  tickets: () => ticketApi.list({ status: 'NEW', limit: LIST_LIMIT, sort: 'createdAt' }),
  vehicles: () => vehicleApi.list({ status: 'PENDING', limit: LIST_LIMIT, sort: 'createdAt' }),
  bookings: (today) => bookingApi.schedule({ date: today }),
};

const initial = () => ({
  fetchedAt: 0,
  parts: Object.fromEntries(Object.keys(PARTS).map((k) => [k, { status: 'loading', data: null, pagination: null, error: null }])),
});

let snapshot = initial();
let inFlight = null;
const listeners = new Set();
const emit = (next) => {
  snapshot = next;
  listeners.forEach((l) => l());
};

/** Tải lại toàn bộ; mỗi khối độc lập (khối lỗi không kéo theo khối khác). Gọi chồng thì dùng chung lần đang chạy */
export function refreshReceptionDashboard() {
  if (inFlight) return inFlight;
  const today = dayjs().format('YYYY-MM-DD');
  inFlight = Promise.all(
    Object.entries(PARTS).map(async ([name, load]) => {
      try {
        const res = await load(today);
        return [name, { status: 'ok', data: res.data, pagination: res.pagination ?? null, error: null }];
      } catch (error) {
        return [name, { status: 'error', data: snapshot.parts[name].data, pagination: null, error }];
      }
    }),
  )
    .then((entries) => emit({ fetchedAt: Date.now(), parts: Object.fromEntries(entries) }))
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useReceptionDashboard = () => useSyncExternalStore(subscribe, () => snapshot);

/** Chỉ Layout gọi: tải lần đầu rồi làm mới mỗi phút / khi cửa sổ được focus. Rời khỏi vai trò lễ tân thì xóa kho */
export function useReceptionPolling(enabled) {
  useEffect(() => {
    if (!enabled) return undefined;
    refreshReceptionDashboard();
    const timer = setInterval(() => !document.hidden && refreshReceptionDashboard(), POLL_MS);
    const onFocus = () => refreshReceptionDashboard();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      snapshot = initial();
    };
  }, [enabled]);
}

const okPart = (p) => (p.status === 'ok' ? p : null);

/** Số đếm dùng cho thẻ số liệu và badge sidebar; null = khối đó chưa tải được */
export function selectCounts(s) {
  const { guestsAll, guestsExpected, tickets, vehicles, bookings } = s.parts;
  const bookingList = okPart(bookings)?.data?.bookings;
  const ticketList = okPart(tickets)?.data;
  return {
    guestsToday: okPart(guestsAll)?.pagination?.total ?? null,
    guestsPending: okPart(guestsExpected)?.pagination?.total ?? null,
    bookingsTotal: bookingList ? bookingList.filter((b) => b.status !== 'CANCELLED').length : null,
    bookingsWaiting: bookingList ? bookingList.filter((b) => b.status === 'APPROVED').length : null,
    ticketsNew: okPart(tickets)?.pagination?.total ?? null,
    ticketsOver24: ticketList ? ticketList.filter((t) => s.fetchedAt - Date.parse(t.createdAt) > DAY_MS).length : null,
    vehiclesPending: okPart(vehicles)?.pagination?.total ?? null,
  };
}

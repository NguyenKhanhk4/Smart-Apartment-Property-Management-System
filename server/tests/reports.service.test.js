import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { connectTestDB, clearTestDB, closeTestDB } from './helpers/db.js';
import { createApartment, createBuilding, createHousehold, createManager, createTechnician, createTicket, createUser, tokenFor } from './helpers/fixtures.js';
import { createApp } from '../src/app.js';
import * as reports from '../src/modules/reports/reports.service.js';
import { Amenity, Booking, FundTransaction, Invoice, MaintenanceFund, Payment } from '../src/models/index.js';
import { HOUR_MS } from '../src/utils/time.js';

const item = (feeCategory, amount) => ({ feeCategory, description: feeCategory, quantity: 1, unitPrice: amount, amount });
let n = 0;
async function invoice(apartment, period, status, items, extra = {}) {
  n += 1;
  return Invoice.create({
    code: `HD-${period.replace('-', '')}-${apartment.code}-${n}`,
    apartmentId: apartment._id,
    buildingId: apartment.buildingId,
    period,
    items,
    totalAmount: items.reduce((s, i) => s + i.amount, 0),
    status,
    issuedAt: new Date(`${period}-01T00:00:00Z`),
    dueDate: new Date(`${period}-15T00:00:00Z`),
    ...extra,
  });
}

describe('reports.service', () => {
  beforeAll(connectTestDB, 120000);
  afterEach(clearTestDB);
  afterAll(closeTestDB);

  describe('dateRange', () => {
    it('from > to → VALIDATION_ERROR; khoảng quá dài → VALIDATION_ERROR', () => {
      expect(() => reports.dateRange(new Date('2026-02-01'), new Date('2026-01-01'))).toThrow(expect.objectContaining({ errorCode: 'VALIDATION_ERROR' }));
      expect(() => reports.dateRange(new Date('2000-01-01'), new Date('2026-01-01'))).toThrow(expect.objectContaining({ errorCode: 'VALIDATION_ERROR' }));
      const { start, end } = reports.dateRange(new Date('2026-03-10T10:00:00Z'), new Date('2026-03-10T10:00:00Z'));
      expect(start.toISOString()).toBe('2026-03-09T17:00:00.000Z'); // 00:00 VN
      expect(end.toISOString()).toBe('2026-03-10T16:59:59.999Z'); // 23:59:59.999 VN
    });
  });

  describe('billingSummary (UC-E10)', () => {
    it('loại CANCELLED khỏi phải thu, tỷ lệ thu, đủ tháng, theo loại phí/tòa/phương thức', async () => {
      const b1 = await createBuilding();
      const b2 = await createBuilding();
      const a1 = await createApartment(b1);
      const a2 = await createApartment(b2);
      const paid = await invoice(a1, '2026-01', 'PAID', [item('CLEANING', 100), item('PARKING', 50)], { paidAt: new Date() });
      await invoice(a1, '2026-02', 'UNPAID', [item('CLEANING', 100)]);
      await invoice(a2, '2026-02', 'OVERDUE', [item('CLEANING', 200)]);
      await invoice(a2, '2026-03', 'CANCELLED', [item('CLEANING', 999)]);
      await Payment.create({ invoiceId: paid._id, method: 'VNPAY', amount: 150, status: 'SUCCESS' });
      await Payment.create({ invoiceId: paid._id, method: 'CASH', amount: 150, status: 'FAILED' });

      const r = await reports.billingSummary({ from: '2026-01', to: '2026-04' });
      expect(r.overview).toMatchObject({ issued: 4, paid: 1, unpaid: 1, overdue: 1, cancelled: 1, billed: 450, collected: 150, outstanding: 300, overdueAmount: 200 });
      expect(r.overview.collectionRate).toBeCloseTo(150 / 450, 4);
      expect(r.byMonth.map((m) => m.period)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
      expect(r.byMonth[2]).toMatchObject({ billed: 0, invoiceCount: 0 });
      expect(r.byMonth[0]).toMatchObject({ billed: 150, collected: 150, collectionRate: 1 });
      expect(r.byFeeCategory.find((x) => x.feeCategory === 'PARKING')).toMatchObject({ billed: 50, collected: 50 });
      expect(r.byFeeCategory.find((x) => x.feeCategory === 'CLEANING')).toMatchObject({ billed: 400, collected: 100, outstanding: 300 });
      expect(r.byBuilding.find((x) => String(x.buildingId) === String(b2._id))).toMatchObject({ billed: 200, outstanding: 200, buildingName: b2.name });
      expect(r.byMethod).toEqual([{ method: 'VNPAY', count: 1, amount: 150 }]);

      const parking = await reports.billingSummary({ from: '2026-01', to: '2026-04', feeCategory: 'PARKING' });
      expect(parking.overview).toMatchObject({ billed: 50, collected: 50 });
      const onlyB2 = await reports.billingSummary({ from: '2026-01', to: '2026-04', buildingId: String(b2._id) });
      expect(onlyB2.overview).toMatchObject({ billed: 200, issued: 2 });
      expect(onlyB2.byMethod).toEqual([]);
    });

    it('from > to hoặc quá 60 tháng → VALIDATION_ERROR', async () => {
      await expect(reports.billingSummary({ from: '2026-05', to: '2026-01' })).rejects.toMatchObject({ errorCode: 'VALIDATION_ERROR' });
      await expect(reports.billingSummary({ from: '2000-01', to: '2026-01' })).rejects.toMatchObject({ errorCode: 'VALIDATION_ERROR' });
    });
  });

  describe('debtReport', () => {
    it('gom hóa đơn OVERDUE theo căn, sắp theo nợ giảm dần', async () => {
      const a1 = await createApartment();
      const a2 = await createApartment();
      await invoice(a1, '2026-01', 'OVERDUE', [item('CLEANING', 100)]);
      await invoice(a1, '2026-02', 'OVERDUE', [item('CLEANING', 100)]);
      await invoice(a2, '2026-02', 'OVERDUE', [item('CLEANING', 500)]);
      await invoice(a2, '2026-03', 'UNPAID', [item('CLEANING', 500)]);
      const r = await reports.debtReport({});
      expect(r.totalApartments).toBe(2);
      expect(r.totalOutstanding).toBe(700);
      expect(r.unassigned).toBe(2);
      expect(r.items[0]).toMatchObject({ apartmentCode: a2.code, outstanding: 500, invoiceCount: 1 });
      expect(r.items[1].periods).toEqual(['2026-01', '2026-02']);
    });
  });

  describe('fundDashboard (UC-E11)', () => {
    it('nhóm theo tháng giờ VN, tổng thu/chi trong kỳ, số dư hiện tại', async () => {
      const fund = await MaintenanceFund.create({ balance: 1000 });
      // 00:30 VN ngày 01/02 = 17:30Z 31/01 → thuộc tháng 02
      await FundTransaction.create({ fundId: fund._id, type: 'INCOME', amount: 300, occurredAt: new Date('2026-01-31T17:30:00Z') });
      await FundTransaction.create({ fundId: fund._id, type: 'EXPENSE', amount: 100, occurredAt: new Date('2026-01-10T03:00:00Z') });
      await FundTransaction.create({ fundId: fund._id, type: 'INCOME', amount: 50, occurredAt: new Date('2025-12-01T03:00:00Z') });

      const r = await reports.fundDashboard({ from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-02-28T00:00:00Z') });
      expect(r.balance).toBe(1000);
      expect(r).toMatchObject({ totalIncome: 300, totalExpense: 100, transactionCount: 2 });
      expect(r.monthly).toEqual([
        { period: '2026-01', income: 0, expense: 100 },
        { period: '2026-02', income: 300, expense: 0 },
      ]);
    });
  });

  describe('ticketReport / occupancyReport / maintenanceReport (UC-E12)', () => {
    it('đếm theo trạng thái, quá hạn, thời gian xử lý, đánh giá KTV; không tính "đúng hạn" khi thiếu resolvedAt', async () => {
      const h = await createHousehold();
      const tech = await createTechnician();
      const now = Date.now();
      const base = { apartment: h.apartment, createdBy: h.user, assignedTo: tech._id };
      await createTicket({ ...base, status: 'CLOSED', dueDate: new Date(now + HOUR_MS), resolvedAt: new Date(now), closedAt: new Date(now), rating: 4 });
      await createTicket({ ...base, status: 'CLOSED', dueDate: new Date(now - 10 * HOUR_MS), resolvedAt: new Date(now), closedAt: new Date(now), rating: 2 });
      // Đóng không có resolvedAt (dữ liệu cũ) → không được tính là đúng hạn
      await createTicket({ ...base, status: 'CLOSED', dueDate: new Date(now + HOUR_MS), closedAt: new Date(now) });
      await createTicket({ ...base, status: 'IN_PROGRESS', dueDate: new Date(now - HOUR_MS) });
      await createTicket({ apartment: h.apartment, createdBy: h.user, status: 'NEW' });

      const r = await reports.ticketReport({ from: new Date(now - 24 * HOUR_MS), to: new Date(now) });
      expect(r).toMatchObject({ total: 5, open: 2, closed: 3, overdue: 1, ratedCount: 2, avgRating: 3 });
      expect(r.onTimeRate).toBeCloseTo(1 / 3, 4);
      expect(r.technicians[0]).toMatchObject({ userId: tech._id, assigned: 4, closed: 3, avgRating: 3, fullName: tech.fullName });
      expect(r.technicians[0].email).toBeUndefined();
    });

    it('occupancy: (OWNED+RENTED)/tổng theo tòa', async () => {
      const b = await createBuilding();
      await createApartment(b, { status: 'OWNED' });
      await createApartment(b, { status: 'RENTED' });
      await createApartment(b, { status: 'VACANT' });
      await createApartment(b, { status: 'VACANT' });
      const r = await reports.occupancyReport({});
      expect(r).toMatchObject({ total: 4, owned: 1, rented: 1, vacant: 2, occupancyRate: 0.5 });
      expect(r.byBuilding[0]).toMatchObject({ buildingName: b.name, occupancyRate: 0.5 });
    });

    it('maintenance: không có dữ liệu → 0/rỗng', async () => {
      const r = await reports.maintenanceReport({ from: new Date('2026-01-01'), to: new Date('2026-02-01') });
      expect(r).toMatchObject({ total: 0, done: 0, onTime: 0, late: 0, onTimeRate: 0, upcomingAssets: [] });
    });
  });

  describe('amenityUsage (UC-E14)', () => {
    it('doanh thu chỉ tính COMPLETED (BR-O5), tỷ lệ hủy/từ chối, khung giờ cao điểm, amenityId sai → NOT_FOUND', async () => {
      const amenity = await Amenity.create({ name: 'Hồ bơi', openTime: '06:00', closeTime: '21:00', slotDurationMinutes: 60, capacityPerSlot: 2, feePerBooking: 50 });
      const a1 = await createApartment();
      const date = new Date('2026-03-10T00:00:00Z');
      const mk = (status, slotStart = '08:00') =>
        Booking.create({ amenityId: amenity._id, apartmentId: a1._id, date, slotStart, slotEnd: '09:00', fee: 50, status });
      await mk('COMPLETED');
      await mk('COMPLETED');
      await mk('APPROVED', '10:00');
      await mk('CANCELLED');
      await mk('REJECTED');
      await mk('PENDING');

      const r = await reports.amenityUsage({ from: new Date('2026-03-01'), to: new Date('2026-03-31') });
      expect(r).toMatchObject({ total: 6, completed: 2, cancelled: 1, rejected: 1, revenue: 100, peakSlot: '08:00' });
      expect(r.cancelRate).toBeCloseTo(1 / 6, 4);
      expect(r.byAmenity[0]).toMatchObject({ name: 'Hồ bơi', completed: 2, approved: 1, pending: 1, revenue: 100 });
      const slot8 = r.bySlot.find((s) => s.slotStart === '08:00');
      expect(slot8).toMatchObject({ bookings: 2, avgFillRate: 1 });
      expect(r.topApartments[0]).toMatchObject({ apartmentCode: a1.code, bookings: 3 });

      await expect(reports.amenityUsage({ from: date, to: date, amenityId: String(a1._id) })).rejects.toMatchObject({ errorCode: 'NOT_FOUND' });
    });
  });

  describe('routes — phân quyền & export', () => {
    const app = createApp();
    const call = (user) => (url) => request(app).get(url).set('Authorization', `Bearer ${tokenFor(user)}`);

    it('BR-R3/RBAC: ADMIN và cư dân không xem báo cáo; BOARD xem thu phí/quỹ nhưng không xem vận hành', async () => {
      const admin = await createUser('ADMIN');
      const resident = await createUser('RESIDENT');
      const board = await createUser('BOARD', { boardTitle: 'MEMBER' });
      const accountant = await createUser('ACCOUNTANT');
      for (const u of [admin, resident]) {
        for (const url of ['/api/reports/billing-summary', '/api/reports/fund', '/api/reports/tickets', '/api/reports/export?type=debts&format=xlsx']) {
          expect((await call(u)(url)).status, `${u.role} ${url}`).toBe(403);
        }
      }
      expect((await call(board)('/api/reports/billing-summary')).status).toBe(200);
      expect((await call(board)('/api/reports/fund')).status).toBe(200);
      expect((await call(board)('/api/reports/tickets')).status).toBe(403);
      expect((await call(board)('/api/reports/export?type=debts&format=xlsx')).status).toBe(403);
      expect((await call(accountant)('/api/reports/fund')).status).toBe(403);
      expect((await call(accountant)('/api/reports/amenity-usage')).status).toBe(200);
    });

    it('export: type/format sai → 400; xlsx/pdf trả file với Content-Disposition an toàn', async () => {
      const manager = await createManager();
      expect((await call(manager)('/api/reports/export?type=users&format=xlsx')).status).toBe(400);
      expect((await call(manager)('/api/reports/export?type=billing&format=csv')).status).toBe(400);
      expect((await call(manager)('/api/reports/export?type=billing&format=xlsx&from=2026-05&to=2026-01')).status).toBe(400);

      const xlsx = await call(manager)('/api/reports/export?type=debts&format=xlsx');
      expect(xlsx.status).toBe(200);
      expect(xlsx.headers['content-type']).toContain('spreadsheetml');
      expect(xlsx.headers['content-disposition']).toMatch(/^attachment; filename="bao-cao-debts-\d{4}-\d{2}-\d{2}\.xlsx"$/);

      const pdf = await call(manager)('/api/reports/export?type=operations&format=pdf&from=2026-01-01&to=2026-01-31');
      expect(pdf.status).toBe(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
    });

    it('khoảng thời gian quá dài → 400 thay vì quét toàn bộ dữ liệu', async () => {
      const manager = await createManager();
      expect((await call(manager)('/api/reports/tickets?from=1990-01-01&to=2026-01-01')).status).toBe(400);
      expect((await call(manager)('/api/reports/billing-summary?from=1990-01&to=2026-01')).status).toBe(400);
    });
  });
});

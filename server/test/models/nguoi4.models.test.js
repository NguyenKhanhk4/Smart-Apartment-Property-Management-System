// Khuôn dữ liệu Người 4 (Sự cố & Tiện ích): lịch ca trực, phân loại phiếu, SLA, giữ chỗ booking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  BOOKING_STATUS,
  CONFIG_KEYS,
  CRON_JOBS,
  DEFAULT_CONFIGS,
  TICKET_SCOPES,
  TICKET_STATUS,
  TICKET_TYPES,
} from '../../src/constants/enums.js';
import { ERROR_CODES } from '../../src/constants/errorCodes.js';
import { Booking, DutyShift, Ticket } from '../../src/models/index.js';

const id = () => new mongoose.Types.ObjectId();

test('enum: phiếu có loại Sự cố / Phản ánh và phạm vi Khu vực chung / Trong căn hộ', () => {
  assert.deepEqual(Object.values(TICKET_TYPES), ['INCIDENT', 'COMPLAINT']);
  assert.deepEqual(Object.values(TICKET_SCOPES), ['COMMON_AREA', 'IN_APARTMENT']);
});

test('enum: ticket có thêm trạng thái chờ cư dân đồng ý phí và chờ linh kiện', () => {
  assert.equal(TICKET_STATUS.WAITING_QUOTE_APPROVAL, 'WAITING_QUOTE_APPROVAL');
  assert.equal(TICKET_STATUS.WAITING_PARTS, 'WAITING_PARTS');
});

test('enum: booking có trạng thái giữ chỗ chờ thanh toán', () => {
  assert.equal(BOOKING_STATUS.PENDING_PAYMENT, 'PENDING_PAYMENT');
});

test('cấu hình: có tham số SLA nhận phiếu, SLA phản hồi phản ánh và thời gian giữ chỗ (mặc định tắt)', () => {
  const byKey = Object.fromEntries(DEFAULT_CONFIGS.map((c) => [c.key, c]));
  assert.equal(byKey[CONFIG_KEYS.TICKET_ACK_MINUTES].value, 30);
  assert.equal(byKey[CONFIG_KEYS.COMPLAINT_RESPONSE_HOURS].value, 48);
  assert.equal(byKey[CONFIG_KEYS.BOOKING_PAYMENT_HOLD_MINUTES].value, 0);
});

test('cron: có job cảnh báo SLA và job hủy giữ chỗ quá hạn', () => {
  assert.equal(CRON_JOBS.TICKET_SLA_ALERT, 'TICKET_SLA_ALERT');
  assert.equal(CRON_JOBS.BOOKING_HOLD_EXPIRE, 'BOOKING_HOLD_EXPIRE');
});

test('mã lỗi: có mã cho nhận phiếu, ca trực và vé QR', () => {
  for (const code of ['TICKET_ALREADY_CLAIMED', 'NOT_ON_DUTY', 'DUTY_SHIFT_OVERLAP', 'BOOKING_QR_INVALID', 'BOOKING_HOLD_EXPIRED']) {
    assert.ok(ERROR_CODES[code], `thiếu mã lỗi ${code}`);
  }
});

test('DutyShift: ca hợp lệ của kỹ thuật viên', () => {
  const shift = new DutyShift({
    roleTitle: 'TECHNICIAN',
    userId: id(),
    startAt: new Date('2026-11-01T01:00:00Z'),
    endAt: new Date('2026-11-01T09:00:00Z'),
  });
  assert.equal(shift.validateSync(), undefined);
  assert.equal(shift.isBackup, false);
});

test('DutyShift: chỉ xếp ca cho Kỹ thuật viên hoặc Bảo vệ', () => {
  const shift = new DutyShift({ roleTitle: 'RECEPTIONIST', userId: id(), startAt: new Date(), endAt: new Date() });
  assert.ok(shift.validateSync()?.errors.roleTitle);
});

test('Ticket: dữ liệu cũ không có loại → mặc định Sự cố kỹ thuật, Khu vực chung', () => {
  const ticket = new Ticket({
    code: 'TK-202611-00001',
    apartmentId: id(),
    createdBy: id(),
    category: id(),
    title: 'Thang máy kẹt',
    description: 'Thang máy số 2 kẹt tầng 5',
    priority: 'HIGH',
  });
  assert.equal(ticket.validateSync(), undefined);
  assert.equal(ticket.type, TICKET_TYPES.INCIDENT);
  assert.equal(ticket.scope, TICKET_SCOPES.COMMON_AREA);
  assert.equal(ticket.ackDueAt, null);
  assert.equal(ticket.responseDueAt, null);
});

test('Ticket: nhận trạng thái mới WAITING_PARTS', () => {
  const ticket = new Ticket({
    code: 'TK-202611-00002',
    apartmentId: id(),
    createdBy: id(),
    category: id(),
    title: 'Hỏng bơm',
    description: 'Bơm nước tầng hầm kêu to',
    priority: 'MEDIUM',
    status: 'WAITING_PARTS',
  });
  assert.equal(ticket.validateSync(), undefined);
});

test('Booking: giữ chỗ chờ thanh toán có hạn giữ', () => {
  const booking = new Booking({
    amenityId: id(),
    apartmentId: id(),
    date: new Date(),
    slotStart: '18:00',
    slotEnd: '19:00',
    fee: 50000,
    status: 'PENDING_PAYMENT',
    holdExpiresAt: new Date(),
  });
  assert.equal(booking.validateSync(), undefined);
  assert.equal(booking.paidAt, null);
});

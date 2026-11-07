import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldLabel, formatAuditValue, ipLabel, statusOf, targetText } from '../src/features/auditLogs/auditFormat.js';

test('giá trị cũ / mới: trống, đúng sai, tiền, vai trò, mảng, object', () => {
  assert.equal(formatAuditValue('role', undefined), '—');
  assert.equal(formatAuditValue('roleTitle', null), '—');
  assert.equal(formatAuditValue('tenantPaysFees', false), 'Không');
  assert.equal(formatAuditValue('amount', 1500000), `${(1500000).toLocaleString('vi-VN')} đ`);
  assert.equal(formatAuditValue('floor', 12), '12');
  assert.equal(formatAuditValue('role', 'ACCOUNTANT'), 'Kế toán');
  assert.equal(formatAuditValue('roleTitle', 'TECHNICIAN'), 'Kỹ thuật viên');
  assert.equal(formatAuditValue('code', 'ACCOUNTANT'), 'ACCOUNTANT'); // chỉ dịch ở trường vai trò
  assert.equal(formatAuditValue('action', 'UPDATE'), 'Cập nhật');
  assert.equal(formatAuditValue('generatedBy', 'MANUAL'), 'Kế toán lập tay');
  assert.equal(formatAuditValue('period', '2026-11'), '11/2026');
  assert.equal(fieldLabel('created'), 'Số đã tạo');
  assert.notEqual(formatAuditValue('priority', 'URGENT'), 'URGENT');
  assert.equal(formatAuditValue('invoiceIds', ['HD-1', 'HD-2']), 'HD-1, HD-2');
  assert.equal(formatAuditValue('filters', { action: 'X' }), '{"action":"X"}');
  assert.match(formatAuditValue('endDate', '2026-11-07T10:05:00.000Z'), /^\d{2}:\d{2} \d{2}\/\d{2}\/2026$/);
});

test('trạng thái dịch theo loại đối tượng; khóa tài khoản hiện Đang hoạt động / Đã khóa', () => {
  assert.equal(formatAuditValue('status', 'IN_PROGRESS', 'tickets'), 'Đang xử lý');
  assert.equal(formatAuditValue('toStatus', 'CLOSED', 'tickets'), 'Đã nghiệm thu');
  assert.equal(statusOf('status', 'IN_PROGRESS', 'tickets').color, 'processing');
  assert.equal(formatAuditValue('status', 'IN_PROGRESS', 'không-rõ'), 'IN_PROGRESS'); // không biết đối tượng thì giữ mã
  assert.equal(formatAuditValue('isActive', true), 'Đang hoạt động');
  assert.equal(formatAuditValue('isActive', false), 'Đã khóa');
  assert.equal(statusOf('code', 'IN_PROGRESS', 'tickets'), null);
});

test('bản ghi: mã dễ đọc; thao tác hàng loạt theo kỳ → "Cả kỳ"; không có gì → null', () => {
  assert.equal(targetText({ targetId: 'abc', targetName: 'TK-202610-00005' }), 'TK-202610-00005');
  assert.equal(targetText({ targetId: null, metadata: { period: '2026-11', created: 6 } }), 'Cả kỳ 11/2026');
  assert.equal(targetText({ targetId: 'abc', targetName: null }), null);
});

test('trường type dịch theo đối tượng: loại căn, loại hợp đồng, loại phiếu', () => {
  assert.equal(formatAuditValue('type', 'RESIDENTIAL', 'apartments'), 'Căn để ở');
  assert.equal(formatAuditValue('type', 'COMMERCIAL', 'apartments'), 'Căn kinh doanh');
  assert.equal(formatAuditValue('type', 'LEASE', 'contracts'), 'Cho thuê');
  assert.equal(formatAuditValue('type', 'INCIDENT', 'tickets'), 'Sự cố kỹ thuật');
  assert.equal(formatAuditValue('type', 'RESIDENTIAL', 'tickets'), 'RESIDENTIAL');
});

test('cột IP: có IP thì hiện IP; hệ thống tự chạy → "Hệ thống"; người dùng nhưng thiếu IP → "Không ghi nhận"', () => {
  assert.equal(ipLabel({ ip: '10.0.0.1', performedBy: { fullName: 'A' } }), '10.0.0.1');
  assert.equal(ipLabel({ performedBy: null }), 'Hệ thống');
  assert.equal(ipLabel({ performedBy: { fullName: 'A' } }), 'Không ghi nhận');
});

test('nhãn trường: có nhãn thì dịch, chưa có thì giữ tên gốc', () => {
  assert.equal(fieldLabel('role'), 'Vai trò');
  assert.equal(fieldLabel('value'), 'Giá trị');
  assert.equal(fieldLabel('TICKET_AUTO_CLOSE_DAYS'), 'TICKET_AUTO_CLOSE_DAYS');
});

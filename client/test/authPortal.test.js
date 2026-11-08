// 2 cổng đăng nhập: cư dân (/login) và Ban quản lý (/staff/login)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { belongsToPortal, loginPathFor, portalPath } from '../src/features/auth/authPortal.js';

test('cư dân chỉ thuộc cổng cư dân; nhân viên, kế toán, BQL, Ban quản trị thuộc cổng quản lý', () => {
  assert.equal(belongsToPortal({ role: 'RESIDENT' }, 'resident'), true);
  assert.equal(belongsToPortal({ role: 'RESIDENT' }, 'staff'), false);
  for (const role of ['STAFF', 'ACCOUNTANT', 'MANAGER', 'BOARD']) {
    assert.equal(belongsToPortal({ role }, 'staff'), true, role);
    assert.equal(belongsToPortal({ role }, 'resident'), false, role);
  }
});

test('đường dẫn trang tài khoản theo cổng; chưa đăng nhập vào /app thì về cổng quản lý', () => {
  assert.equal(portalPath('resident', '/login'), '/login');
  assert.equal(portalPath('staff', '/activate'), '/staff/activate');
  assert.equal(loginPathFor('/app/tickets'), '/staff/login');
  assert.equal(loginPathFor('/r/home'), '/login');
  assert.equal(loginPathFor(), '/login');
});

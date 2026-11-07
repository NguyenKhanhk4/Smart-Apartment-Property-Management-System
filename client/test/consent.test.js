// BR-X7: chỉ cư dân chưa đồng ý mới bị khóa chức năng
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isConsentLocked } from '../src/utils/consent.js';

test('cư dân chưa đồng ý, từ chối hoặc đã rút lại thì bị khóa', () => {
  for (const consentStatus of [null, undefined, 'DECLINED', 'WITHDRAWN']) {
    assert.equal(isConsentLocked({ role: 'RESIDENT', consentStatus }), true, String(consentStatus));
  }
});

test('cư dân đã đồng ý, nhân viên, chưa đăng nhập thì không bị khóa', () => {
  assert.equal(isConsentLocked({ role: 'RESIDENT', consentStatus: 'ACCEPTED' }), false);
  assert.equal(isConsentLocked({ role: 'STAFF', consentStatus: null }), false);
  assert.equal(isConsentLocked({ role: 'MANAGER' }), false);
  assert.equal(isConsentLocked(null), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_KEYS } from '../../src/constants/enums.js';
import { CONFIG_DEFAULTS } from '../../src/services/systemConfig.service.js';

test('CONFIG_DEFAULTS: map key → giá trị mặc định dùng chung (không tự dựng lại ở module)', () => {
  assert.equal(CONFIG_DEFAULTS[CONFIG_KEYS.NO_SHOW_GRACE_MINUTES], 15);
  assert.ok(Object.isFrozen(CONFIG_DEFAULTS));
});

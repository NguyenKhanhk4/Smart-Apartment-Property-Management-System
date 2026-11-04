// Mỗi enum server có bản nhãn ở client phải đủ key, và các nhóm trạng thái dùng chung phải giống hệt nhau.
// Thêm status mới ở server mà quên nhãn client → test đỏ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../src/constants/enums.js';
import { ERROR_CODES } from '../../src/constants/errorCodes.js';
import * as C from '../../../client/src/constants/enums.js';
import { ERROR_MESSAGES } from '../../../client/src/constants/errorMessages.js';

// Enum server không cần nhãn ở client (nội bộ server, hoặc Module B/C chưa có giao diện)
const SERVER_ONLY = new Set([
  'CONFIG_KEYS', 'CONFIG_SCOPES', 'CRON_STATUS', 'CRON_TRIGGERS', 'AUDIT_ACTIONS', 'AUDIT_TARGETS',
  'PRIORITY_ORDER', 'DEFAULT_CONFIGS', 'GENERATED_BY', 'PAYMENT_STATUS', 'ADJUSTMENT_TYPES', 'REVIEW_STATUS',
  'DEBT_STATUS', 'CONTACT_METHODS', 'FUND_TX_TYPES', 'VOTE_DECISIONS', 'EXPENSE_CATEGORIES',
]);

const isEnumObject = (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string');

const mirrored = Object.entries(S).filter(([name, v]) => isEnumObject(v) && !SERVER_ONLY.has(name));

for (const [name, serverEnum] of mirrored) {
  test(`client có nhãn đầy đủ cho ${name}`, () => {
    assert.ok(C[name], `client/src/constants/enums.js thiếu ${name}`);
    assert.deepEqual(Object.keys(C[name]).sort(), Object.keys(serverEnum).sort());
    for (const [k, v] of Object.entries(C[name])) assert.ok(v.label, `${name}.${k} thiếu label`);
  });
}

for (const group of ['TICKET_OPEN_STATUSES', 'TICKET_FINAL_STATUSES', 'WORK_ORDER_OPEN_STATUSES', 'BOOKING_ACTIVE_STATUSES']) {
  test(`nhóm ${group} giống nhau ở server và client`, () => {
    assert.deepEqual(C[group], S[group]);
  });
}

test('client có thông báo dự phòng cho mọi mã lỗi server', () => {
  const missing = Object.keys(ERROR_CODES).filter((code) => !ERROR_MESSAGES[code]);
  assert.deepEqual(missing, []);
  const extra = Object.keys(ERROR_MESSAGES).filter((code) => !ERROR_CODES[code]);
  assert.deepEqual(extra, []);
});

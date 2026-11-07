import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedCount, grantedOf, groupFeatures, toggle } from '../src/features/permissions/permissionMatrix.js';

const cell = (available, granted, core = false) => ({ available, granted, core });
const feature = (code, group, actions) => ({ code, label: code, group, actions });
const matrix = {
  features: [
    feature('TICKETS', 'Vận hành', { VIEW: cell(true, true, true), UPDATE: cell(true, true), DELETE: cell(false, false) }),
    feature('ANNOUNCEMENTS', 'Vận hành', { VIEW: cell(true, false) }),
    feature('FUND', 'Tài chính', { VIEW: cell(true, true) }),
  ],
};

test('grantedOf lấy đúng các ô đang bật', () => {
  assert.deepEqual([...grantedOf(matrix)].sort(), ['FUND:VIEW', 'TICKETS:UPDATE', 'TICKETS:VIEW']);
  assert.equal(grantedOf(null).size, 0);
});

test('toggle: bật / tắt ô thường; ô lõi và ô ngoài phạm vi giữ nguyên', () => {
  const saved = grantedOf(matrix);
  const [tickets, announcements] = matrix.features;
  const off = toggle(saved, tickets, 'UPDATE');
  assert.ok(!off.has('TICKETS:UPDATE'));
  assert.ok(saved.has('TICKETS:UPDATE')); // không sửa bản gốc
  assert.equal(toggle(saved, tickets, 'VIEW'), saved); // lõi
  assert.equal(toggle(saved, tickets, 'DELETE'), saved); // ngoài phạm vi
  assert.ok(toggle(saved, announcements, 'VIEW').has('ANNOUNCEMENTS:VIEW'));
  assert.equal(changedCount(saved, off), 1);
  assert.equal(changedCount(saved, toggle(off, tickets, 'UPDATE')), 0);
});

test('groupFeatures giữ thứ tự nhóm và chức năng', () => {
  assert.deepEqual(groupFeatures(matrix.features).map((g) => [g.group, g.items.map((f) => f.code)]), [
    ['Vận hành', ['TICKETS', 'ANNOUNCEMENTS']],
    ['Tài chính', ['FUND']],
  ]);
});

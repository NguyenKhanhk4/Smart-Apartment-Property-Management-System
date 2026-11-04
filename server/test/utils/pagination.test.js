// getSort nhận cả chuỗi "-field" (từ query) lẫn object nhiều field (service tự sắp, vd ghim trước rồi mới nhất).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSort } from '../../src/utils/pagination.js';

test('getSort: chuỗi query', () => {
  assert.deepEqual(getSort('-createdAt'), { createdAt: -1 });
  assert.deepEqual(getSort('dueDate'), { dueDate: 1 });
  assert.deepEqual(getSort(), { createdAt: -1 });
});

test('getSort: object nhiều field giữ nguyên thứ tự', () => {
  assert.deepEqual(getSort({ isPinned: -1, createdAt: -1 }), { isPinned: -1, createdAt: -1 });
});

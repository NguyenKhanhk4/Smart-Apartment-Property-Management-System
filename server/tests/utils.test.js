import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import Joi from 'joi';
import { connectTestDB, clearTestDB, closeTestDB } from './helpers/db.js';
import { endOfVnDay, periodEnd, periodRange, periodStart, startOfVnDay, vnPeriod } from '../src/utils/time.js';
import { csvEnum, objectId, period } from '../src/utils/validators.js';
import { nextMonthlyCode, retryOnDuplicate } from '../src/utils/codeGenerator.js';
import { escapeRegex, getPagination, getSort, paginationQuery, sortable } from '../src/utils/pagination.js';
import { Ticket } from '../src/models/index.js';

describe('utils/time (giờ VN, UTC+7)', () => {
  it('startOfVnDay / endOfVnDay quanh mốc nửa đêm VN', () => {
    // 23:30 VN 10/03 = 16:30Z
    const lateNight = new Date('2026-03-10T16:30:00Z');
    expect(startOfVnDay(lateNight).toISOString()).toBe('2026-03-09T17:00:00.000Z');
    expect(endOfVnDay(lateNight).toISOString()).toBe('2026-03-10T16:59:59.999Z');
    // 00:30 VN 11/03 = 17:30Z 10/03
    const afterMidnight = new Date('2026-03-10T17:30:00Z');
    expect(startOfVnDay(afterMidnight).toISOString()).toBe('2026-03-10T17:00:00.000Z');
  });

  it('vnPeriod theo giờ VN, periodStart/periodEnd là cận [đầu tháng, đầu tháng sau)', () => {
    expect(vnPeriod(new Date('2026-01-31T17:30:00Z'))).toBe('2026-02');
    expect(vnPeriod(new Date('2026-01-31T16:30:00Z'))).toBe('2026-01');
    expect(periodStart('2026-02').toISOString()).toBe('2026-01-31T17:00:00.000Z');
    expect(periodEnd('2026-12').toISOString()).toBe('2026-12-31T17:00:00.000Z');
  });

  it('periodRange bao gồm 2 đầu, qua năm, from > to → rỗng', () => {
    expect(periodRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(periodRange('2026-03', '2026-03')).toEqual(['2026-03']);
    expect(periodRange('2026-03', '2026-01')).toEqual([]);
  });
});

describe('utils/validators', () => {
  const opts = { convert: true };
  it('csvEnum nhận "A,B", mảng, từ chối giá trị lạ', () => {
    const schema = Joi.object({ status: csvEnum(['NEW', 'CLOSED']) });
    expect(schema.validate({ status: 'NEW, CLOSED' }, opts).value.status).toEqual(['NEW', 'CLOSED']);
    expect(schema.validate({ status: ['CLOSED'] }, opts).value.status).toEqual(['CLOSED']);
    expect(schema.validate({ status: 'NEW,HACK' }, opts).error).toBeTruthy();
    expect(schema.validate({ status: ['HACK'] }, opts).error).toBeTruthy();
    expect(schema.validate({ status: { $ne: 'x' } }, opts).error).toBeTruthy();
  });

  it('objectId / period', () => {
    expect(objectId().validate('5f1d7f3e2c4b8a1234567890').error).toBeUndefined();
    expect(objectId().validate('not-an-id').error).toBeTruthy();
    expect(period().validate('2026-13').error).toBeTruthy();
    expect(period().validate('2026-09').error).toBeUndefined();
  });
});

describe('utils/pagination', () => {
  it('getPagination kẹp page/limit; getSort; escapeRegex', () => {
    expect(getPagination({ page: '0', limit: '1000' })).toEqual({ page: 1, limit: 100, skip: 0 });
    expect(getPagination({ page: '3', limit: '10' })).toEqual({ page: 3, limit: 10, skip: 20 });
    expect(getSort('-dueDate')).toEqual({ dueDate: -1 });
    expect(getSort('code')).toEqual({ code: 1 });
    expect(new RegExp(escapeRegex('a.b*c')).test('aXbc')).toBe(false);
    expect(new RegExp(escapeRegex('a.b*c')).test('a.b*c')).toBe(true);
  });

  it('sortable chỉ cho field whitelist, mặc định -createdAt', () => {
    const schema = Joi.object({ ...paginationQuery, sort: sortable('createdAt', 'dueDate') });
    expect(schema.validate({}).value.sort).toBe('-createdAt');
    expect(schema.validate({ sort: '-dueDate' }).error).toBeUndefined();
    expect(schema.validate({ sort: 'passwordHash' }).error).toBeTruthy();
    expect(Joi.object(paginationQuery).validate({ sort: 'dueDate' }).error).toBeTruthy();
  });
});

describe('utils/codeGenerator (cần DB)', () => {
  beforeAll(connectTestDB, 120000);
  afterEach(clearTestDB);
  afterAll(closeTestDB);

  const base = { apartmentId: '5f1d7f3e2c4b8a1234567890', createdBy: '5f1d7f3e2c4b8a1234567890', category: '5f1d7f3e2c4b8a1234567890', title: 't', description: 'd', priority: 'LOW' };

  it('nextMonthlyCode tăng dần theo tháng VN, không nhầm khi mã tháng khác tồn tại', async () => {
    const date = new Date('2026-03-10T03:00:00Z');
    expect(await nextMonthlyCode(Ticket, 'TK', { date })).toBe('TK-202603-00001');
    await Ticket.create({ ...base, code: 'TK-202603-00007' });
    await Ticket.create({ ...base, code: 'TK-202602-00099' });
    expect(await nextMonthlyCode(Ticket, 'TK', { date })).toBe('TK-202603-00008');
    expect(await nextMonthlyCode(Ticket, 'TK', { date: new Date('2026-03-31T17:30:00Z') })).toBe('TK-202604-00001');
  });

  it('retryOnDuplicate thử lại khi E11000, ném lỗi khác ngay', async () => {
    let calls = 0;
    const result = await retryOnDuplicate(async () => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error('dup'), { code: 11000 });
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    await expect(retryOnDuplicate(async () => { throw new Error('khác'); })).rejects.toThrow('khác');
    await expect(retryOnDuplicate(async () => { throw Object.assign(new Error('dup'), { code: 11000 }); }, 2)).rejects.toThrow('dup');
  });
});

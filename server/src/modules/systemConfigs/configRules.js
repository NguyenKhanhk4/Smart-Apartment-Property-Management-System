// Quy tắc giá trị hợp lệ khi sửa tham số hệ thống (UC-E01). Tách khỏi route để test được.
import { CONFIG_KEYS, ZERO_ALLOWED_CONFIG_KEYS } from '../../constants/enums.js';
import { ApiError } from '../../utils/ApiError.js';

// Tham số dạng tỷ lệ: 0 < value ≤ 1
const RATIO_KEYS = new Set([CONFIG_KEYS.FUND_APPROVAL_RATIO]);
const MAX_NUMBER = 1e12;
const MAX_ARRAY = 50;
const isNumberInRange = (n, min) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= MAX_NUMBER;
const isPositiveNumber = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= MAX_NUMBER;

/**
 * Giá trị mới phải cùng kiểu với giá trị đang lưu; số phải > 0 (vd slaHours ≤ 0 → VALIDATION_ERROR),
 * trừ tham số trong ZERO_ALLOWED_CONFIG_KEYS được đặt 0 = tắt tính năng.
 * Số ngày/giờ/số lượng phải là số nguyên; tỷ lệ ≤ 1; danh sách số không rỗng, không trùng.
 */
export function assertValidValue(key, current, next) {
  if (typeof current === 'number') {
    if (ZERO_ALLOWED_CONFIG_KEYS.includes(key)) {
      if (!isNumberInRange(next, 0)) throw ApiError.badRequest('Giá trị phải là số lớn hơn hoặc bằng 0 (0 = tắt)');
    } else if (!isPositiveNumber(next)) {
      throw ApiError.badRequest('Giá trị phải là số lớn hơn 0');
    }
    if (RATIO_KEYS.has(key)) {
      if (next > 1) throw ApiError.badRequest('Tỷ lệ phải nằm trong khoảng (0, 1]');
    } else if (!Number.isInteger(next)) {
      throw ApiError.badRequest('Giá trị phải là số nguyên');
    }
  } else if (Array.isArray(current)) {
    if (!Array.isArray(next) || !next.length || next.length > MAX_ARRAY) {
      throw ApiError.badRequest(`Giá trị phải là danh sách 1–${MAX_ARRAY} số lớn hơn 0`);
    }
    if (next.some((n) => !isPositiveNumber(n) || !Number.isInteger(n))) {
      throw ApiError.badRequest('Giá trị phải là danh sách số nguyên lớn hơn 0');
    }
    if (new Set(next).size !== next.length) throw ApiError.badRequest('Danh sách không được trùng giá trị');
  } else if (typeof current === 'boolean') {
    if (typeof next !== 'boolean') throw ApiError.badRequest('Giá trị phải là true/false');
  } else if (typeof next !== 'string' || !next.trim() || next.length > 500) {
    throw ApiError.badRequest('Giá trị phải là chuỗi 1–500 ký tự');
  }
}

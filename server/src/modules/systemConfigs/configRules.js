// Quy tắc giá trị hợp lệ khi sửa tham số hệ thống (UC-E01). Tách khỏi route để test được.
import { CONFIG_KEYS, ZERO_ALLOWED_CONFIG_KEYS } from '../../constants/enums.js';
import { ApiError } from '../../utils/ApiError.js';

// Tham số dạng tỷ lệ: 0 < value ≤ 1
const RATIO_KEYS = new Set([CONFIG_KEYS.FUND_APPROVAL_RATIO]);
// Tham số là ngày trong tháng: 1–28 để tháng nào cũng có ngày đó
const DAY_OF_MONTH_KEYS = new Set([CONFIG_KEYS.BILLING_REMIND_DAY]);
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
    if (DAY_OF_MONTH_KEYS.has(key) && next > 28) throw ApiError.badRequest('Ngày trong tháng phải từ 1 đến 28');
    if (key === CONFIG_KEYS.UPLOAD_MAX_SIZE_MB && next > 20) {
      throw ApiError.badRequest('Dung lượng ảnh tối đa không được vượt quá 20MB');
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

/**
 * Kiểm tra chéo giữa các cặp tham số (BR-X8):
 * - OWNER_CONFIRM_AUTO_CANCEL_DAYS > OWNER_CONFIRM_REMIND_DAYS
 * - QUOTE_AUTO_CLOSE_DAYS > QUOTE_REMIND_DAYS
 */
export function assertCrossValidation(key, next, currentValues) {
  const C = CONFIG_KEYS;
  if (key === C.OWNER_CONFIRM_AUTO_CANCEL_DAYS) {
    const remind = currentValues?.[C.OWNER_CONFIRM_REMIND_DAYS];
    if (remind != null && next <= remind) {
      throw ApiError.field('value', `Thời hạn tự hủy (${next} ngày) phải lớn hơn thời hạn nhắc (${remind} ngày)`);
    }
  }
  if (key === C.OWNER_CONFIRM_REMIND_DAYS) {
    const cancel = currentValues?.[C.OWNER_CONFIRM_AUTO_CANCEL_DAYS];
    if (cancel != null && next >= cancel) {
      throw ApiError.field('value', `Thời hạn nhắc (${next} ngày) phải nhỏ hơn thời hạn tự hủy (${cancel} ngày)`);
    }
  }
  if (key === C.QUOTE_AUTO_CLOSE_DAYS) {
    const remind = currentValues?.[C.QUOTE_REMIND_DAYS];
    if (remind != null && next <= remind) {
      throw ApiError.field('value', `Thời hạn tự đóng báo giá (${next} ngày) phải lớn hơn thời hạn nhắc (${remind} ngày)`);
    }
  }
  if (key === C.QUOTE_REMIND_DAYS) {
    const close = currentValues?.[C.QUOTE_AUTO_CLOSE_DAYS];
    if (close != null && next >= close) {
      throw ApiError.field('value', `Thời hạn nhắc báo giá (${next} ngày) phải nhỏ hơn thời hạn tự đóng (${close} ngày)`);
    }
  }
}

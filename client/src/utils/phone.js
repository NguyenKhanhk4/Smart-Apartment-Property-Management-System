// Rule Form cho SĐT, cùng định dạng với phoneVn ở server/src/utils/validators.js (BR-S01: SĐT là bắt buộc)
const PHONE_PATTERN = /^(?:\+?84|0)(?:[35789]\d{8}|2\d{9})$/;

export const PHONE_RULES = [
  { required: true, message: 'Vui lòng nhập số điện thoại' },
  { pattern: PHONE_PATTERN, message: 'Số điện thoại không hợp lệ' },
];

export const isValidPhone = (phone) => PHONE_PATTERN.test(phone ?? '');

/** Cùng cách chuẩn hóa với normalizePhone ở server: +84912345678, 84912345678 → 0912345678 */
export function normalizePhone(phone) {
  const value = String(phone ?? '').trim().replace(/^\+/, '');
  return value.startsWith('84') ? `0${value.slice(2)}` : value;
}

/**
 * Trạng thái kiểm tra tài khoản theo SĐT đang nhập. `blockReason` khác null thì chưa được lưu.
 * `account` chỉ có giá trị khi trả lời đúng cho số đang nhập (bỏ qua kết quả của số trước đó).
 */
export function phoneAccountState({ phone, account, error, loading, confirmedUserId }) {
  if (!isValidPhone(phone)) return { status: 'idle', isExisting: false, blockReason: null };
  const current = account?.phone === normalizePhone(phone) ? account : null;
  if (!current) {
    return error && !loading
      ? { status: 'error', isExisting: false, blockReason: 'Chưa kiểm tra được số điện thoại' }
      : { status: 'checking', isExisting: false, blockReason: 'Đang kiểm tra số điện thoại' };
  }
  if (!current.exists) return { status: 'new', isExisting: false, blockReason: null };
  if (!current.isResident) {
    return { status: 'internal', isExisting: false, blockReason: 'Số điện thoại thuộc tài khoản nội bộ' };
  }
  return current.userId === confirmedUserId
    ? { status: 'confirmed', isExisting: true, userId: current.userId, blockReason: null }
    : { status: 'existing', isExisting: true, blockReason: 'Chưa xác nhận đúng người' };
}

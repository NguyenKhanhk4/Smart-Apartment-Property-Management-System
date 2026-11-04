// Rule Form cho SĐT, cùng định dạng với phoneVn ở server/src/utils/validators.js (BR-S01: SĐT là bắt buộc)
export const PHONE_RULES = [
  { required: true, message: 'Vui lòng nhập số điện thoại' },
  { pattern: /^(?:\+?84|0)(?:[35789]\d{8}|2\d{9})$/, message: 'Số điện thoại không hợp lệ' },
];

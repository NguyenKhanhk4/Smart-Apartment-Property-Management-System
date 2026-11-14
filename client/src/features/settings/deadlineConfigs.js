// Tham số "Lịch & thời hạn" do trang Thông tin tòa nhà & Biểu phí quản lý.
// Trang "Danh mục & tham số" ẩn các khóa này để chỉ có 1 chỗ sửa.

export const CONFIG_GROUPS = [
  {
    title: 'Thu phí & Thanh toán',
    keys: ['BILLING_REMIND_DAY', 'PAYMENT_TERM_DAYS', 'INVOICE_APPROVAL_REMIND_DAYS', 'DEBT_REMINDER_INTERVAL_DAYS', 'DEBT_REMINDER_MAX'],
  },
  {
    title: 'Chờ cư dân & chủ nhà phản hồi',
    keys: ['OWNER_CONFIRM_REMIND_DAYS', 'OWNER_CONFIRM_AUTO_CANCEL_DAYS', 'QUOTE_REMIND_DAYS', 'QUOTE_AUTO_CLOSE_DAYS'],
  },
  {
    title: 'Bảo trì & Quỹ',
    keys: ['FUND_APPROVAL_REMIND_DAYS', 'REPAIR_REVIEW_REPEAT_DAYS', 'REPAIR_POSTPONE_MAX_DAYS', 'REPAIR_ACCEPTANCE_REMIND_DAYS'],
  },
  {
    title: 'Cảnh báo khẩn cấp & An toàn',
    keys: ['EMERGENCY_REPEAT_MINUTES'],
  },
  {
    title: 'Hệ thống & Tải file',
    keys: ['UPLOAD_MAX_SIZE_MB'],
  },
];

export const CONFIG_METADATA = {
  BILLING_REMIND_DAY: { label: 'Ngày nhắc lập thông báo phí', unit: 'hàng tháng', min: 1, max: 28 },
  PAYMENT_TERM_DAYS: { label: 'Hạn nộp phí sau khi phát hành', unit: 'ngày' },
  INVOICE_APPROVAL_REMIND_DAYS: { label: 'Nhắc duyệt thông báo phí sau', unit: 'ngày' },
  DEBT_REMINDER_INTERVAL_DAYS: { label: 'Khoảng cách giữa các lần nhắc nợ', unit: 'ngày' },
  DEBT_REMINDER_MAX: { label: 'Số lần nhắc nợ tối đa trước khi báo Trưởng BQL', unit: 'lần' },
  OWNER_CONFIRM_REMIND_DAYS: { label: 'Chủ nhà chưa xác nhận yêu cầu: nhắc sau', unit: 'ngày' },
  OWNER_CONFIRM_AUTO_CANCEL_DAYS: { label: 'Chủ nhà không phản hồi: tự hủy sau', unit: 'ngày' },
  QUOTE_REMIND_DAYS: { label: 'Nhắc cư dân đồng ý báo giá sau', unit: 'ngày' },
  QUOTE_AUTO_CLOSE_DAYS: { label: 'Cư dân không đồng ý báo giá: tự đóng sau', unit: 'ngày' },
  FUND_APPROVAL_REMIND_DAYS: { label: 'Nhắc Ban quản trị duyệt chi quỹ sau', unit: 'ngày' },
  REPAIR_REVIEW_REPEAT_DAYS: { label: 'Phiếu hoãn đến hạn xem lại: nhắc lại mỗi', unit: 'ngày' },
  REPAIR_POSTPONE_MAX_DAYS: { label: 'Tạm hoãn sửa chữa tối đa', unit: 'ngày' },
  REPAIR_ACCEPTANCE_REMIND_DAYS: { label: 'Chờ nghiệm thu quá hạn: nhắc Trưởng BQL sau', unit: 'ngày' },
  EMERGENCY_REPEAT_MINUTES: { label: 'Khoảng thời gian lặp lại cảnh báo khẩn cấp', unit: 'phút' },
  UPLOAD_MAX_SIZE_MB: { label: 'Dung lượng ảnh tối đa tải lên', unit: 'MB', max: 20 },
};

export const DEADLINE_CONFIG_KEYS = new Set(CONFIG_GROUPS.flatMap((g) => g.keys));

/** Bỏ mã nội bộ (UC48, BR-X8, M5-3, NFR-10, Mô đun 4…) khỏi mô tả tham số trước khi hiện cho người dùng */
export const cleanConfigDescription = (s = '') =>
  s
    .replace(/\s*\((?:UC|BR|NFR|M\d)[^)]*\)/g, '')
    // "— UC48, X8" / "— NFR-10." / "— Mô đun 4" ở bất kỳ đâu trong câu
    .replace(/\s*[—–]\s*(?:Mô đun \d+|(?:UC|BR|NFR|X|M)[\w-]*)(?:,\s*(?:UC|BR|NFR|X|M)[\w-]*)*(\.?)/gu, '$1')
    .trim();

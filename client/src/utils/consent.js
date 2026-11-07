// BR-X7: cư dân chưa đồng ý hoặc đã rút đồng ý thì bị khóa đăng ký xe, khai báo nhân khẩu, tải ảnh.
// Nhân viên không bị khóa. Server vẫn kiểm tra lại (requireConsent), ở đây chỉ để ẩn / khóa nút cho rõ.
export const isConsentLocked = (user) => user?.role === 'RESIDENT' && user?.consentStatus !== 'ACCEPTED';

export const CONSENT_TAB_PATH = '/r/profile?tab=consent';

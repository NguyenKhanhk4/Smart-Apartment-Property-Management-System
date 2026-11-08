// BR-X7: cư dân chưa đồng ý, đã rút đồng ý, hoặc mới đồng ý bản điều khoản cũ thì bị khóa đăng ký xe, khai báo nhân khẩu, tải ảnh.
// Nhân viên không bị khóa. Server vẫn kiểm tra lại (requireConsent), ở đây chỉ để ẩn / khóa nút cho rõ.
export const isConsentLocked = (user) =>
  user?.role === 'RESIDENT' && (user?.consentStatus !== 'ACCEPTED' || Boolean(user?.consentOutdated));

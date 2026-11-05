// Nội dung điều khoản dữ liệu cá nhân (BR-X7). Đổi nội dung thì tăng CONSENT_POLICY_VERSION ở server.
export default function PersonalDataTerms() {
  return (
    <div className="max-h-56 overflow-y-auto rounded-md border border-line p-3 text-[13px] leading-relaxed text-ink-2">
      <p className="mt-0">
        Ban quản lý thu thập họ tên, số điện thoại, email, ngày sinh, số CCCD, ảnh giấy tờ và thông tin phương tiện để
        quản lý cư trú, an ninh, thu phí và cung cấp tiện ích của tòa nhà.
      </p>
      <p>
        Dữ liệu chỉ được dùng cho các mục đích trên và chỉ người có nhiệm vụ mới được xem. Bạn có thể rút lại đồng ý
        trong trang Hồ sơ cá nhân bất cứ lúc nào.
      </p>
      <p className="mb-0">
        Nếu không đồng ý, bạn vẫn kích hoạt được tài khoản nhưng chỉ xem được thông báo phí, thanh toán và bảng tin.
        Khai báo nhân khẩu, đăng ký xe và tải ảnh sẽ bị khóa.
      </p>
    </div>
  );
}

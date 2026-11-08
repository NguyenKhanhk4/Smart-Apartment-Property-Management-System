// Nội dung điều khoản dữ liệu cá nhân (BR-X7, NFR-13). Đổi nội dung thì tăng CONSENT_POLICY_VERSION ở server.
// Bản nháp: cần nhóm / giảng viên duyệt trước khi dùng thật.
const SECTIONS = [
  {
    title: 'Dữ liệu được thu thập',
    body: 'Họ tên, số điện thoại, email, ngày sinh, số CCCD và ảnh giấy tờ, thông tin phương tiện, ảnh bạn tải lên, lịch sử sử dụng dịch vụ của tòa nhà.',
  },
  {
    title: 'Mục đích sử dụng',
    body: 'Quản lý cư trú, an ninh ra vào, thu phí và gửi thông báo phí, cung cấp tiện ích, xử lý phản ánh và sự cố trong tòa nhà. Dữ liệu không dùng cho mục đích khác và không cung cấp cho bên ngoài, trừ khi pháp luật yêu cầu.',
  },
  {
    title: 'Ai được xem',
    body: 'Chỉ nhân viên Ban quản lý có nhiệm vụ liên quan. Số CCCD được che, chỉ Lễ tân và Trưởng Ban quản lý xem đầy đủ khi cần, và mỗi lần xem đều được ghi lại.',
  },
  {
    title: 'Thời gian lưu',
    body: 'Thông tin tài khoản được giữ cả khi tài khoản bị khóa để bảo đảm lịch sử thu phí và cư trú. Dữ liệu khách ra vào tự xóa sau 12 tháng.',
  },
  {
    title: 'Quyền của bạn',
    body: 'Xem và sửa thông tin trong trang Hồ sơ cá nhân hoặc tại quầy lễ tân; rút lại đồng ý bất cứ lúc nào trong trang Hồ sơ cá nhân; liên hệ Ban quản lý tại quầy lễ tân khi có thắc mắc hoặc yêu cầu về dữ liệu của mình.',
  },
  {
    title: 'Nếu không đồng ý',
    body: 'Bạn vẫn dùng được tài khoản để xem thông báo phí, thanh toán và đọc bảng tin. Khai báo nhân khẩu, đăng ký xe và tải ảnh sẽ bị khóa cho đến khi bạn đồng ý.',
  },
];

// onScroll / ref: modal điều khoản dùng để biết cư dân đã cuộn đọc hết chưa
export default function PersonalDataTerms({ className = 'max-h-64', onScroll, ref }) {
  return (
    <div
      ref={ref}
      onScroll={onScroll}
      tabIndex={0}
      className={`${className} overflow-y-auto rounded-[10px] border border-line-strong bg-surface-alt/40 p-3 text-[13px] leading-relaxed text-ink-2`}
    >
      <p className="mt-0 font-semibold text-ink">Điều khoản xử lý dữ liệu cá nhân</p>
      {SECTIONS.map(({ title, body }) => (
        <p key={title} className="mb-2 last:mb-0">
          <span className="font-semibold text-ink">{title}. </span>
          {body}
        </p>
      ))}
    </div>
  );
}

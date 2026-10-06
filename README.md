# Smart Apartment Property Management System (SAPMS)

> Hệ thống quản lý và vận hành chung cư. Đồ án tốt nghiệp WDP: team 5 thành viên, 8 tuần (dự phòng 6 tuần).

SAPMS là một ứng dụng web tập trung dành cho **đơn vị vận hành**, **Ban quản trị** và **cư dân** của một khu chung cư gồm nhiều tòa/block. Hệ thống số hóa toàn bộ vòng vận hành: căn hộ, cư dân, hợp đồng; thu phí dịch vụ theo bậc thang và thanh toán VNPay; quỹ bảo trì 2% minh bạch; bảo trì tài sản chung định kỳ; phản ánh có SLA; đặt tiện ích; sổ khách; bảng tin; dashboard báo cáo.

**"Thông minh" = tự động hóa quy trình nghiệp vụ**, không phải IoT. Cron tự sinh hóa đơn, tự tạo work order bảo trì, tự leo thang ticket quá hạn, tự cập nhật công nợ. Dự án thuần phần mềm, không có thiết bị phần cứng.

📄 **Tài liệu gốc:** [`SRS_chung_cu_final.docx`](SRS_chung_cu_final.docx) (v2.0) là nguồn duy nhất về yêu cầu. README này tóm tắt để tra cứu nhanh; khi có mâu thuẫn, SRS là chuẩn.
🛠️ **Core & quy ước code:** [`docs/CORE_PLAN.md`](docs/CORE_PLAN.md)

---

## Mục lục

1. [Bối cảnh & mục tiêu](#1-bối-cảnh--mục-tiêu)
2. [Ba module điểm nhấn](#2-ba-module-điểm-nhấn)
3. [Actor & phân quyền](#3-actor--phân-quyền)
4. [Chức năng theo module](#4-chức-năng-theo-module)
5. [Quy trình nghiệp vụ chính](#5-quy-trình-nghiệp-vụ-chính)
6. [Quy tắc nghiệp vụ (BR)](#6-quy-tắc-nghiệp-vụ-br)
7. [Công nghệ](#7-công-nghệ)
8. [Kiến trúc & cấu trúc thư mục](#8-kiến-trúc--cấu-trúc-thư-mục)
9. [Mô hình dữ liệu](#9-mô-hình-dữ-liệu)
10. [Quy ước API](#10-quy-ước-api)
11. [Cron job](#11-cron-job)
12. [Cài đặt & chạy local](#12-cài-đặt--chạy-local)
13. [Biến môi trường](#13-biến-môi-trường)
14. [Phân công team](#14-phân-công-team)
15. [Quy trình Git](#15-quy-trình-git)
16. [Triển khai demo](#16-triển-khai-demo)
17. [Ngoài phạm vi](#17-ngoài-phạm-vi)
18. [Lộ trình 8 tuần](#18-lộ-trình-8-tuần)

---

## 1. Bối cảnh & mục tiêu

**Hiện trạng:** nhiều khu chung cư vẫn vận hành thủ công.

- Chốt chỉ số điện nước bằng tay, tính tiền trên Excel và dễ tính sai bậc thang.
- Quỹ bảo trì 2% không có kênh minh bạch: cư dân không biết thu bao nhiêu, chi vào đâu, ai duyệt.
- Lịch bảo trì thang máy, máy bơm, PCCC ghi sổ tay nên dễ quên chu kỳ.
- Phản ánh gửi qua Zalo bị trôi, không rõ ai xử lý, quá hạn cũng không ai biết.
- Khách đến thăm không được ghi nhận, khó truy vết khi có sự cố.

**Mục tiêu nghiệp vụ (đo được):**

| #  | Mục tiêu | Chỉ số đo |
|----|----------|-----------|
| G1 | Phát hành hóa đơn đúng hạn, đúng cơ chế giá | Hóa đơn tự sinh theo cron, tính đúng bậc thang |
| G2 | Giảm đối chiếu thanh toán thủ công | VNPay tự cập nhật trạng thái hóa đơn, có đối soát |
| G3 | Phản ánh luôn có người phụ trách và hạn xử lý | 100% ticket được phân công, tự leo thang nếu trễ |
| G4 | Minh bạch quỹ bảo trì | Mọi khoản thu/chi có người đề xuất/duyệt, cư dân xem được số dư |
| G5 | Phòng ngừa hỏng hóc thiết bị | 100% tài sản chung có lịch bảo trì, tự tạo work order khi đến hạn |
| G6 | Nhìn được hiệu quả vận hành toàn khu | Dashboard doanh thu, công nợ, quỹ, bảo trì, phản ánh, lọc theo tòa |

## 2. Ba module điểm nhấn

1. **Quỹ bảo trì 2% minh bạch:** đề xuất chi kèm chứng từ, Ban quản trị duyệt hoặc từ chối, hệ thống tự trừ số dư trong một MongoDB transaction, ghi audit log, và cư dân xem được báo cáo công khai.
2. **Bảo trì tài sản tự động:** cấu hình chu kỳ cho từng tài sản, cron tạo work order khi đến hạn, phân công kỹ thuật viên; khi hoàn thành, hệ thống tự tính ngày bảo trì kế tiếp.
3. **Bậc thang + VNPay + leo thang ticket:** tính điện nước theo bậc, lưu snapshot đơn giá vào hóa đơn, thanh toán VNPay có IPN idempotent, ticket quá SLA tự nâng mức ưu tiên và báo Admin.

## 3. Actor & phân quyền

> ⚠️ **Đã đổi theo `doc/srs_final.md` (v3.1):** hệ thống có 6 role `RESIDENT, STAFF (RECEPTIONIST/SECURITY/TECHNICIAN), ACCOUNTANT, MANAGER, BOARD (CHAIRMAN/MEMBER), ADMIN`. ADMIN **không** có quyền nghiệp vụ (BR-R3). Code (`server/src/constants/enums.js`, `middlewares/authorize.js`) đã theo mô hình mới. Bảng bên dưới là bản cũ, giữ lại để tham khảo. Thiết kế DB: `doc/database_design.md`.

| Role | Là ai | Ghi chú |
|------|-------|---------|
| `RESIDENT` | Cư dân | `relationType`: `OWNER` (chủ sở hữu, chịu trách nhiệm hóa đơn, được đăng ký xe), `TENANT` (người thuê, hợp đồng có hạn), `FAMILY_MEMBER` (chỉ xem, phản ánh, đặt tiện ích) |
| `STAFF` | Nhân viên vận hành | Chức danh qua `roleTitle`: `RECEPTIONIST`, `SECURITY`, `TECHNICIAN`, `ACCOUNTANT`. Chỉ TECHNICIAN nhận work order; chỉ ACCOUNTANT xác nhận thanh toán và ghi nhận chi phí |
| `BOARD` | Ban quản trị (đại diện cư dân) | Duyệt/từ chối đề xuất chi quỹ bảo trì, xem báo cáo tài chính quỹ. Không vận hành hằng ngày, không cấu hình hệ thống |
| `ADMIN` | Trưởng đơn vị vận hành / đại diện chủ đầu tư | Cấu hình hệ thống (tòa, bảng giá, tham số, tài khoản Staff/Board), có **toàn bộ quyền của Staff** (BR10) |

**Hệ thống bên ngoài:** VNPay sandbox (thanh toán, IPN), Nodemailer/Gmail (email hóa đơn, nhắc nợ, kết quả duyệt chi), Cloudinary (ảnh phản ánh, chứng từ).

<details>
<summary><b>Ma trận phân quyền (RBAC)</b></summary>

| Chức năng | RESIDENT | STAFF | BOARD | ADMIN |
|-----------|----------|-------|-------|-------|
| Xem/sửa hồ sơ căn hộ, cư dân | Đọc (của mình) | Đọc/Ghi | — | Đọc/Ghi |
| Nhập chỉ số, sinh hóa đơn | — | Ghi | — | Đọc/Ghi |
| Thanh toán | Ghi (VNPay) | Ghi (thủ công) | — | Đọc |
| Đề xuất chi quỹ bảo trì | — | Ghi | — | Ghi |
| Phê duyệt chi quỹ bảo trì | — | — | Ghi | — |
| Xem báo cáo quỹ bảo trì | Đọc | Đọc | Đọc | Đọc |
| Quản lý tài sản & lịch bảo trì | — | Đọc | — | Ghi |
| Xử lý work order | — | Ghi (kỹ thuật viên) | — | Đọc/Ghi |
| Đặt tiện ích | Ghi | Duyệt | — | Đọc |
| Tạo/xử lý ticket | Tạo | Xử lý | — | Đọc/Ghi |
| Cấu hình hệ thống | — | — | — | Ghi |
| Xem audit log | — | — | — | Đọc |

</details>

## 4. Chức năng theo module

Ưu tiên MoSCoW: **M** = Must (bắt buộc để bảo vệ), **S** = Should (làm nếu đúng tiến độ).

| # | Module | Chức năng chính | Phụ trách |
|---|--------|-----------------|-----------|
| 1 | Tài khoản & phân quyền | Đăng nhập/đăng xuất JWT, 4 role (M) · Hồ sơ, đổi mật khẩu (M) · Admin tạo Staff/Board, Staff tạo cư dân (M) | A |
| 2 | Tòa nhà, căn hộ, cư dân, hợp đồng, phương tiện | Nhiều tòa/block (M) · Căn hộ: số căn, tầng, diện tích, trạng thái (M) · Hợp đồng mua bán/thuê (M) · Gán cư dân owner/tenant/family (M) · Đăng ký xe, duyệt, giới hạn slot (M) · Tạm trú/tạm vắng (S) | A |
| 3 | Phí dịch vụ & hóa đơn | Bảng giá bậc thang điện/nước, phí quản lý, gửi xe (M) · Nhập chỉ số (M) · Cron sinh hóa đơn + nút thủ công (M) · Chi tiết từng bậc (M) · VNPay: URL, IPN, verify chữ ký (M) · Xác nhận tiền mặt/chuyển khoản (M) · Công nợ, nhắc nợ tự động (M) · Đối soát VNPay (S) | B |
| 4 | Quỹ bảo trì 2% & chi phí vận hành | Ghi thu quỹ (M) · Đề xuất chi kèm ảnh chứng từ (M) · Board duyệt/từ chối (M) · Tự trừ số dư khi duyệt (M) · Báo cáo thu/chi công khai (M) · Chi phí vận hành thường xuyên (M) · Cảnh báo số dư dưới ngưỡng (S) | C |
| 5 | Tài sản & bảo trì thiết bị | Danh mục tài sản theo tòa (M) · Chu kỳ bảo trì (M) · Cron tạo work order (M) · Phân công, cập nhật tiến độ (M) · Lịch sử bảo trì (S) | D |
| 6 | Phản ánh / khiếu nại (Ticket) | Tạo kèm ảnh (M) · Luồng trạng thái (M) · Phân công + ưu tiên, tự tính hạn (M) · Cập nhật tiến độ (M) · Xác nhận + đánh giá sao (M) · Tự leo thang quá hạn (S) | E |
| 7 | Đặt tiện ích (Booking) | Quản lý tiện ích: giờ, slot, sức chứa (M) · Xem lịch trống, đặt, kiểm tra trùng (M) · Duyệt/từ chối/hủy (M) · Chặn nếu căn hộ nợ quá hạn (S) | D |
| 8 | Sổ khách ra vào | Đăng ký khách trước (S) · Ghi giờ đến/rời (S) | E |
| 9 | Bảng tin & thông báo | Bảng tin (M) · Thông báo cá nhân trong app (M) · Gửi toàn khu/theo tòa/theo căn (M) · Email (S) · Realtime Socket.io (S) | E |
| 10 | Dashboard & báo cáo | Doanh thu & công nợ theo tháng, lọc theo tòa (M) · Quỹ bảo trì (M) · Tỷ lệ lấp đầy (M) · Thống kê phản ánh & kỹ thuật viên (M) · Xuất Excel/PDF (M) · Thống kê bảo trì, tiện ích (S) | E |
| 11 | Audit log | Ghi log hành động tài chính (M) · Xem, lọc log (S) | C |

Tổng cộng **47 use case** (41 Must, 6 Should). Danh sách chi tiết theo thành viên ở SRS mục 6.

## 5. Quy trình nghiệp vụ chính

**Thu phí hằng tháng**

```
Admin cấu hình bảng giá bậc thang (một lần) → Staff nhập chỉ số điện/nước từng căn
→ Cron sinh hóa đơn đầu tháng (có nút thủ công dự phòng) → tính bậc thang, snapshot đơn giá, gửi thông báo
→ Cư dân thanh toán VNPay hoặc Staff xác nhận thủ công → đối soát VNPay định kỳ
→ Quá hạn: nhắc nợ tự động → chặn đặt tiện ích
```

**Thu chi quỹ bảo trì**

```
Staff/Admin tạo đề xuất chi kèm ảnh/báo giá → Ban quản trị nhận thông báo, xem đề xuất + số dư
→ Duyệt / Từ chối (kèm lý do) → Nếu duyệt: trừ số dư, đánh dấu "Đã chi", ghi audit log
→ Cư dân thấy khoản chi trong báo cáo quỹ công khai
```

**Bảo trì định kỳ tự động**

```
Admin cấu hình tài sản + chu kỳ → Cron hằng ngày quét tài sản đến hạn → tạo Work Order "Chờ xử lý"
→ Staff phân công kỹ thuật viên → hoàn thành → hệ thống tính ngày bảo trì tiếp theo
```

**Phản ánh có leo thang**

```
Cư dân tạo ticket → Staff phân công + đặt ưu tiên → hạn xử lý tự tính theo SLA
→ Kỹ thuật viên cập nhật tiến độ → [Cron hằng ngày] quá hạn: nâng ưu tiên + báo Admin
→ Cư dân xác nhận, đánh giá → Đóng
```

**Đặt tiện ích**

```
Cư dân chọn tiện ích, ngày → xem slot trống → đặt → kiểm tra không trùng, không nợ quá hạn
→ Staff duyệt / từ chối → thông báo cư dân
```

## 6. Quy tắc nghiệp vụ (BR)

| # | Quy tắc |
|---|---------|
| BR1 | Mỗi căn hộ có tối đa 1 chủ sở hữu chính trên hợp đồng; chỉ chủ sở hữu/người thuê hợp lệ mới đăng ký được phương tiện |
| BR2 | Mỗi căn hộ chỉ có 1 hóa đơn/tháng: unique index `(apartmentId, month)` |
| BR3 | Hóa đơn lưu đơn giá tại thời điểm sinh (snapshot); đổi bảng giá không làm đổi hóa đơn cũ |
| BR4 | Phí quản lý = đơn giá × diện tích; điện/nước tính theo bậc thang; gửi xe = số xe × đơn giá theo loại |
| BR5 | Callback VNPay phải idempotent: cùng mã giao dịch không ghi nhận 2 lần |
| BR6 | Hóa đơn quá hạn sau N ngày (cấu hình, mặc định 15) → căn hộ bị chặn đặt tiện ích |
| BR7 | Hạn xử lý ticket: Khẩn cấp 24h, Cao 3 ngày, Thường 7 ngày (cấu hình được) |
| BR8 | Ticket chỉ Đóng khi cư dân xác nhận, hoặc Staff đóng thủ công sau 7 ngày không phản hồi |
| BR9 | Một slot tiện ích không nhận quá sức chứa; một căn hộ không giữ quá 2 booking chưa dùng cùng lúc |
| BR10 | Admin có toàn bộ quyền của Staff |
| BR11 | Điện/nước bậc thang: mỗi bậc có ngưỡng và đơn giá riêng; chỉ phần vượt ngưỡng bậc dưới mới tính theo giá bậc trên |
| BR12 | Hợp đồng thuê hết hạn không gia hạn → căn hộ tự chuyển "Trống" (cron hằng ngày) |
| BR13 | Chỉ trừ số dư quỹ bảo trì sau khi Ban quản trị phê duyệt |
| BR14 | Không được duyệt chi vượt quá số dư quỹ bảo trì hiện có |
| BR15 | Work order định kỳ tự sinh không trùng với work order chưa hoàn thành của cùng tài sản |
| BR16 | Ticket quá SLA chưa xong → tự nâng 1 mức ưu tiên (tối đa Khẩn cấp), không quá 1 lần/ngày |
| BR17 | Tạm trú/tạm vắng: ngày kết thúc sau ngày bắt đầu; không có 2 khai báo chồng lấn của cùng cư dân |
| BR18 | Sinh hóa đơn, xác nhận thanh toán, duyệt/từ chối chi quỹ đều ghi audit log |
| BR19 | Bảo vệ được ghi nhận khách vãng lai chưa đăng ký, nhưng bắt buộc nhập tên khách và căn hộ đến thăm |
| BR20 | Chi phí vận hành và quỹ bảo trì là hai nguồn tách biệt, không ghi lẫn |

## 7. Công nghệ

| Lớp | Công nghệ |
|-----|-----------|
| Backend | Node.js + Express, cấu trúc theo module (routes / controllers / services / validations) |
| Database | MongoDB Atlas (free tier) + Mongoose |
| Xác thực | JWT (access + refresh token) + bcrypt, middleware phân quyền theo role |
| Validate | Joi, validate mọi input ở backend |
| Upload ảnh | Multer + Cloudinary (≤ 5MB, jpg/png) |
| Thanh toán | VNPay sandbox (tự ký HMAC SHA512, xử lý IPN) |
| Email | Nodemailer + Gmail app password |
| Realtime | Socket.io (nếu không kịp thì tải lại danh sách thông báo) |
| Lịch chạy nền | node-cron, múi giờ `Asia/Ho_Chi_Minh` |
| Xuất báo cáo | exceljs (Excel), pdfkit (PDF) |
| Frontend | React (Vite) + React Router + Axios, một app duy nhất, điều hướng theo role sau đăng nhập |
| UI / Biểu đồ | Ant Design · Recharts |
| Tài liệu API | Swagger (swagger-jsdoc + swagger-ui-express) tại `/api-docs` |
| Triển khai | Render (backend) + Vercel (frontend) + MongoDB Atlas |

Giao diện cư dân được thiết kế responsive, ưu tiên mobile, nằm trong cùng app React (không làm PWA hay app native).

## 8. Kiến trúc & cấu trúc thư mục

```
┌──────────────────────┐   REST /api + Socket.io   ┌──────────────────────────┐        ┌──────────────────┐
│  React SPA (Vercel)  │ ────────────────────────▶ │  Express API (Render)    │ ─────▶ │  MongoDB Atlas   │
│  Admin/Staff/Board   │ ◀──────────────────────── │  + node-cron jobs        │        └──────────────────┘
│  Resident mobile-first│                           │                          │ ─────▶ Cloudinary · Gmail SMTP
└──────────────────────┘                           └──────────────────────────┘ ◀────▶ VNPay sandbox (URL + IPN)
```

Một repo gồm hai ứng dụng độc lập (mỗi bên có `package.json` riêng để deploy tách biệt). Cây dưới đây là phần **core đã dựng**; các mục ghi *(module)* do từng thành viên thêm vào.

```
.
├── server/                     # Backend Node.js + Express 5
│   ├── .env.example
│   ├── tests/core.test.js      # test middleware + format response
│   └── src/
│       ├── server.js           # entry: kết nối DB → listen, tắt êm khi SIGINT/SIGTERM
│       ├── app.js              # helmet, cors, json, morgan → /api → /api-docs → 404 → errorHandler
│       ├── routes.js           # /api/health + nơi gắn router của từng module (1 dòng / module)
│       ├── config/             # env.js (validate .env), db.js, swagger.js
│       ├── constants/          # enums.js (role), errorCodes.js (mã lỗi SRS 4.2)
│       ├── middlewares/        # auth (đọc JWT Bearer), authorize (role + roleTitle), validate (Joi), errorHandler, notFound
│       ├── utils/              # ApiError, response (ok/created/paginated), pagination
│       ├── models/             # (module) Mongoose model
│       └── modules/            # (module) mỗi module: <m>.routes / .controller / .service / .validation
├── client/                     # Frontend React 19 + Vite + Ant Design 6
│   ├── .env.example
│   └── src/
│       ├── main.jsx, App.jsx   # ConfigProvider (vi_VN), AntApp, AuthProvider, router
│       ├── api/axiosClient.js  # gắn header Authorization, tự refresh khi 401, chuẩn hóa lỗi
│       ├── config/menu.js      # nguồn duy nhất sinh menu + route theo role
│       ├── contexts/           # AuthContext + AuthProvider (phiên đăng nhập)
│       ├── routes/             # AppRouter, guard RequireAuth / GuestOnly, trang chủ theo role
│       ├── layouts/            # AuthLayout · AdminLayout (sidebar) · ResidentLayout (mobile-first, bottom nav)
│       ├── components/         # UserMenu, PlaceholderPage, PageLoader
│       ├── constants/          # nhãn role tiếng Việt, thông báo lỗi theo errorCode
│       ├── hooks/useAuth.js
│       ├── utils/              # authStorage (localStorage), permission (khớp authorize backend)
│       └── features/           # home, errors + (module) mỗi module một thư mục
├── docs/CORE_PLAN.md
├── SRS_chung_cu_final.docx
└── README.md
```

## 9. Mô hình dữ liệu

MongoDB, mỗi collection đều có `createdAt` và `updatedAt` (`timestamps: true`). Chi tiết field xem SRS mục 10.

| Nhóm | Collections |
|------|-------------|
| Tài khoản & cấu hình | `users`, `system_configs`, `audit_logs` |
| Căn hộ & cư dân | `buildings`, `apartments`, `contracts`, `residents`, `temporary_residencies`, `vehicles` |
| Phí & hóa đơn | `price_configs`, `meter_readings`, `invoices`, `payments` |
| Quỹ & chi phí | `maintenance_fund`, `fund_transactions`, `fund_proposals`, `operating_expenses` |
| Tài sản & bảo trì | `assets`, `work_orders` |
| Phản ánh | `tickets`, `complaint_categories` |
| Tiện ích & khách | `amenities`, `bookings`, `guest_logs` |
| Truyền thông | `announcements`, `notifications` |

**Ràng buộc quan trọng:** unique `users.email`; unique `(apartments.buildingId, code)`; unique `(invoices.apartmentId, month)` (BR2); unique `vehicles.plateNumber`; unique sparse `payments.vnpTxnRef` (BR5); unique `system_configs.key`.

<details>
<summary><b>Bảng Enum / Status</b></summary>

| Entity.field | Giá trị |
|--------------|---------|
| User.role | `RESIDENT`, `STAFF`, `BOARD`, `ADMIN` |
| User.roleTitle | `RECEPTIONIST`, `SECURITY`, `TECHNICIAN`, `ACCOUNTANT` |
| Apartment.status | `VACANT`, `OWNED`, `RENTED` |
| Contract.type / status | `SALE`, `LEASE` / `ACTIVE`, `EXPIRED`, `TERMINATED` |
| Resident.relationType | `OWNER`, `TENANT`, `FAMILY_MEMBER` |
| TemporaryResidency.type / status | `TEMP_RESIDENCE`, `TEMP_ABSENCE` / `PENDING`, `CONFIRMED` |
| Vehicle.type / status | `MOTORBIKE`, `CAR` / `PENDING`, `APPROVED`, `REJECTED` |
| Invoice.status | `UNPAID`, `PAID`, `OVERDUE` |
| Payment.method / status | `VNPAY`, `CASH`, `BANK_TRANSFER` / `PENDING`, `SUCCESS`, `FAILED` |
| FundTransaction.type | `INCOME`, `EXPENSE` |
| FundProposal.status | `PENDING`, `APPROVED`, `REJECTED` |
| OperatingExpense.category | `SALARY`, `COMMON_UTILITY`, `OUTSOURCED_SERVICE`, `OTHER` |
| Asset.category | `ELEVATOR`, `PUMP`, `FIRE_SYSTEM`, `OTHER` |
| WorkOrder.type / status | `SCHEDULED`, `TICKET_LINKED` / `PENDING`, `IN_PROGRESS`, `DONE` |
| Ticket.priority | `LOW`, `MEDIUM`, `HIGH`, `URGENT` |
| Ticket.status | `NEW`, `ASSIGNED`, `IN_PROGRESS`, `WAITING_CONFIRM`, `CLOSED`, `REJECTED` |
| Booking.status | `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED` |
| Announcement.targetScope | `ALL`, `BUILDING`, `APARTMENT` |
| Notification.type | `INVOICE`, `TICKET`, `BOOKING`, `FUND_APPROVAL`, `ANNOUNCEMENT` |

</details>

## 10. Quy ước API

- Base URL: `/api`. Tài liệu đầy đủ tại `/api-docs` (Swagger); danh sách endpoint theo module ở SRS mục 11.
- Xác thực: header `Authorization: Bearer <accessToken>` cho mọi API, trừ `register`, `login`, `refresh` và VNPay IPN (IPN xác thực bằng chữ ký HMAC).
- Phân quyền kiểm tra ở backend bằng middleware, không tin frontend.
- API danh sách phân trang qua `?page=&limit=`.
- Mọi thao tác tài chính (sinh hóa đơn, xác nhận thanh toán, duyệt chi quỹ) ghi audit log.

**Format response thống nhất:**

```jsonc
// Thành công
{ "success": true, "data": { }, "message": "..." }

// Danh sách có phân trang
{ "success": true, "data": [ ], "pagination": { "page": 1, "limit": 20, "total": 134 } }

// Lỗi
{ "success": false, "message": "Mô tả lỗi", "errorCode": "VALIDATION_ERROR" }
```

<details>
<summary><b>Mã lỗi chuẩn (errorCode)</b></summary>

| Mã lỗi | Ý nghĩa |
|--------|---------|
| `VALIDATION_ERROR` | Dữ liệu đầu vào không hợp lệ |
| `UNAUTHORIZED` | Chưa đăng nhập / token hết hạn |
| `FORBIDDEN_ROLE` | Không đủ quyền theo role |
| `NOT_FOUND` | Không tìm thấy bản ghi |
| `AUTH_INVALID_CREDENTIALS` | Sai email/mật khẩu |
| `INVOICE_ALREADY_EXISTS` | Căn hộ đã có hóa đơn tháng này (BR2) |
| `INVOICE_ALREADY_PAID` | Hóa đơn đã thanh toán |
| `PAYMENT_DUPLICATE` | Giao dịch VNPay đã được ghi nhận (idempotent) |
| `FUND_INSUFFICIENT_BALANCE` | Số dư quỹ không đủ để duyệt chi (BR14) |
| `PROPOSAL_ALREADY_REVIEWED` | Đề xuất đã được duyệt/từ chối |
| `BOOKING_SLOT_CONFLICT` | Slot đã đủ sức chứa hoặc trùng lịch |
| `BOOKING_APARTMENT_OVERDUE` | Căn hộ nợ quá hạn, không được đặt tiện ích |
| `VEHICLE_SLOT_FULL` | Bãi xe hết chỗ |
| `RESIDENCY_DATE_OVERLAP` | Khai báo tạm trú/tạm vắng chồng lấn (BR17) |
| `TICKET_ALREADY_CLOSED` | Ticket đã đóng |
| `WORKORDER_DUPLICATE` | Đã có work order chưa hoàn thành cho tài sản này (BR15) |
| `SERVER_ERROR` | Lỗi hệ thống không xác định |

</details>

| Nhóm endpoint | Module | Phụ trách |
|---------------|--------|-----------|
| `/auth`, `/users` | Tài khoản | A |
| `/buildings`, `/apartments`, `/contracts`, `/residents`, `/temporary-residencies`, `/vehicles` | Căn hộ & cư dân | A |
| `/price-configs`, `/meter-readings`, `/invoices`, `/payments` | Hóa đơn & thanh toán | B |
| `/funds`, `/fund-proposals`, `/operating-expenses`, `/audit-logs` | Quỹ & chi phí | C |
| `/assets`, `/work-orders`, `/amenities`, `/bookings` | Tài sản & tiện ích | D |
| `/complaint-categories`, `/tickets`, `/guest-logs`, `/announcements`, `/notifications`, `/system-configs`, `/reports` | Ticket, truyền thông, báo cáo | E |

## 11. Cron job

Tất cả chạy theo múi giờ `Asia/Ho_Chi_Minh`.

| Lịch | Việc làm | Module |
|------|----------|--------|
| `0 0 * * *` | Hợp đồng thuê hết hạn → căn hộ về `VACANT` (BR12) | Contract (A) |
| `0 1 1 * *` | Sinh hóa đơn tháng mới | Invoice (B) |
| `0 2 * * *` | Tạo work order cho tài sản đến hạn bảo trì (BR15) | Asset (D) |
| `0 8 * * *` | Đánh dấu hóa đơn quá hạn + nhắc nợ | Invoice (B) |
| `0 9 * * *` | Leo thang ticket quá hạn (BR16) | Ticket (E) |

> Khuyến nghị cho module làm cron: thêm biến `ENABLE_CRON` và chỉ bật trên môi trường demo, để nhiều máy dev không cùng chạy cron trên chung một database; kèm một endpoint cho Admin chạy job thủ công khi test/demo.

## 12. Cài đặt & chạy local

**Yêu cầu:** Node.js ≥ 20.19, npm, quyền truy cập cluster MongoDB Atlas của team (xin leader chuỗi `MONGODB_URI` qua kênh riêng).

```bash
git clone <repo-url>
cd Smart-Apartment-Property-Management-System

# Backend: http://localhost:5000
cd server
npm install
cp .env.example .env      # điền MONGODB_URI (kèm tên DB riêng), JWT secret
npm run dev

# Frontend: http://localhost:5173 (mở terminal thứ hai)
cd client
npm install
cp .env.example .env
npm run dev
```

| Thư mục | Lệnh | Tác dụng |
|---------|------|----------|
| `server/` | `npm run dev` | Chạy API với nodemon (tự restart khi sửa code) |
| `server/` | `npm test` | Test backend (Vitest + Supertest) |
| `server/` | `npm run lint` | ESLint |
| `client/` | `npm run dev` | Chạy Vite dev server |
| `client/` | `npm run build` | Build production vào `client/dist` |
| `client/` | `npm run lint` | ESLint |

- Kiểm tra server: http://localhost:5000/api/health · Swagger: http://localhost:5000/api-docs
- Khi dev, frontend gọi `/api` cùng origin, Vite proxy sang `:5000` nên không vướng CORS.

> ⚠️ **Không bao giờ commit file `.env`.** Chuỗi kết nối database, JWT secret và các khóa VNPay/Cloudinary chỉ nằm ở máy local và trên dashboard Render/Vercel.

## 13. Biến môi trường

**`server/.env`**: core chỉ bắt buộc các biến sau (validate trong `src/config/env.js`, thiếu thì server dừng ngay kèm thông báo).

| Biến | Ý nghĩa |
|------|---------|
| `PORT` | Cổng backend (mặc định `5000`) |
| `NODE_ENV` | `development` / `production` / `test` |
| `MONGODB_URI` | Chuỗi kết nối Atlas, **có tên database**, ví dụ `.../sapms_dev_<tên>?retryWrites=true&w=majority` |
| `CLIENT_URL` | Origin frontend cho CORS, ví dụ `http://localhost:5173` (nhiều origin phân tách bằng dấu phẩy) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Chuỗi ngẫu nhiên ≥ 16 ký tự |

Biến dành cho module (VNPay, Cloudinary, SMTP theo SRS mục 14) đã có sẵn dạng comment trong `server/.env.example`; module nào dùng thì bỏ comment và thêm validate vào `env.js`.

**`client/.env`**

| Biến | Ý nghĩa |
|------|---------|
| `VITE_API_URL` | URL gốc của API. Dev để `/api` (qua proxy); deploy: `https://<backend>.onrender.com/api` |

## 14. Phân công team

| Thành viên | Phạm vi | Số UC (Must/Should) |
|------------|---------|---------------------|
| **A** | Tài khoản, tòa nhà, căn hộ, cư dân, hợp đồng, phương tiện | 10 (10/0) |
| **B** | Phí dịch vụ, hóa đơn, thanh toán VNPay | 9 (8/1) |
| **C** | Quỹ bảo trì, chi phí vận hành, audit log | 8 (6/2) |
| **D** | Tài sản, bảo trì, tiện ích | 7 (7/0) |
| **E** | Ticket, sổ khách, bảng tin, thông báo, dashboard, báo cáo | 13 (10/3) |

## 15. Quy trình Git

- `main`: luôn chạy được, dùng để deploy demo. Không push trực tiếp.
- `develop`: nhánh tích hợp, mọi feature merge vào đây qua Pull Request.
- Nhánh tính năng: `feature/<module>-<mô-tả-ngắn>`, ví dụ `feature/invoices-vnpay-ipn`; sửa lỗi: `fix/<module>-<mô-tả>`.
- Commit theo Conventional Commits: `feat(invoices): tính tiền điện bậc thang`, `fix(auth): ...`, `docs: ...`.
- Mỗi PR cần ít nhất 1 người review, chạy lint + test trước khi merge.
- Mỗi người chỉ sửa trong `server/src/modules/<module>` và `client/src/features/<module>` của mình. File dùng chung (models, constants, middlewares) thay đổi qua PR riêng và báo cả team.

## 16. Triển khai demo

| Thành phần | Nền tảng | Ghi chú |
|------------|----------|---------|
| Backend | Render (Web Service, root `server/`) | Đặt biến môi trường trên dashboard |
| Frontend | Vercel (root `client/`) | `VITE_API_URL` trỏ về backend Render; rewrite mọi route về `index.html` |
| Database | MongoDB Atlas | Network Access cho phép IP của Render (hoặc `0.0.0.0/0`) |

Gói free của Render tự "ngủ" khi không có request, nên cron có thể không chạy đúng giờ. Trước buổi bảo vệ, gọi API để đánh thức server, rồi dùng nút chạy job thủ công để demo.

## 17. Ngoài phạm vi

Chủ động không làm: AI gợi ý phân loại phản ánh, quản lý nhà thầu bên thứ 3, chấm công/ca trực, vi phạm nội quy & xử phạt, tỷ lệ sở hữu chung/riêng, hội nghị nhà chung cư, khảo sát ý kiến, kho vật tư, IoT/thiết bị phần cứng. Lý do từng mục xem SRS mục 9.

## 18. Lộ trình 8 tuần

| Tuần | Mục tiêu |
|------|----------|
| 1 | Dựng core: khung BE/FE, format API, middleware JWT + phân quyền, axios client, router + layout theo role ([`docs/CORE_PLAN.md`](docs/CORE_PLAN.md)) |
| 2–3 | Các luồng Must nền tảng: căn hộ/cư dân/hợp đồng, bảng giá + chỉ số, tài sản, danh mục phản ánh, tiện ích |
| 4–5 | Điểm nhấn: sinh hóa đơn + VNPay, quỹ bảo trì + duyệt chi, cron work order, ticket + SLA, booking |
| 6 | Thông báo, bảng tin, dashboard, xuất báo cáo; các mục Should nếu kịp |
| 7 | Tích hợp liên module, sửa lỗi, kiểm thử end-to-end các quy trình chính |
| 8 | Deploy Render/Vercel, dữ liệu demo, Swagger/Postman, báo cáo và slide bảo vệ |

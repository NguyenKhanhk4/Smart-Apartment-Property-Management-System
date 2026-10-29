# BÁO CÁO TRIỂN KHAI PHASE 1 – NGƯỜI 2 (NGÔ THANH BÌNH)

- **Dự án:** WDP301 – Apartment Building Management System (SAPMS)
- **Người thực hiện:** Ngô Thanh Bình – Người 2 (`binhnthe186298@fpt.edu.vn`)
- **Nhánh làm việc:** `feature/nguoi2-phase1` (tách từ nhánh `Binh`, chưa push, chưa merge)
- **Phạm vi:** Module 2 (Hạ tầng & Căn hộ), Module 3 (Cư dân & Nhân khẩu), Gate Pass & Kiểm soát xe (Task 1 → Task 6)

---

## 1. Danh sách Commit trên nhánh `feature/nguoi2-phase1`

| STT | Commit Hash | Commit Message | Task tương ứng |
| :-: | :--- | :--- | :--- |
| 1 | `f89880f` | `[Người 2] Sửa lỗi transaction, truyền session cho logAudit và createdBy trong contracts/residents` | **Task 1** – Sửa lỗi có sẵn (`contracts`, `residents`) |
| 2 | `e860eae` | `[Người 2] Bổ sung Gate Pass (UC52-54), cron hết hạn và tra cứu biển số (UC62)` | **Task 2** – Gate Pass & tra biển số (UC52, UC53, UC54, UC62) |
| 3 | `344caa6` | `[Người 2] Bổ sung quản lý thẻ gửi xe và thu hồi thẻ (UC66)` | **Task 3** – Thẻ xe (UC66) |
| 4 | `14ead49` | `[Người 2] Bổ sung báo cáo và xuất Excel biến động nhân khẩu (UC21)` | **Task 4** – Xuất biến động nhân khẩu (UC21) |
| 5 | `d920951` | `[Người 2] Mã hóa AES-256-GCM và che số CCCD cư dân kèm script migrate` | **Task 5** – Che & mã hóa CCCD (`Resident`) |
| 6 | `8f7f554` | `[Người 2] Bổ sung cron nhắc trước 15 ngày hợp đồng thuê sắp hết hạn (UC19)` | **Task 6** – Nhắc hết hạn hợp đồng thuê (một phần UC19) |

---

## 2. Danh sách File đã Tạo mới / Chỉnh sửa

### 2.1. File thuộc phạm vi riêng của Người 2

#### Backend (`server/`)
| Trạng thái | Đường dẫn file | Mô tả thay đổi |
| :-: | :--- | :--- |
| **Mới (A)** | `server/src/models/GatePass.js` | Model `GatePass` (`code`, `apartmentId`, `createdBy`, `creatorRelation`, `direction`, `scheduledDate`, `timeSlot`, `items`, `truckPlate`, `driverPhone`, `status`, `ownerDecision`, `reviewedBy`, `reviewedAt`, `rejectReason`, `debtSnapshot`, `usedBy`, `usedAt`, index `(status, scheduledDate)` & `(apartmentId, createdAt)`). |
| **Mới (A)** | `server/src/modules/gatePasses/debtProvider.js` | Stub `getApartmentDebt(apartmentId)` trả `{ amount: 0, available: false }` kèm `TODO: thay bằng API công nợ của Người 3`. |
| **Mới (A)** | `server/src/modules/gatePasses/gatePasses.service.js` | Nghiệp vụ UC52/UC53/UC54/UC62: tạo đơn, chủ hộ xác nhận/từ chối, Trưởng BQL duyệt/từ chối (lưu `debtSnapshot` cho đơn `OUT`), Bảo vệ xem danh sách hôm nay & xác nhận `USED`, tra cứu biển số (`REGISTERED_VEHICLE`, `MATCHES_GATE_PASS`, `UNKNOWN`). |
| **Mới (A)** | `server/src/modules/gatePasses/gatePasses.jobs.js` | Cron job `expireGatePasses()` chạy mỗi 15 phút: chuyển đơn `AWAITING_OWNER`/`PENDING` quá giờ bắt đầu hoặc `APPROVED` qua ngày sang `EXPIRED` (idempotent). |
| **Mới (A)** | `server/src/modules/gatePasses/gatePasses.routes.js` | Định nghĩa router `/gate-passes` và `platesRouter` (`/plates/lookup`). |
| **Mới (A)** | `server/src/models/ParkingCard.js` | Model `ParkingCard` (`cardNumber` unique, `vehicleId`, `apartmentId`, `status` `ACTIVE`/`DISABLED_TO_COLLECT`/`RETURNED`/`LOST`, `issuedAt`, `issuedBy`, `disabledAt`, `collectedAt`, `collectedBy`, `note`). |
| **Mới (A)** | `server/src/modules/parkingCards/parkingCards.service.js` | Nghiệp vụ UC66: cấp thẻ trong transaction duyệt xe, vô hiệu hóa thẻ sang `DISABLED_TO_COLLECT`, thu hồi thẻ (`RETURNED` / `LOST`) có ghi audit. |
| **Mới (A)** | `server/src/modules/parkingCards/parkingCards.routes.js` | Route danh sách thẻ xe và đánh dấu đã thu hồi / báo mất cho Lễ tân & Trưởng BQL. |
| **Mới (A)** | `server/src/modules/occupantReports/occupantReports.service.js` | Nghiệp vụ UC21: truy vấn biến động nhân khẩu (`MOVE_IN` / `MOVE_OUT`) theo khoảng ngày và xuất file `.xlsx` bằng `exceljs` (CCCD đã che, có ghi audit log). |
| **Mới (A)** | `server/src/modules/residents/idCrypto.js` | Tiện ích mã hóa `encryptIdNumber` / `decryptIdNumber` (AES-256-GCM), băm `hashIdNumber` (HMAC-SHA256) và che `maskIdNumber` (`********1234`). |
| **Mới (A)** | `server/scripts/migrateResidentIdNumbers.js` | Script migrate số CCCD cũ sang `idNumberEnc` + `idNumberHash` và xóa trường rõ `idNumber`; hỗ trợ cờ `--dry-run` (không tự động chạy). |
| **Sửa (M)** | `server/src/models/Resident.js` | Thêm `idNumberEnc`, `idNumberHash` (index), cấu hình `select: false` cho trường `idNumber` cũ. |
| **Sửa (M)** | `server/src/models/Contract.js` | Thêm `remindedAt: { type: Date, default: null }` phục vụ cron nhắc hết hạn trước 15 ngày (UC19). |
| **Sửa (M)** | `server/src/modules/contracts/contracts.service.js` | Task 1: sửa `createdBy: receptionistUser.id`, truyền `{ session }` vào tham số thứ 2 của `logAudit`, bọc `terminateContract` trong `withTransaction`. Task 3: gọi `disableActiveCardsByApartment` khi chấm dứt hợp đồng. Task 5: mã hóa CCCD khi tạo hợp đồng mua bán/thuê. Task 6: reset `remindedAt = null` khi gia hạn `endDate`. |
| **Sửa (M)** | `server/src/modules/contracts/contracts.jobs.js` | Task 1: bọc từng hợp đồng trong `expireLeases` bằng `withTransaction` độc lập, truyền `{ session }` cho `logAudit`. Task 3: vô hiệu hóa thẻ xe của căn hết hạn hợp đồng. Task 6: thêm hàm `remindExpiringLeases()`. |
| **Sửa (M)** | `server/src/modules/residents/residents.service.js` | Task 1: đưa bước `User.create` vào trong `withTransaction` ở `addMember`, truyền `{ session }` cho `logAudit`. Task 5: lưu `idNumberEnc`/`idNumberHash`, trả `idNumberMasked` cho mọi API danh sách/chi tiết và thêm `revealResidentIdNumber` có ghi audit log. |
| **Sửa (M)** | `server/src/modules/residents/residents.routes.js` | Thêm `GET /residents/changes`, `GET /residents/changes/export` (UC21) và `GET /residents/:id/id-number` (Task 5). |
| **Sửa (M)** | `server/src/modules/vehicles/vehicles.routes.js` | Yêu cầu `cardNumber` bắt buộc khi duyệt xe (`PATCH /vehicles/:id/approve`). |
| **Sửa (M)** | `server/src/modules/vehicles/vehicles.service.js` | Tạo `ParkingCard` (`ACTIVE`) trong cùng transaction duyệt xe; chuyển thẻ `ACTIVE` của xe sang `DISABLED_TO_COLLECT` khi hủy xe. |

#### Frontend (`client/`)
| Trạng thái | Đường dẫn file | Mô tả thay đổi |
| :-: | :--- | :--- |
| **Mới (A)** | `client/src/api/gatePasses.api.js` | Client API cho Gate Pass và tra cứu biển số (`/gate-passes`, `/plates/lookup`). |
| **Mới (A)** | `client/src/features/gatePasses/gatePassConstants.js` | Hằng số nhãn trạng thái, màu sắc Tag và chiều vận chuyển Gate Pass. |
| **Mới (A)** | `client/src/features/gatePasses/ResidentGatePassesPage.jsx` | Màn hình Cư dân tạo đơn chuyển đồ (≥1 món đồ), xem danh sách đơn và tab Chủ hộ xác nhận/từ chối đơn của khách thuê (`AWAITING_OWNER`). |
| **Mới (A)** | `client/src/features/gatePasses/ManagerGatePassesPage.jsx` | Màn hình Trưởng BQL duyệt/từ chối đơn Gate Pass; hiển thị công nợ của căn hộ đối với đơn `OUT` ("Chưa có dữ liệu công nợ" khi `available=false`). |
| **Mới (A)** | `client/src/features/security-gate/SecurityGatePage.jsx` | Màn hình Bảo vệ (mobile-first): danh sách đơn `APPROVED` hôm nay, nút xác nhận đã qua cổng (`USED`) và công cụ tra cứu biển số xe tức thời. |
| **Mới (A)** | `client/src/features/vehicles/ParkingCardsPage.jsx` | Màn hình Lễ tân "Thẻ cần thu hồi": lọc theo trạng thái, đánh dấu Đã thu hồi (`RETURNED`) hoặc Báo mất (`LOST`). |
| **Mới (A)** | `client/src/features/residents/OccupantChangesPage.jsx` | Màn hình xem trước biến động nhân khẩu theo khoảng ngày và xuất file Excel (`.xlsx`). |
| **Sửa (M)** | `client/src/api/moduleA.api.js` | Bổ sung các hàm gọi API `parkingCards`, `getOccupantChanges`, `exportOccupantChangesExcel`, `revealResidentIdNumber`. |
| **Sửa (M)** | `client/src/features/vehicles/VehicleRequestsPage.jsx` | Mở modal nhập mã thẻ xe (`cardNumber`) bắt buộc khi Lễ tân bấm duyệt phương tiện; hiển thị mã thẻ đã cấp. |
| **Sửa (M)** | `client/src/features/apartments/ApartmentDetailPage.jsx` | Hiển thị CCCD che (`********1234`) kèm nút "Xem" gọi `GET /residents/:id/id-number` cho Lễ tân / Trưởng BQL. |
| **Sửa (M)** | `client/src/features/residents/MyApartmentPage.jsx` | Hiển thị CCCD đã che và thêm nút điều hướng nhanh sang trang Đăng ký chuyển đồ (`/r/gate-passes`). |

---

### 2.2. File Dùng chung (`CHỈ THÊM DÒNG MỚI`, `0 dòng xóa/sửa`)

Kiểm tra bằng `git diff --numstat Binh..HEAD` xác nhận **0 dòng bị xóa/sửa** trên toàn bộ các file dùng chung:

| Đường dẫn file dùng chung | Thống kê (`+thêm / -xóa`) | Chi tiết các dòng đã thêm |
| :--- | :-: | :--- |
| `server/src/constants/enums.js` | `+47 / -0` | Thêm `GATE_PASS_DIRECTIONS`, `GATE_PASS_STATUS`, `GATE_PASS_CREATOR_RELATIONS`, `PLATE_LOOKUP_RESULTS`, `PARKING_CARD_STATUS`; thêm `GATE_PASS_EXPIRE`, `CONTRACT_EXPIRY_REMIND` vào `CRON_JOBS`; thêm các mã `GATEPASS_*`, `PARKING_CARD_*`, `RESIDENT_CHANGES_EXPORTED`, `RESIDENT_ID_VIEWED` vào `AUDIT_ACTIONS`. |
| `server/src/models/index.js` | `+2 / -0` | Export thêm `GatePass` và `ParkingCard`. |
| `server/src/routes.js` | `+5 / -0` | Import và mount `/gate-passes`, `/plates`, `/parking-cards`. |
| `server/src/jobs/index.js` | `+6 / -0` | Import và đăng ký `GATE_PASS_EXPIRE` (`*/15 * * * *`) cùng `CONTRACT_EXPIRY_REMIND` (`30 0 * * *`). |
| `server/.env.example` | `+2 / -0` | Thêm biến mẫu `ID_ENCRYPTION_KEY=` cho mã hóa CCCD. |
| `client/src/config/menu.js` | `+53 / -0` | Lazy import và thêm route/menu cho `ResidentGatePassesPage` (`/r/gate-passes`), `ManagerGatePassesPage` (`/gate-passes`), `SecurityGatePage` (`/security/gate`), `ParkingCardsPage` (`/vehicles/parking-cards`), `OccupantChangesPage` (`/residents/changes`). |

---

## 3. Danh sách API Mới / Cập nhật

| Method | Path | Phân quyền (`authorize`) | Mô tả nghiệp vụ |
| :-: | :--- | :--- | :--- |
| `GET` | `/api/gate-passes` | Đã đăng nhập (`authenticate`) | Danh sách đơn Gate Pass (Cư dân chỉ thấy đơn thuộc căn mình đang active; Trưởng BQL/Lễ tân/Bảo vệ lọc theo `status`, `direction`, `apartmentId`, `from`, `to`). |
| `GET` | `/api/gate-passes/today-approved` | `STAFF:SECURITY`, `MANAGER` | Danh sách đơn `APPROVED` có `scheduledDate` trong ngày hôm nay (giờ VN) để Bảo vệ kiểm soát cổng. |
| `GET` | `/api/gate-passes/:id` | Đã đăng nhập (`authenticate`) | Chi tiết đơn Gate Pass; nếu là `MANAGER` và đơn chiều `OUT` đang `PENDING` sẽ kèm `currentDebt` từ `debtProvider`. |
| `POST` | `/api/gate-passes` | `RESIDENT` | Cư dân tạo đơn chuyển đồ (`IN`/`OUT`, thời gian ở tương lai, `items` ≥ 1). Nếu `TENANT` tạo → `AWAITING_OWNER` + thông báo chủ hộ; nếu `OWNER`/`FAMILY_MEMBER` → `PENDING`. |
| `PATCH` | `/api/gate-passes/:id/owner-decision` | `RESIDENT` (Chủ hộ active của căn) | Chủ hộ xác nhận (`approved: true` → `PENDING`) hoặc từ chối (`approved: false` → `REJECTED`) đơn `AWAITING_OWNER`. |
| `PATCH` | `/api/gate-passes/:id/approve` | `MANAGER` | Trưởng BQL duyệt đơn `PENDING` → `APPROVED` (lưu `debtSnapshot` nếu đơn `OUT`). |
| `PATCH` | `/api/gate-passes/:id/reject` | `MANAGER` | Trưởng BQL từ chối đơn `PENDING` → `REJECTED` (bắt buộc `reason`). |
| `PATCH` | `/api/gate-passes/:id/mark-used` | `STAFF:SECURITY` | Bảo vệ đánh dấu đơn `APPROVED` đúng ngày hôm nay sang `USED`. |
| `GET` | `/api/plates/lookup?plate=` | `STAFF:SECURITY`, `MANAGER` | Chuẩn hóa biển số và đối chiếu: trả `REGISTERED_VEHICLE` (xe cư dân `APPROVED`), `MATCHES_GATE_PASS` (khớp xe tải của Gate Pass `APPROVED` hôm nay) hoặc `UNKNOWN`. |
| `PATCH` | `/api/vehicles/:id/approve` | `STAFF:RECEPTIONIST`, `MANAGER` | Cập nhật: bắt buộc truyền `cardNumber` trong body, tạo `ParkingCard` (`ACTIVE`) trong cùng transaction duyệt xe. |
| `GET` | `/api/parking-cards` | `STAFF:RECEPTIONIST`, `MANAGER` | Danh sách thẻ gửi xe (mặc định lọc `status=DISABLED_TO_COLLECT` cho màn hình "Thẻ cần thu hồi"). |
| `PATCH` | `/api/parking-cards/:id/collect` | `STAFF:RECEPTIONIST`, `MANAGER` | Lễ tân đánh dấu thẻ `DISABLED_TO_COLLECT` sang `RETURNED` (đã thu hồi) hoặc `LOST` (báo mất) kèm ghi chú và audit log. |
| `GET` | `/api/residents/changes?from=&to=` | `STAFF:RECEPTIONIST`, `MANAGER` | Xem trước danh sách biến động nhân khẩu (`MOVE_IN` / `MOVE_OUT`) trong khoảng ngày, CCCD đã che. |
| `GET` | `/api/residents/changes/export?from=&to=` | `STAFF:RECEPTIONIST`, `MANAGER` | Xuất file Excel `.xlsx` biến động nhân khẩu (`exceljs`), CCCD đã che, ghi audit log `RESIDENT_CHANGES_EXPORTED`. |
| `GET` | `/api/residents/:id/id-number` | `STAFF:RECEPTIONIST`, `MANAGER` | Giải mã và trả số CCCD gốc của cư dân, đồng thời ghi audit log `RESIDENT_ID_VIEWED`. |

---

## 4. Danh sách Màn hình Mới / Cập nhật trên Frontend

1. **Cư dân – Đăng ký chuyển đồ (`/r/gate-passes` – `ResidentGatePassesPage.jsx`):**
   - Tạo đơn chuyển đồ vào/ra với danh sách đồ đạc động (`Form.List` ≥ 1 món), biển số xe tải, SĐT tài xế.
   - Tab **"Chờ chủ hộ xác nhận"** hiển thị riêng cho Chủ hộ (`OWNER`) để xác nhận hoặc từ chối đơn do khách thuê (`TENANT`) cùng căn tạo.
2. **Trưởng BQL – Duyệt chuyển đồ (`/gate-passes` – `ManagerGatePassesPage.jsx`):**
   - Bộ lọc trạng thái, chiều vào/ra; modal chi tiết đơn hiển thị rõ khối thông tin công nợ đối với đơn chuyển đồ **RA (`OUT`)** (hiển thị *"Chưa có dữ liệu công nợ"* khi `debtProvider` trả `available: false`).
3. **Bảo vệ – Kiểm soát cổng & Biển số (`/security/gate` – `SecurityGatePage.jsx`):**
   - Giao diện tối ưu cho thiết bị di động (mobile-first): ô tra cứu biển số nhanh trả kết quả tức thì (`Xe cư dân đã đăng ký` / `Khớp đơn chuyển đồ hôm nay` / `Biển số lạ`) và danh sách đơn `APPROVED` trong ngày kèm nút xác nhận **"Đã qua cổng (`USED`)"**.
4. **Lễ tân – Thẻ xe cần thu hồi (`/vehicles/parking-cards` – `ParkingCardsPage.jsx`):**
   - Hiển thị danh sách thẻ ở trạng thái `DISABLED_TO_COLLECT` (do hủy xe hoặc kết thúc/hết hạn hợp đồng), cho phép đánh dấu **Đã thu hồi (`RETURNED`)** hoặc **Báo mất (`LOST`)**.
5. **Lễ tân – Duyệt đăng ký xe (`/vehicles/requests` – `VehicleRequestsPage.jsx`):**
   - Cập nhật thao tác Duyệt: mở modal yêu cầu nhập **Mã thẻ gửi xe (`cardNumber`)** bắt buộc trước khi duyệt.
6. **Lễ tân / Trưởng BQL – Biến động nhân khẩu (`/residents/changes` – `OccupantChangesPage.jsx`):**
   - Chọn khoảng ngày (`RangePicker`), thống kê tổng biến động / chuyển đến / chuyển đi, xem trước bảng dữ liệu (CCCD đã che) và nút **Xuất Excel (`.xlsx`)**.
7. **Chi tiết căn hộ (`/apartments/:id` – `ApartmentDetailPage.jsx`):**
   - Cột CCCD mặc định hiển thị dạng che (`********1234`), có nút **"Xem"** cho Lễ tân / Trưởng BQL để gọi API xem số CCCD thật (có ghi audit log).

---

## 5. Hướng dẫn Kiểm tra Thủ công từng Task

### Task 1 – Transaction & Audit Log (`contracts`, `residents`)
1. Đăng nhập tài khoản Lễ tân (`STAFF:RECEPTIONIST`), tạo hợp đồng mới hoặc thêm cư dân mới có tạo tài khoản (`createAccount: true`).
2. Kiểm tra bảng `audit_logs`: các bản ghi `CONTRACT_CREATED`, `CONTRACT_TERMINATED`, `RESIDENT_ASSIGNED` được ghi đầy đủ trong cùng transaction.
3. Chấm dứt hợp đồng thuê (`POST /api/contracts/:id/terminate`): trạng thái hợp đồng, cư dân thuộc hợp đồng, trạng thái căn hộ và audit log đều cập nhật đồng bộ.

### Task 2 – Gate Pass & Tra cứu biển số (UC52, UC53, UC54, UC62)
1. **Khách thuê tạo đơn:** Đăng nhập tài khoản `RESIDENT` là `TENANT`, vào `/r/gate-passes`, tạo đơn chuyển đồ `OUT` vào ngày hôm nay (giờ bắt đầu ở tương lai) → đơn có trạng thái `AWAITING_OWNER`.
2. **Chủ hộ xác nhận:** Đăng nhập tài khoản `RESIDENT` là `OWNER` cùng căn, vào `/r/gate-passes` tab *"Chờ chủ hộ xác nhận"*, bấm **Xác nhận** → đơn chuyển sang `PENDING`.
3. **Trưởng BQL duyệt:** Đăng nhập `MANAGER`, vào `/gate-passes`, bấm **Chi tiết / Duyệt** đơn `OUT` → kiểm tra cảnh báo *"Chưa có dữ liệu công nợ"* (từ `debtProvider`), bấm **Phê duyệt** → đơn chuyển sang `APPROVED`.
4. **Bảo vệ kiểm soát cổng & tra biển số:** Đăng nhập `STAFF:SECURITY`, vào `/security/gate`:
   - Nhập biển số xe tải của đơn vừa duyệt vào ô tra cứu → kết quả trả về **`MATCHES_GATE_PASS`** kèm mã đơn `GP-YYYYMMDD-xxx`.
   - Nhập biển số xe cư dân đã duyệt → trả về **`REGISTERED_VEHICLE`**.
   - Bấm **"Xác nhận qua cổng"** trên đơn hôm nay → đơn chuyển sang `USED`.

### Task 3 – Thẻ gửi xe (UC66)
1. Đăng nhập Lễ tân (`STAFF:RECEPTIONIST`), vào `/vehicles/requests`, bấm **Duyệt** một yêu cầu xe `PENDING` → hệ thống yêu cầu nhập `cardNumber` (VD: `CARD-A101-01`). Sau khi duyệt, thẻ xe được tạo ở trạng thái `ACTIVE`.
2. Hủy phương tiện vừa duyệt hoặc chấm dứt hợp đồng của căn hộ đó → thẻ tự động chuyển sang `DISABLED_TO_COLLECT`.
3. Vào menu **Thẻ xe cần thu hồi** (`/vehicles/parking-cards`), bấm **Đã thu hồi** (`RETURNED`) hoặc **Báo mất** (`LOST`) → kiểm tra trạng thái thẻ cập nhật và có bản ghi trong `audit_logs`.

### Task 4 – Xuất biến động nhân khẩu (UC21)
1. Đăng nhập Lễ tân hoặc Trưởng BQL, vào menu **Biến động nhân khẩu** (`/residents/changes`).
2. Chọn khoảng ngày `from` – `to` và bấm **Xem trước** → bảng hiển thị cả lượt chuyển đến (`MOVE_IN`) và chuyển đi (`MOVE_OUT`), cột CCCD hiển thị dạng `********1234`.
3. Bấm **Xuất Excel (.xlsx)** → trình duyệt tải xuống file `.xlsx`, đồng thời tạo bản ghi `RESIDENT_CHANGES_EXPORTED` trong `audit_logs`.

### Task 5 – Che & Mã hóa CCCD (`Resident`)
1. Cấu hình `ID_ENCRYPTION_KEY` (64 ký tự hex) trong `server/.env`.
2. Tạo/cập nhật cư dân có số CCCD → kiểm tra trong MongoDB chỉ lưu `idNumberEnc` và `idNumberHash`, không lưu plaintext `idNumber`.
3. Vào trang Chi tiết căn hộ (`/apartments/:id`) bằng tài khoản Lễ tân/Trưởng BQL → cột CCCD hiển thị `********1234`. Bấm nút **Xem** → hiển thị số CCCD gốc và ghi audit log `RESIDENT_ID_VIEWED`.
4. Chạy thử script migrate ở chế độ an toàn (không ghi DB):
   ```bash
   node server/scripts/migrateResidentIdNumbers.js --dry-run
   ```

### Task 6 – Cron nhắc hết hạn hợp đồng thuê (UC19)
1. Chuẩn bị một hợp đồng `LEASE` đang `ACTIVE` có `endDate` cách ngày hiện tại đúng 15 ngày (theo múi giờ `Asia/Ho_Chi_Minh`) và `remindedAt: null`.
2. Khi job `remindExpiringLeases()` chạy (lịch `30 0 * * *`), cả `ownerId` và `tenantId` đều nhận được thông báo hệ thống, trường `remindedAt` trên hợp đồng được cập nhật thời điểm nhắc.
3. Gọi lại `remindExpiringLeases()` lần 2 trong ngày → hàm trả về `0`, không gửi trùng thông báo (idempotent).

---

## 6. Mục "Cần quyết định" (Tuân thủ Quy tắc 3 & 4)

Các điểm dưới đây có liên quan tới phạm vi của thành viên khác hoặc các file cấm sửa theo Quy tắc 4 nên đã được giữ nguyên / cô lập bằng adapter để chờ nhóm thống nhất:

1. **Tích hợp công nợ thật cho Gate Pass chiều `OUT` (liên quan Người 3 – Module `invoices/billing`):**
   - Theo Quy tắc 4, không sửa vào module `invoices/payments/billing`. Đã tạo adapter độc lập `server/src/modules/gatePasses/debtProvider.js` tạm trả `{ amount: 0, available: false }` kèm comment `TODO: thay bằng API công nợ của Người 3`. Khi Người 3 hoàn tất hàm truy vấn công nợ căn hộ, chỉ cần nối vào `debtProvider.js`.
2. **Đọc biến môi trường `ID_ENCRYPTION_KEY` (liên quan `server/src/config/env.js`):**
   - File `server/src/config/env.js` không nằm trong danh sách file dùng chung được phép sửa ở Quy tắc 3. Do đó biến `ID_ENCRYPTION_KEY` đã được khai báo trong `server/.env.example` và đọc trực tiếp qua `process.env.ID_ENCRYPTION_KEY` bên trong `server/src/modules/residents/idCrypto.js` (có fallback băm SHA-256 trên môi trường dev/test để không làm gãy ứng dụng khi chưa cấu hình `.env`).
3. **Các lời gọi `ensureCodes` (`memberCodes`) trong `contracts.service.js`, `contracts.jobs.js`, `residents.service.js`:**
   - Theo Quy tắc 4 không sửa module `memberCodes` và yêu cầu Task 6 *"Không đổi logic kết thúc hợp đồng hiện có"*, các lệnh gọi `ensureCodes` hiện hữu được giữ nguyên trong khối `try/catch` an toàn.
4. **Trường `idNumber` trong `GuestLog` (module `guests`):**
   - Quy tắc 4 cấm sửa module `guests` và Task 5 chỉ yêu cầu mã hóa trên model `Resident`. Nếu nhóm muốn áp dụng mã hóa CCCD cho cả khách vãng lai (`GuestLog`), người phụ trách module `guests` có thể tái sử dụng trực tiếp các hàm từ `server/src/modules/residents/idCrypto.js`.

---

## 7. Kết quả Kiểm tra ESLint

Đã chạy `npx eslint .` tại cả hai thư mục `server` và `client` sau từng task và sau khi hoàn tất toàn bộ 6 task:

- **`server` (`npx eslint .`):** `0 errors, 0 warnings` (Exit code `0`)
- **`client` (`npx eslint .`):** `0 errors, 0 warnings` (Exit code `0`)

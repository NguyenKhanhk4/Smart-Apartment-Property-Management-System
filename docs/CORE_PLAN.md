# Core: SAPMS

> Stack: **MongoDB Atlas + Mongoose 9 · Node.js + Express 5 · React 19 (Vite) + Ant Design 6**
> Core chỉ là **phần khung dùng chung**. Không có model hay API nghiệp vụ nào; mọi module, kể cả đăng nhập (Module 1), do từng thành viên làm trên khung này.

---

## 1. Core gồm những gì

### Backend (`server/`)

| Thành phần | File | Việc làm |
|------------|------|----------|
| Cấu hình | `src/config/env.js` | Đọc `.env`, validate bằng Joi; thiếu `MONGODB_URI` / JWT secret thì dừng ngay kèm thông báo |
| Database | `src/config/db.js` | Kết nối Atlas, cảnh báo nếu URI quên tên DB (rơi vào DB `test`) |
| App | `src/app.js`, `src/server.js` | helmet, CORS theo `CLIENT_URL`, JSON body, morgan, `/api`, Swagger, 404, error handler; tắt êm khi SIGINT/SIGTERM |
| Router gốc | `src/routes.js` | `GET /api/health` + chỗ gắn router module |
| Format response | `src/utils/response.js` | `ok()`, `created()`, `paginated()` đúng SRS 4.3 |
| Lỗi chuẩn | `src/utils/ApiError.js`, `src/constants/errorCodes.js` | Đủ mã lỗi SRS 4.2, mỗi mã có HTTP status + message tiếng Việt mặc định |
| Error handler | `src/middlewares/errorHandler.js` | Chuẩn hóa mọi lỗi (ApiError, Joi, Mongoose validation/cast, duplicate key 11000, JSON sai cú pháp) về `{ success:false, message, errorCode, details? }` |
| Xác thực | `src/middlewares/auth.js` | `authenticate`: đọc `Authorization: Bearer <token>`, verify JWT, gắn `req.user = { id, role, roleTitle }` |
| Phân quyền | `src/middlewares/authorize.js` | `authorize('ADMIN', 'STAFF:ACCOUNTANT')`, hỗ trợ role + roleTitle; gõ sai spec thì lỗi ngay lúc khởi động |
| Validate | `src/middlewares/validate.js` | `validate({ body, query, params })` bằng Joi, message tiếng Việt, bỏ field lạ |
| Phân trang | `src/utils/pagination.js` | `paginationQuery` (Joi), `paginate(Model, filter, query)` → `{ items, pagination }` |
| API docs | `src/config/swagger.js` | `/api-docs` (UI) và `/api-docs.json`, quét comment `@openapi` trong `routes.js` và `modules/**/*.routes.js` |
| Test | `tests/core.test.js` | 18 test: health, 404, JSON lỗi, authenticate, authorize, validate, format lỗi |

### Frontend (`client/`)

| Thành phần | File | Việc làm |
|------------|------|----------|
| HTTP client | `src/api/axiosClient.js` | Tự gắn header `Authorization`; gặp 401 thì gọi refresh **một lần** cho mọi request đang chờ rồi gửi lại; refresh thất bại thì xóa phiên, về `/login`; lỗi chuẩn hóa thành `ApiError { status, message, errorCode, details }` |
| Phiên đăng nhập | `src/contexts/AuthProvider.jsx`, `src/hooks/useAuth.js`, `src/utils/authStorage.js` | Lưu token + user ở localStorage; `startSession()`, `logout()`, `updateUser()`, `hasRole()` |
| Phân quyền UI | `src/utils/permission.js` | Cùng ngữ nghĩa với `authorize()` backend |
| Router | `src/routes/AppRouter.jsx`, `guards.jsx`, `roleHome.js` | `/login` (chỗ cho Module 1), `/app/*` cho ADMIN/STAFF/BOARD, `/r/*` cho RESIDENT, trang 403/404 |
| Menu + route | `src/config/menu.js` | **Nguồn duy nhất**: thêm một phần tử là có cả menu lẫn route, kèm kiểm tra quyền |
| Layout | `src/layouts/` | `AuthLayout`, `AdminLayout` (sidebar thu gọn được, responsive), `ResidentLayout` (mobile-first, bottom nav) |
| Khác | `src/components/`, `src/constants/` | `UserMenu` (đăng xuất), `PlaceholderPage`, `PageLoader`; nhãn role tiếng Việt; thông báo lỗi theo `errorCode` |

---

## 2. Hợp đồng mà Module 1 (Auth, thành viên A) phải tuân theo

Core đã dựng sẵn phía đọc token; phía phát token là việc của Module 1.

1. **Payload access token** ký bằng `env.jwt.accessSecret`:
   ```js
   { sub: user._id, role: 'RESIDENT' | 'STAFF' | 'BOARD' | 'ADMIN', roleTitle: 'ACCOUNTANT' | ... | null }
   ```
2. **Refresh:** `POST /api/auth/refresh`, body `{ refreshToken }`, trả `{ success: true, data: { accessToken, refreshToken } }` (axios client đã gọi đúng như vậy).
3. **Lỗi token** trả `401` với `errorCode: 'UNAUTHORIZED'`; client chỉ tự refresh khi gặp đúng mã này.
4. **Sau khi login thành công ở FE:** gọi `startSession({ user, accessToken, refreshToken })` từ `useAuth()`, rồi `navigate(roleHome(user))`.
5. **Trang login:** thay `PlaceholderPage` ở route `/login` trong `src/routes/AppRouter.jsx` bằng trang thật.
6. Refresh token lưu ở localStorage (đã chốt). Gợi ý để logout/đổi mật khẩu thu hồi được token cũ: thêm `tokenVersion` vào user, nhúng vào token và so khớp khi refresh.

---

## 3. Cách thêm một module

### Backend

```
server/src/models/Building.js                 # model (collection đặt đúng tên SRS: { collection: 'buildings' })
server/src/modules/buildings/
  ├── buildings.routes.js       # route + comment @openapi + authenticate/authorize/validate
  ├── buildings.controller.js   # đọc req.validated, gọi service, trả ok()/created()/paginated()
  ├── buildings.service.js      # nghiệp vụ; lỗi thì throw new ApiError('MÃ_LỖI')
  └── buildings.validation.js   # Joi schema
```

Rồi thêm **một dòng** vào `server/src/routes.js`: `router.use('/buildings', buildingRoutes);`

```js
// buildings.routes.js — ví dụ
const router = Router();
router.use(authenticate);
router.get('/', authorize('STAFF'), validate({ query: listQuery }), controller.list);
router.post('/', authorize('ADMIN'), validate({ body: createBody }), controller.create);
export default router;

// buildings.controller.js
export async function list(req, res) {
  const { items, pagination } = await service.list(req.validated.query);
  return paginated(res, items, pagination);
}
```

- Express 5 tự chuyển lỗi của hàm `async` sang error handler, **không cần try/catch** trong controller.
- Controller đọc input đã validate từ `req.validated.body | query | params`.
- Mã lỗi nghiệp vụ mới: thêm vào `src/constants/errorCodes.js` (BE) và `src/constants/errorMessages.js` (FE).

### Frontend

```
client/src/api/buildings.api.js               # http.get('/buildings', { params }) ...
client/src/features/buildings/BuildingListPage.jsx
```

Rồi thêm **một phần tử** vào `client/src/config/menu.js` (có ví dụ ngay đầu file). Không sửa file router.

- Gọi API qua `http.get/post/patch/put/delete` (trả nguyên envelope `{ success, data, pagination? }`).
- Hiện lỗi: `catch (err) { message.error(err.message) }`, với `message` lấy từ `App.useApp()`; lỗi form có `err.details` dạng `[{ field, message }]`.
- Kiểm tra quyền trong trang: `const { hasRole } = useAuth(); hasRole('STAFF:ACCOUNTANT')`.

### Quy tắc chung

- Mỗi người chỉ sửa trong thư mục module của mình. File dùng chung (`middlewares/`, `utils/`, `constants/`, `config/`, `layouts/`) sửa qua PR riêng và báo cả team.
- Chạy `npm run lint` và `npm test` trước khi mở PR.

---

## 4. Kết nối MongoDB Atlas

- Đã kiểm tra: cluster `cluster0.35xugwt` kết nối được; server dev dùng database `sapms_dev`.
- URI chỉ nằm trong `server/.env` (đã có trong `.gitignore`). Chia sẻ cho team qua kênh riêng.
- **Mỗi thành viên nên dùng database riêng** khi dev (`sapms_dev_a`, `sapms_dev_b`...), chỉ cần đổi phần tên DB trong URI.
- Atlas → *Network Access*: thêm IP từng người, hoặc `0.0.0.0/0` (cần khi deploy Render).
- ⚠️ Mật khẩu DB đã bị dán dạng văn bản thường trong lúc trao đổi; nên đổi mật khẩu user này trên Atlas (*Database Access*) rồi cập nhật lại `.env`.

---

## 5. Điểm SRS chưa nhất quán (cần team chốt khi làm module)

| # | Vấn đề | Đề xuất |
|---|--------|---------|
| 1 | Ví dụ format lỗi (4.3) dùng `INVALID_INPUT`, không có trong danh sách 4.2 | Dùng `VALIDATION_ERROR` (core đã làm vậy) |
| 2 | Thiếu API logout, xem hồ sơ, đổi mật khẩu dù UC-A02, UC-A03 có | Module 1 bổ sung `POST /auth/logout`, `GET /users/me`, `PATCH /users/me/password` |
| 3 | `POST /auth/refresh` ghi quyền "authenticated", nhưng lúc gọi thì access token đã hết hạn | Để public, xác thực bằng refresh token |
| 4 | NFR-02 chỉ miễn JWT cho login/register | Miễn thêm cho refresh và VNPay IPN (IPN xác thực bằng chữ ký HMAC) |
| 5 | API ghi quyền `ACCOUNTANT`, `TECHNICIAN`, `SECURITY` như role | Đây là roleTitle; dùng `authorize('STAFF:ACCOUNTANT')` (core đã hỗ trợ) |
| 6 | Pseudocode bậc thang dùng `tier.to - tier.from`, nhưng bậc cuối không có trần | Coi `to = null` là vô hạn |
| 7 | Căn hộ mới chưa có chỉ số tháng trước để tính tiêu thụ | Module B chốt "chỉ số đầu kỳ" |
| 8 | UC tạm trú/tạm vắng bị bỏ ở mục 6 nhưng collection và API vẫn còn | Làm nếu dư thời gian |
| 9 | Ticket có `ASSIGNED` trong data model, mô tả module 6 thì không | Theo data model |
| 10 | Render free tự ngủ, cron có thể lỡ giờ | Module làm cron thêm endpoint chạy job thủ công cho Admin |
| 11 | Số collection | SRS mục 10 có **26** collection |

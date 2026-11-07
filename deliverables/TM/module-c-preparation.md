# Module C — chuẩn bị và audit (SCRUM-67, SCRUM-45)

## Phạm vi PR
- Tra cứu audit log ở /app/audit-logs và GET /api/audit-logs.
- Bộ lọc action, ngày theo giờ Việt Nam, người thực hiện, đối tượng và phân trang.
- GET /api/audit-logs/options chỉ trả các lựa chọn phù hợp quyền.
- Không thay đổi API logAudit, schema AuditLog hoặc nghiệp vụ ghi thu/chi quỹ.
- Giữ module /fund và các action quỹ mới đang có trên main.

## Quyền
- MANAGER: xem audit toàn hệ thống; thông tin nhạy cảm trong metadata vẫn được che.
- BOARD: chỉ xem allowlist tài chính và thay đổi cấu hình quỹ; không thấy IP.
- Các vai trò khác không truy cập API hoặc trang audit.
- Chỉ tra cứu: không có API tạo/sửa/xóa audit. Các module tiếp tục ghi log qua service đang có.

## Điểm hỏi nhóm khi review
1. Khánh + Lượng: rà allowlist action tài chính và trường metadata BQT cần đọc.
2. Việt: xác nhận quyền màn audit cho MANAGER/BOARD.
3. Khánh: thu quỹ local sẽ tích hợp vào /fund ở PR riêng; không đưa endpoint thu quỹ song song vào PR này.

## Kiểm tra
- Server: npm run lint; npm test (Node 22, MongoMemoryReplSet riêng, không truy cập MONGODB_URI thật).
- Client: npm run lint; npm test; npm run build.
- Cache cục bộ được ignore bằng .cache/. Có thể đặt MONGOMS_SYSTEM_BINARY vào binary MongoDB cục bộ để tránh tải lại.
- Không commit .env, node_modules, cache hoặc dữ liệu thật.

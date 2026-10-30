// Nạp trước mọi file test (node --import): chạy ở chế độ test để config/env.js không đòi MONGODB_URI
// và không bật cron. Test chỉ dùng logic thuần + validateSync của Mongoose, không kết nối DB.
process.env.NODE_ENV = 'test';

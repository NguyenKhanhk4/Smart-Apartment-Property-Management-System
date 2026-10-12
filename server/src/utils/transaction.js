import mongoose from 'mongoose';

let warned = false;

// MongoDB standalone (thường gặp khi dev cục bộ) không hỗ trợ transaction. Driver báo theo 2 kiểu:
// lỗi gốc code 20 "Transaction numbers are only allowed on a replica set…", hoặc (retryWrites mặc định bật)
// "This MongoDB deployment does not support retryable writes…" với code nằm trong originalError.
const isTransactionUnsupported = (err) =>
  [err?.code, err?.originalError?.code].includes(20) ||
  /Transaction numbers are only allowed on a replica set|does not support retryable writes/i.test(err?.message ?? '');

/**
 * Chạy `fn(session)` trong 1 MongoDB transaction (session.withTransaction: tự retry khi lỗi tạm thời).
 * Mọi thao tác ghi trong `fn` phải truyền `{ session }`.
 *
 * MongoDB standalone không có transaction → chạy `fn(null)` không transaction (thao tác ghi tuần tự,
 * không còn tính nguyên tử) và console.warn 1 lần. Production nên dùng replica set (Atlas luôn là replica set).
 *
 * Gửi thông báo / email SAU khi hàm này trả về, không đặt trong `fn`
 * (transaction có thể bị chạy lại, thông báo sẽ bị gửi nhiều lần).
 *
 * @example
 *   const result = await withTransaction(async (session) => {
 *     await A.updateOne({ _id }, { ... }, { session });
 *     await B.updateOne({ _id }, { ... }, { session });
 *     return 'xong';
 *   });
 */
export async function withTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (err) {
    if (!isTransactionUnsupported(err)) throw err;
    if (!warned) {
      warned = true;
      console.warn('[transaction] MongoDB không phải replica set → chạy không transaction (chỉ nên dùng khi dev)');
    }
    // Lỗi này phát sinh ở thao tác đầu tiên dùng session, trước khi có gì được ghi → chạy lại an toàn
    return fn(null);
  } finally {
    await session.endSession();
  }
}

/**
 * Chạy `fn(item, index)` cho từng phần tử, tối đa `limit` việc cùng lúc; kết quả giữ đúng thứ tự `items`.
 * Dùng cho vòng lặp mỗi phần tử vài truy vấn DB (vd tính phí từng căn): chạy tuần tự thì cộng dồn độ trễ mạng,
 * chạy hết một lúc thì dồn quá nhiều truy vấn vào connection pool.
 * `fn` nên tự bắt lỗi của từng phần tử; lỗi không bắt sẽ làm cả hàm reject (các việc đang chạy vẫn chạy nốt).
 */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

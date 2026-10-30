/**
 * Body lỗi của response: request tải file (responseType 'blob') nhận lỗi dưới dạng Blob → đọc text rồi parse JSON
 * để vẫn lấy được `message` / `errorCode` của server. Không phải JSON thì trả null.
 */
export async function readErrorPayload(data) {
  if (typeof Blob === 'undefined' || !(data instanceof Blob)) return data;
  try {
    return JSON.parse(await data.text());
  } catch {
    return null;
  }
}

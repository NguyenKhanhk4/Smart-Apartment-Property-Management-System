/** Lấy File gốc từ fileList của antd <Upload> để gửi multipart (field `images`) */
export const toFiles = (fileList = []) => fileList.map((f) => f.originFileObj).filter(Boolean);

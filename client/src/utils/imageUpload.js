// UC63: chuẩn bị ảnh trước khi gửi lên server.
// Người dùng chụp / chọn ảnh bất kỳ định dạng trình duyệt đọc được (WebP, HEIC trên Safari, ảnh chụp 8–50MP...).
// Trình duyệt vẽ lại thành JPEG, thu nhỏ cạnh dài về MAX_DIMENSION. Server vẫn chỉ nhận jpg/png (NFR-10) và kiểm tra
// chữ ký file + dung lượng theo tham số UPLOAD_MAX_SIZE_MB, nên ảnh không chuyển được vẫn bị server chặn rõ ràng.
// Việc chuyển chạy tự động trong axiosClient cho mọi FormData; các trang chỉ dùng checkImageFile lúc chọn ảnh.

export const IMAGE_ACCEPT = 'image/*';
/** Ảnh gốc tối đa (trước khi thu nhỏ). Chặn file quá lớn làm treo trình duyệt điện thoại */
export const MAX_SOURCE_MB = 30;
export const MAX_DIMENSION = 2000; // px, cạnh dài; đủ nét để xem bằng chứng sự cố, biển số, chữ ký
export const JPEG_QUALITY = 0.85;
/** Ảnh jpg/png nhỏ hơn mức này và không quá MAX_DIMENSION thì gửi nguyên, không vẽ lại */
const KEEP_ORIGINAL_BYTES = 1.5 * 1024 * 1024;
export const IMAGE_HINT = 'Ảnh chụp hoặc ảnh có sẵn (jpg, png, webp, heic...), tự thu nhỏ trước khi gửi';

const MB = 1024 * 1024;
const isImage = (file) => Boolean(file?.type?.startsWith('image/'));
const isJpegOrPng = (file) => file?.type === 'image/jpeg' || file?.type === 'image/png';

/** Kiểm tra lúc chọn ảnh. Trả câu báo lỗi (có tên file) hoặc null nếu hợp lệ */
export function checkImageFile(file) {
  if (!isImage(file)) return `"${file?.name}" không phải ảnh`;
  if (file.size > MAX_SOURCE_MB * MB) return `"${file.name}" quá lớn (tối đa ${MAX_SOURCE_MB}MB)`;
  return null;
}

/** Kích thước sau khi thu nhỏ, giữ tỷ lệ; ảnh nhỏ hơn giới hạn giữ nguyên */
export function scaledSize(width, height, max = MAX_DIMENSION) {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const ratio = max / longest;
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

/** Có cần vẽ lại không: khác jpg/png, hoặc nặng, hoặc quá lớn về kích thước */
export function needsProcessing({ type, size, width, height }) {
  if (type !== 'image/jpeg' && type !== 'image/png') return true;
  return size > KEEP_ORIGINAL_BYTES || Math.max(width, height) > MAX_DIMENSION;
}

export const jpegName = (name = 'anh') => `${name.replace(/\.[^.]+$/, '') || 'anh'}.jpg`;

async function decode(file) {
  // imageOrientation: xoay đúng chiều theo EXIF (ảnh dọc chụp bằng điện thoại)
  if (typeof createImageBitmap === 'function') return createImageBitmap(file, { imageOrientation: 'from-image' });
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Ảnh → JPEG đã thu nhỏ (bỏ EXIF, kể cả vị trí GPS). Không phải ảnh, ảnh jpg/png nhỏ, hoặc trình duyệt không đọc được
 * (vd HEIC trên Chrome) thì trả lại file gốc để server kiểm tra.
 */
export async function prepareImage(file) {
  if (!isImage(file) || typeof document === 'undefined') return file;
  let bitmap;
  try {
    bitmap = await decode(file);
  } catch {
    return file;
  }
  const width = bitmap.width;
  const height = bitmap.height;
  if (!needsProcessing({ type: file.type, size: file.size, width, height })) {
    bitmap.close?.();
    return file;
  }
  const size = scaledSize(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // ảnh png trong suốt → nền trắng, không bị đen khi sang JPEG
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) return file;
  // Ảnh jpg/png đã nhỏ mà vẽ lại còn nặng hơn thì giữ bản gốc
  if (isJpegOrPng(file) && blob.size >= file.size && Math.max(width, height) <= MAX_DIMENSION) return file;
  return new File([blob], jpegName(file.name), { type: 'image/jpeg', lastModified: Date.now() });
}

/** FormData mới với mọi ảnh đã chuẩn bị; FormData không có ảnh thì trả lại nguyên bản */
export async function prepareFormData(formData) {
  const entries = [...formData.entries()];
  if (!entries.some(([, v]) => v instanceof Blob && isImage(v))) return formData;
  const next = new FormData();
  for (const [key, value] of entries) {
    if (value instanceof Blob && isImage(value)) {
      const prepared = await prepareImage(value);
      next.append(key, prepared, prepared.name ?? value.name);
    } else {
      next.append(key, value);
    }
  }
  return next;
}

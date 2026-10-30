import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';
import { CONFIG_KEYS } from '../constants/enums.js';
import { ApiError } from '../utils/ApiError.js';
import { getConfig } from './systemConfig.service.js';

// NFR-10: chỉ jpg/png; dung lượng tối đa theo tham số UPLOAD_MAX_SIZE_MB (Admin sửa, mặc định 5MB).
// Multer chặn cứng ở HARD_MAX_MB để không đọc file quá lớn vào RAM; giới hạn theo cấu hình kiểm tra ngay sau đó.
const MB = 1024 * 1024;
const HARD_MAX_MB = 20;
const MAX_FILE_SIZE = HARD_MAX_MB * MB;

async function maxUploadMb() {
  const value = Number(await getConfig(CONFIG_KEYS.UPLOAD_MAX_SIZE_MB));
  return Number.isFinite(value) && value > 0 ? Math.min(value, HARD_MAX_MB) : 5;
}
const ALLOWED_TYPES = ['image/jpeg', 'image/png'];

if (env.cloudinary.enabled) {
  cloudinary.config({
    cloud_name: env.cloudinary.cloudName,
    api_key: env.cloudinary.apiKey,
    api_secret: env.cloudinary.apiSecret,
    secure: true,
  });
}

const multerInstance = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) return cb(null, true);
    return cb(ApiError.badRequest(`Ảnh "${file.originalname}" sai định dạng, chỉ nhận jpg/png`));
  },
});

// Chữ ký (magic bytes) đầu file — mimetype do client khai báo, có thể giả mạo
const SIGNATURES = [
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

/** Kiểm tra nội dung buffer thực sự là jpg/png (không tin mimetype client gửi). */
export function isImageBuffer(buffer) {
  if (!buffer || !buffer.length) return false;
  return SIGNATURES.some(({ bytes }) => bytes.every((b, i) => buffer[i] === b));
}

/**
 * Middleware nhận nhiều ảnh multipart ở field `fieldName` (giữ trong RAM, upload lên Cloudinary ở service).
 * @example router.post('/', authenticate, uploadImages('images', 5), controller.create)
 */
export function uploadImages(fieldName = 'images', maxCount = 5) {
  const handler = multerInstance.array(fieldName, maxCount);
  return (req, res, next) =>
    handler(req, res, (err) => {
      if (!err) {
        const fake = (req.files ?? []).find((f) => !isImageBuffer(f.buffer));
        if (fake) {
          return next(ApiError.badRequest(`Ảnh "${fake.originalname}" không phải file jpg/png hợp lệ`));
        }
        if (!req.files?.length) return next();
        return maxUploadMb()
          .then((maxMb) => {
            const big = req.files.find((f) => f.size > maxMb * MB);
            next(big ? ApiError.badRequest(`Ảnh "${big.originalname}" vượt quá ${maxMb}MB`) : undefined);
          })
          .catch(next);
      }
      if (err instanceof multer.MulterError) {
        const message =
          err.code === 'LIMIT_FILE_SIZE'
            ? `Ảnh vượt quá ${HARD_MAX_MB}MB`
            : err.code === 'LIMIT_UNEXPECTED_FILE'
              ? `Tối đa ${maxCount} ảnh`
              : err.message;
        return next(ApiError.badRequest(message));
      }
      return next(err);
    });
}

function uploadBuffer(file, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: `sapms/${folder}`, resource_type: 'image' },
      (err, result) => (err ? reject(err) : resolve(result.secure_url)),
    );
    stream.end(file.buffer);
  });
}

/** Upload các file của multer lên Cloudinary, trả về mảng URL. */
export async function uploadToCloudinary(files = [], folder = 'misc') {
  if (!files.length) return [];
  if (!env.cloudinary.enabled) {
    throw new ApiError(
      'SERVER_ERROR',
      'Chưa cấu hình Cloudinary (CLOUDINARY_* trong server/.env) nên chưa upload được ảnh',
    );
  }
  try {
    return await Promise.all(files.map((f) => uploadBuffer(f, folder)));
  } catch (err) {
    // Không trả nguyên văn lỗi Cloudinary cho client (có thể lộ cấu hình); ghi log để tra cứu
    console.error('[upload] Cloudinary lỗi:', err);
    throw new ApiError('SERVER_ERROR', 'Upload ảnh thất bại, vui lòng thử lại sau');
  }
}

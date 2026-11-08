import { randomBytes } from 'node:crypto';
import { ASSET_CATEGORIES, CYCLE_UNITS, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

/** Giá trị mã QR dán trên thiết bị (BR-E01): ngẫu nhiên, không đoán được từ mã thiết bị, không đổi sau khi tạo */
export const newQrCode = () => `EQ-${randomBytes(9).toString('base64url').toUpperCase()}`;

// Một mục của mẫu checklist (BR-E02): có đơn vị / khoảng cho phép thì là mục đo, không có thì là mục tick
const checklistItemSchema = new Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 200 },
    unit: { type: String, trim: true, maxlength: 20, default: null }, // vd 'V', 'bar', '°C'
    minValue: { type: Number, default: null },
    maxValue: { type: Number, default: null },
    required: { type: Boolean, default: true },
  },
  { _id: false },
);

// assets — thiết bị (UC07). Không xóa cứng, chỉ ngừng theo dõi (BR-O17).
const assetSchema = new Schema(
  {
    buildingId: { type: ObjectId, ref: 'Building', required: true },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 30 }, // BR-E01, duy nhất (MSG-E01)
    qrCode: { type: String, required: true, default: newQrCode, immutable: true }, // BR-E01: cố định, in dán lên thiết bị
    name: { type: String, required: true, trim: true, maxlength: 150 },
    category: { type: String, enum: values(ASSET_CATEGORIES), required: true },
    location: { type: String, trim: true, maxlength: 200 },
    manufacturer: { type: String, trim: true, maxlength: 150, default: null },
    installDate: { type: Date, default: null },
    warrantyEnd: { type: Date, default: null },
    vendorName: { type: String, trim: true, maxlength: 150, default: null }, // nhà cung cấp / bảo trì, chỉ lưu thông tin
    vendorPhone: { type: String, trim: true, maxlength: 30, default: null },
    // BR-E02: chu kỳ bảo trì = cycleValue × cycleUnit (vd 1 tháng, 1 quý, 30 ngày)
    cycleValue: { type: Number, required: true, min: 1, max: 3650 },
    cycleUnit: { type: String, enum: values(CYCLE_UNITS), required: true },
    checklist: { type: [checklistItemSchema], default: [] }, // mẫu checklist; phiếu bảo trì lưu bản sao lúc tạo
    lastMaintenanceDate: { type: Date, default: null },
    nextMaintenanceDate: { type: Date, required: true }, // = last + chu kỳ (BR-O18)
    isActive: { type: Boolean, default: true },
    note: { type: String, trim: true, maxlength: 1000 },
    createdBy: { type: ObjectId, ref: 'User', default: null },
  },
  schemaOptions('assets'),
);

assetSchema.index({ code: 1 }, { name: 'uniq_asset_code', unique: true }); // MSG-E01
assetSchema.index({ qrCode: 1 }, { name: 'uniq_asset_qr', unique: true }); // tra thiết bị khi quét QR (UC08)
assetSchema.index({ isActive: 1, nextMaintenanceDate: 1 }); // job tạo phiếu bảo trì (BR-E03)
assetSchema.index({ isActive: 1, warrantyEnd: 1 }); // job cảnh báo bảo hành (BR-E07)
assetSchema.index({ buildingId: 1, category: 1 });

export const Asset = model('Asset', assetSchema);

import { ASSET_CATEGORIES, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// assets — tài sản chung (UC-D01). Không xóa cứng, chỉ ngừng theo dõi (BR-O17).
const assetSchema = new Schema(
  {
    buildingId: { type: ObjectId, ref: 'Building', required: true },
    name: { type: String, required: true, trim: true, maxlength: 150 },
    category: { type: String, enum: values(ASSET_CATEGORIES), required: true },
    location: { type: String, trim: true, maxlength: 200 },
    maintenanceCycleDays: { type: Number, required: true, min: 1 },
    lastMaintenanceDate: { type: Date, default: null },
    nextMaintenanceDate: { type: Date, required: true }, // = last + cycle (BR-O18)
    isActive: { type: Boolean, default: true },
    note: { type: String, trim: true, maxlength: 1000 },
    createdBy: { type: ObjectId, ref: 'User', default: null },
  },
  schemaOptions('assets'),
);

// BR-O17: tên tài sản duy nhất trong cùng tòa (không phân biệt hoa thường)
assetSchema.index(
  { buildingId: 1, name: 1 },
  { name: 'uniq_building_asset_name', unique: true, collation: { locale: 'vi', strength: 2 } },
);
assetSchema.index({ isActive: 1, nextMaintenanceDate: 1 }); // cron 02:00 (UC-D02)
assetSchema.index({ buildingId: 1, category: 1 });

export const Asset = model('Asset', assetSchema);

// collection_settings — lịch sử công tắc thu hộ điện/nước (UC05)
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

const collectionSettingSchema = new Schema(
  {
    utility: { type: String, enum: ['ELECTRICITY', 'WATER'], required: true },
    enabled: { type: Boolean, required: true },
    waterQuotaPerOccupant: { type: Number, default: null }, // m³/người/tháng; chỉ nước
    fromPeriod: { type: String, required: true }, // 'YYYY-MM' — hiệu lực từ kỳ này
    createdBy: { type: ObjectId, ref: 'User' },
  },
  schemaOptions('collection_settings'),
);

// Chỉ 1 trạng thái mỗi utility mỗi kỳ
collectionSettingSchema.index({ utility: 1, fromPeriod: 1 }, { unique: true });

export const CollectionSetting = model('CollectionSetting', collectionSettingSchema);


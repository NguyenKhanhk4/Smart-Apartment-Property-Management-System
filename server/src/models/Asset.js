import { ASSET_CATEGORIES, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// assets — tài sản chung (UC-D01)
const assetSchema = new Schema(
  {
    buildingId: { type: ObjectId, ref: 'Building', required: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, enum: values(ASSET_CATEGORIES), required: true },
    location: String,
    maintenanceCycleDays: { type: Number, required: true, min: 1 },
    lastMaintenanceDate: Date,
    nextMaintenanceDate: Date, // = last + cycle
    isActive: { type: Boolean, default: true },
  },
  schemaOptions('assets'),
);

assetSchema.index({ nextMaintenanceDate: 1, isActive: 1 }); // cron 02:00 (UC-D02)
assetSchema.index({ buildingId: 1, category: 1 });

export const Asset = model('Asset', assetSchema);

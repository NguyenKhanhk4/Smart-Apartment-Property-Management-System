import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// maintenance_fund — sổ quỹ bảo trì (buildingId null = quỹ chung toàn khu)
const maintenanceFundSchema = new Schema(
  {
    buildingId: { type: ObjectId, ref: 'Building', default: null },
    name: { type: String, default: 'Quỹ bảo trì chung' },
    balance: { type: Number, required: true, default: 0, min: 0 }, // BR-M3
  },
  schemaOptions('maintenance_fund'),
);

maintenanceFundSchema.index({ buildingId: 1 }, { unique: true });

export const MaintenanceFund = model('MaintenanceFund', maintenanceFundSchema);

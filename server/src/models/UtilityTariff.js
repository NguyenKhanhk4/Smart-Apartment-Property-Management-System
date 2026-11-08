// utility_tariffs — biểu giá điện/nước bậc thang theo thời gian (UC05)
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

const tierSchema = new Schema(
  {
    upTo: { type: Number, default: null }, // null = bậc cuối "trở lên"; đơn vị kWh hoặc m³
    unitPrice: { type: Number, required: true, min: 0 }, // VNĐ/đơn vị
  },
  { _id: false },
);

const utilityTariffSchema = new Schema(
  {
    utility: { type: String, enum: ['ELECTRICITY', 'WATER'], required: true },
    fromPeriod: { type: String, required: true }, // 'YYYY-MM'
    toPeriod: { type: String, default: null },     // null = đang hiệu lực
    tiers: { type: [tierSchema], required: true },
    perOccupant: { type: Boolean, default: false }, // chỉ nước: upTo hiểu là định mức/người
    createdBy: { type: ObjectId, ref: 'User' },
  },
  schemaOptions('utility_tariffs'),
);

utilityTariffSchema.index({ utility: 1, fromPeriod: 1 }, { unique: true });

export const UtilityTariff = model('UtilityTariff', utilityTariffSchema);


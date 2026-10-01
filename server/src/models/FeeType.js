import { FEE_CALC_METHODS, FEE_CATEGORIES, VEHICLE_TYPES, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// fee_types — danh mục phí & đơn giá theo thời gian (UC-B01)
// Mỗi bản ghi là 1 mức giá hiệu lực [effectiveFrom, effectiveTo); cùng code không chồng lấn (BR-F12, check ở service).
const feeTypeSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true }, // CLEANING, PARKING_MOTORBIKE...
    name: { type: String, required: true },
    feeCategory: {
      type: String,
      enum: values(FEE_CATEGORIES).filter((c) => c !== FEE_CATEGORIES.ADJUSTMENT),
      required: true,
    },
    calcMethod: { type: String, enum: values(FEE_CALC_METHODS), required: true },
    vehicleType: { type: String, enum: [...values(VEHICLE_TYPES), null], default: null },
    unitPrice: { type: Number, required: true, min: 0 }, // VNĐ
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date, default: null }, // null = đang hiệu lực
    createdBy: { type: ObjectId, ref: 'User' },
  },
  schemaOptions('fee_types'),
);

// Không unique theo code vì cùng code có nhiều mức giá theo thời gian
feeTypeSchema.index({ code: 1, effectiveFrom: 1 }, { unique: true });

export const FeeType = model('FeeType', feeTypeSchema);

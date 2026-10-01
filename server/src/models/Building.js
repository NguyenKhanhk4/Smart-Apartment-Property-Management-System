import { Schema, model, schemaOptions } from './_shared.js';

// buildings — tòa/block
const buildingSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true }, // vd "A" — dùng trong mã hóa đơn
    name: { type: String, required: true, unique: true, trim: true },
    address: String,
    totalFloors: { type: Number, min: 1 },
  },
  schemaOptions('buildings'),
);

export const Building = model('Building', buildingSchema);

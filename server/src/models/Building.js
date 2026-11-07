import { Schema, model, schemaOptions } from './_shared.js';

const blockSchema = new Schema({
  code: { type: String, required: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
});

// buildings — tòa nhà và các block trực thuộc
const buildingSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true }, // vd "A" — dùng trong mã hóa đơn
    name: { type: String, required: true, unique: true, trim: true },
    address: String,
    blocks: { type: [blockSchema], default: undefined },
    totalFloors: { type: Number, min: 1 },
  },
  schemaOptions('buildings'),
);

export const Building = model('Building', buildingSchema);

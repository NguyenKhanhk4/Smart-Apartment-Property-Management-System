import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

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
    // Không có confirmedAt: dữ liệu cũ cần đối chiếu, vẫn giữ liên kết và nghiệp vụ đang chạy.
    inventorySource: { type: String, trim: true, maxlength: 500 },
    floorInventory: { type: [{ floor: Number, expectedCount: Number, _id: false }], default: undefined },
    inventoryConfirmedAt: Date,
    inventoryConfirmedBy: { type: ObjectId, ref: 'User' },
    inventoryRevision: { type: Number, default: 0 },
  },
  schemaOptions('buildings'),
);

export const Building = model('Building', buildingSchema);

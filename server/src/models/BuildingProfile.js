// building_profile — thông tin tòa nhà singleton (UC05). Chỉ 1 bản ghi.
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

const buildingProfileSchema = new Schema(
  {
    name: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    taxCode: { type: String, trim: true, default: '' }, // 10 chữ số hoặc 13 chữ số dạng xxxxxxxxxx-xxx
    bankName: { type: String, trim: true, default: '' },
    bankAccountNo: { type: String, trim: true, default: '' }, // chỉ chữ số
    bankAccountName: { type: String, trim: true, default: '' },
    logoUrl: { type: String, default: '' },
    updatedBy: { type: ObjectId, ref: 'User', default: null },
  },
  schemaOptions('building_profile'),
);

export const BuildingProfile = model('BuildingProfile', buildingProfileSchema);


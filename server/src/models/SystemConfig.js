import { CONFIG_SCOPES, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// system_configs — tham số hệ thống, Trưởng BQL sửa. scope chỉ để phân nhóm: BUSINESS / TECHNICAL
const systemConfigSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, uppercase: true },
    value: { type: Schema.Types.Mixed, required: true },
    scope: { type: String, enum: values(CONFIG_SCOPES), required: true },
    description: String,
    updatedBy: { type: ObjectId, ref: 'User', default: null },
    // BR-S12: khóa thuộc BOARD_CONFIRM_CONFIG_KEYS — giá trị mới chờ Ban quản trị xác nhận, value giữ nguyên tới lúc đó
    pendingValue: { type: Schema.Types.Mixed, default: null },
    pendingBy: { type: ObjectId, ref: 'User', default: null },
    pendingAt: { type: Date, default: null },
    confirmedBy: { type: ObjectId, ref: 'User', default: null },
    confirmedAt: { type: Date, default: null },
  },
  schemaOptions('system_configs'),
);

systemConfigSchema.index({ scope: 1 });

export const SystemConfig = model('SystemConfig', systemConfigSchema);

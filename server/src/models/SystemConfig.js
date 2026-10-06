import { CONFIG_SCOPES, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// system_configs — tham số hệ thống: BUSINESS (Manager sửa) / TECHNICAL (Admin sửa)
const systemConfigSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, uppercase: true },
    value: { type: Schema.Types.Mixed, required: true },
    scope: { type: String, enum: values(CONFIG_SCOPES), required: true },
    description: String,
    updatedBy: { type: ObjectId, ref: 'User', default: null },
  },
  schemaOptions('system_configs'),
);

systemConfigSchema.index({ scope: 1 });

export const SystemConfig = model('SystemConfig', systemConfigSchema);

import { PRIORITIES, values } from '../constants/enums.js';
import { Schema, model, schemaOptions } from './_shared.js';

// complaint_categories — danh mục loại phản ánh (UC-E01)
const complaintCategorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: String,
    defaultPriority: {
      type: String,
      enum: values(PRIORITIES),
      required: true,
      default: PRIORITIES.MEDIUM,
    },
    slaHours: { type: Number, required: true, min: 1 },
    isActive: { type: Boolean, default: true },
  },
  schemaOptions('complaint_categories'),
);

export const ComplaintCategory = model('ComplaintCategory', complaintCategorySchema);

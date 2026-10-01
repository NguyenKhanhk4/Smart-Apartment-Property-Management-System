import { EXPENSE_CATEGORIES, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// operating_expenses — chi phí vận hành, tách biệt quỹ bảo trì (BR-M4, UC-C07)
const operatingExpenseSchema = new Schema(
  {
    category: { type: String, enum: values(EXPENSE_CATEGORIES), required: true },
    amount: { type: Number, required: true, min: 1 },
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ }, // YYYY-MM
    description: String,
    attachmentUrls: [String],
    createdBy: { type: ObjectId, ref: 'User' }, // Accountant
  },
  schemaOptions('operating_expenses'),
);

operatingExpenseSchema.index({ month: 1, category: 1 });

export const OperatingExpense = model('OperatingExpense', operatingExpenseSchema);

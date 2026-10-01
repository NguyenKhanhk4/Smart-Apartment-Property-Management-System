import { CONTACT_METHODS, DEBT_STATUS, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

const activitySchema = new Schema({
  at: { type: Date, default: Date.now },
  by: { type: ObjectId, ref: 'User' },
  method: { type: String, enum: values(CONTACT_METHODS) },
  note: String,
  promisedDate: Date,
});

// debt_followups — hồ sơ đòi nợ (UC-B09, B10)
const debtFollowupSchema = new Schema(
  {
    apartmentId: { type: ObjectId, ref: 'Apartment', required: true },
    invoiceIds: [{ type: ObjectId, ref: 'Invoice' }], // hóa đơn OVERDUE lúc giao
    assignedTo: { type: ObjectId, ref: 'User', required: true }, // Staff (RECEPTIONIST)
    assignedBy: { type: ObjectId, ref: 'User', required: true }, // Manager
    status: { type: String, enum: values(DEBT_STATUS), required: true, default: DEBT_STATUS.OPEN },
    activities: [activitySchema],
    resolvedAt: { type: Date, default: null }, // BR-D3
  },
  schemaOptions('debt_followups'),
);

// BR-D1: mỗi căn hộ tối đa 1 hồ sơ đang mở
debtFollowupSchema.index(
  { apartmentId: 1 },
  {
    name: 'uniq_open_followup',
    unique: true,
    partialFilterExpression: { status: DEBT_STATUS.OPEN },
  },
);
debtFollowupSchema.index({ assignedTo: 1, status: 1 });

export const DebtFollowup = model('DebtFollowup', debtFollowupSchema);

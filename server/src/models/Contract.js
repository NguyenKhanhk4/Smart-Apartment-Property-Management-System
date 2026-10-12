import { CONTRACT_STATUS, CONTRACT_TYPES, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// contracts — hợp đồng mua bán (SALE) / cho thuê (LEASE)
const contractSchema = new Schema(
  {
    apartmentId: { type: ObjectId, ref: 'Apartment', required: true },
    type: { type: String, enum: values(CONTRACT_TYPES), required: true },
    ownerId: { type: ObjectId, ref: 'User', required: true },
    tenantId: { type: ObjectId, ref: 'User', default: null },
    tenantPaysFees: { type: Boolean, default: false }, // BR-F7
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null }, // null nếu SALE
    status: {
      type: String,
      enum: values(CONTRACT_STATUS),
      required: true,
      default: CONTRACT_STATUS.ACTIVE,
    },
    fileUrl: { type: String, default: null },
    terminatedAt: { type: Date, default: null }, // UC-A06.3: thời điểm chấm dứt sớm
    createdBy: { type: ObjectId, ref: 'User' },
  },
  schemaOptions('contracts'),
);

contractSchema.index({ apartmentId: 1, status: 1 });
contractSchema.index({ status: 1, type: 1, endDate: 1 }); // cron hết hạn hợp đồng (BR-O2)

export const Contract = model('Contract', contractSchema);

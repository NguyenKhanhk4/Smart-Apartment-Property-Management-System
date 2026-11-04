import {
  GATE_PASS_DIRECTIONS,
  GATE_PASS_STATUS,
  RELATION_TYPES,
  values,
} from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

const gatePassItemSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const timeSlotSchema = new Schema(
  {
    from: { type: String, required: true, trim: true },
    to: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const ownerDecisionSchema = new Schema(
  {
    by: { type: ObjectId, ref: 'User', default: null },
    at: { type: Date, default: null },
    approved: { type: Boolean, default: null },
  },
  { _id: false },
);

const debtSnapshotSchema = new Schema(
  {
    amount: { type: Number, default: null },
    at: { type: Date, default: null },
  },
  { _id: false },
);

// gate_passes — đơn chuyển đồ ra/vào (UC52, UC53, UC54, UC62)
const gatePassSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true }, // GP-YYYYMMDD-xxx
    apartmentId: { type: ObjectId, ref: 'Apartment', required: true },
    createdBy: { type: ObjectId, ref: 'User', required: true },
    creatorRelation: {
      type: String,
      enum: values(RELATION_TYPES),
      required: true,
    },
    direction: {
      type: String,
      enum: values(GATE_PASS_DIRECTIONS),
      required: true,
    },
    scheduledDate: { type: Date, required: true },
    timeSlot: { type: timeSlotSchema, required: true },
    items: {
      type: [gatePassItemSchema],
      required: true,
      validate: [(v) => Array.isArray(v) && v.length >= 1, 'Cần ít nhất 1 vật dụng'],
    },
    truckPlate: { type: String, required: true, trim: true, uppercase: true },
    driverPhone: { type: String, trim: true, default: null },
    status: {
      type: String,
      enum: values(GATE_PASS_STATUS),
      required: true,
      default: GATE_PASS_STATUS.PENDING,
    },
    ownerDecision: {
      type: ownerDecisionSchema,
      default: () => ({ by: null, at: null, approved: null }),
    },
    reviewedBy: { type: ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    rejectReason: { type: String, default: null },
    debtSnapshot: {
      type: debtSnapshotSchema,
      default: () => ({ amount: null, at: null }),
    },
    usedBy: { type: ObjectId, ref: 'User', default: null },
    usedAt: { type: Date, default: null },
  },
  schemaOptions('gate_passes'),
);

gatePassSchema.index({ status: 1, scheduledDate: 1 });
gatePassSchema.index({ apartmentId: 1, createdAt: -1 });
gatePassSchema.index({ truckPlate: 1, status: 1, scheduledDate: 1 });

export const GatePass = model('GatePass', gatePassSchema);

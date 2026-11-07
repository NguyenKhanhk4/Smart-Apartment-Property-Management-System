// Module 7: sổ khách và các collection bưu kiện, tuần tra, báo khẩn dùng chung nhóm file vận hành hiện có.
import { GUEST_STATUS, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// guest_logs — sổ khách ra vào (UC-E07, E08)
const guestLogSchema = new Schema(
  {
    apartmentId: { type: ObjectId, ref: 'Apartment', required: true },
    buildingId: { type: ObjectId, ref: 'Building' },
    guestName: { type: String, required: true, trim: true },
    guestPhone: String,
    idNumber: { type: String, default: null }, // dữ liệu cũ (CCCD dạng rõ); bản ghi mới luôn null
    idNumberEnc: { type: String, default: null, select: false }, // CCCD mã hóa AES-256-GCM (modules/residents/idCrypto)
    idNumberHash: { type: String, default: null, select: false }, // HMAC để tra cứu trùng
    idLast4: { type: String, match: /^\d{4}$/, default: undefined },
    residentConfirmation: { type: String, enum: ['PENDING', 'CONFIRMED', 'DECLINED'], default: 'PENDING' },
    confirmedBy: { type: ObjectId, ref: 'User', default: null },
    numberOfGuests: { type: Number, default: 1, min: 1 },
    purpose: String,
    expectedTime: Date,
    status: {
      type: String,
      enum: values(GUEST_STATUS),
      required: true,
      default: GUEST_STATUS.EXPECTED,
    },
    isWalkIn: { type: Boolean, default: false }, // khách vãng lai (BR-O10)
    registeredBy: { type: ObjectId, ref: 'User', default: null }, // cư dân đăng ký trước
    checkInTime: { type: Date, default: null },
    checkOutTime: { type: Date, default: null },
    recordedBy: { type: ObjectId, ref: 'User', default: null }, // Bảo vệ
    note: String,
  },
  // 2 bảo vệ check-in/check-out cùng bản ghi đồng thời → request sau 409 CONCURRENT_UPDATE
  schemaOptions('guest_logs', { optimisticConcurrency: true }),
);

guestLogSchema.index({ expectedTime: 1, status: 1 });
guestLogSchema.index({ apartmentId: 1, createdAt: -1 });
guestLogSchema.index({ checkInTime: -1 });

export const GuestLog = model('GuestLog', guestLogSchema);

// Mỗi nghiệp vụ có collection riêng; không trộn bưu kiện/sự cố vào guest_logs.
const parcelSchema = new Schema({
  apartmentId: { type: ObjectId, ref: 'Apartment', required: true },
  trackingCode: { type: String, required: true, trim: true, unique: true },
  carrier: { type: String, required: true, trim: true },
  imageUrls: { type: [String], required: true },
  status: { type: String, enum: ['STORED', 'AWAITING_RETURN', 'COLLECTED', 'RETURNED'], default: 'STORED' },
  receivedBy: { type: ObjectId, ref: 'User', required: true },
  collectedBy: { type: ObjectId, ref: 'User' },
  recipientName: String,
  signature: { type: String, select: false },
  handedOverBy: { type: ObjectId, ref: 'User' },
  handedOverAt: Date,
  remindedAt: Date,
}, schemaOptions('parcels'));
parcelSchema.index({ status: 1, createdAt: 1 });
parcelSchema.index({ apartmentId: 1, createdAt: -1 });
export const Parcel = model('Parcel', parcelSchema);

const checkpointSchema = new Schema({
  name: { type: String, required: true, trim: true },
  location: { type: String, required: true, trim: true },
  token: { type: String, required: true, unique: true, select: false },
  active: { type: Boolean, default: true },
}, schemaOptions('patrol_checkpoints'));
export const PatrolCheckpoint = model('PatrolCheckpoint', checkpointSchema);

const tourSchema = new Schema({
  name: { type: String, required: true, trim: true },
  shiftId: { type: ObjectId, ref: 'DutyShift', required: true },
  guardId: { type: ObjectId, ref: 'User', required: true },
  startAt: { type: Date, required: true },
  endAt: { type: Date, required: true },
  // Snapshot điểm phải đi: sửa checkpoint sau đó không làm đổi mẫu số lịch sử.
  checkpoints: [{ _id: false, checkpointId: { type: ObjectId, ref: 'PatrolCheckpoint' }, name: String, location: String }],
  scans: [{ _id: false, checkpointId: ObjectId, scannedAt: Date, latitude: Number, longitude: Number }],
  missedNotifiedAt: Date,
}, schemaOptions('patrol_tours'));
tourSchema.index({ guardId: 1, endAt: -1 });
tourSchema.index({ endAt: 1, missedNotifiedAt: 1 });
export const PatrolTour = model('PatrolTour', tourSchema);

const incidentSchema = new Schema({
  requestId: { type: String, required: true, unique: true },
  type: { type: String, enum: ['FIRE', 'SECURITY', 'COLLISION', 'TECHNICAL'], required: true },
  location: { type: String, required: true },
  description: { type: String, required: true },
  imageUrls: [String],
  reportedBy: { type: ObjectId, ref: 'User' },
  sourceTicketId: { type: ObjectId, ref: 'Ticket' },
  acknowledgedBy: { type: ObjectId, ref: 'User', default: null },
  acknowledgedAt: Date,
  nextNotifyAt: { type: Date, default: Date.now },
  notifiedAt: Date,
  broadcastAt: Date,
  broadcastEndedAt: Date,
}, schemaOptions('security_incidents'));
incidentSchema.index({ acknowledgedBy: 1, nextNotifyAt: 1 });
export const SecurityIncident = model('SecurityIncident', incidentSchema);

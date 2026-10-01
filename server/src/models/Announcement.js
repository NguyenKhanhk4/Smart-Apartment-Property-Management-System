import { ANNOUNCEMENT_SCOPES, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// announcements — bảng tin (UC-E09)
const announcementSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    targetScope: { type: String, enum: values(ANNOUNCEMENT_SCOPES), required: true },
    targetId: { type: ObjectId, default: null }, // buildingId / apartmentId tùy targetScope
    isPinned: { type: Boolean, default: false },
    sendEmail: { type: Boolean, default: false },
    recipientCount: { type: Number, default: 0 },
    createdBy: { type: ObjectId, ref: 'User', required: true },
  },
  schemaOptions('announcements'),
);

announcementSchema.index({ targetScope: 1, targetId: 1, createdAt: -1 });
announcementSchema.index({ isPinned: -1, createdAt: -1 });

export const Announcement = model('Announcement', announcementSchema);

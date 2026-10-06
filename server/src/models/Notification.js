import { NOTIFICATION_TYPES, values } from '../constants/enums.js';
import { ObjectId, Schema, model, schemaOptions } from './_shared.js';

// notifications — thông báo cá nhân (Notification service dùng chung, UC-E09)
const notificationSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    type: { type: String, enum: values(NOTIFICATION_TYPES), required: true },
    title: { type: String, required: true },
    content: { type: String, required: true },
    isRead: { type: Boolean, required: true, default: false },
    readAt: Date,
    refId: { type: ObjectId, default: null }, // bản ghi liên quan
    link: String, // đường dẫn FE, vd /r/tickets/:id
    emailSent: { type: Boolean, default: false },
  },
  schemaOptions('notifications'),
);

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

export const Notification = model('Notification', notificationSchema);

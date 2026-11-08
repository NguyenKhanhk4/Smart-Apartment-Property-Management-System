// Module 8: bảng tin, khảo sát một phiếu/căn và bình luận được kiểm duyệt trong các collection riêng.
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
    attachments: [{ _id: false, name: String, url: String }],
    poll: {
      type: new Schema({
        audience: { type: String, enum: ['OWNER', 'ACTIVE_RESIDENT'], required: true },
        options: { type: [String], required: true },
        closesAt: { type: Date, required: true },
        closedAt: Date,
        votes: { type: [{ _id: false, apartmentId: ObjectId, userId: ObjectId, option: Number, votedAt: Date }], default: [], select: false },
      }, { _id: false }),
      default: undefined,
    },
    createdBy: { type: ObjectId, ref: 'User', required: true },
  },
  schemaOptions('announcements'),
);

announcementSchema.index({ targetScope: 1, targetId: 1, createdAt: -1 });
announcementSchema.index({ isPinned: -1, createdAt: -1 });

export const Announcement = model('Announcement', announcementSchema);

const commentSchema = new Schema({
  announcementId: { type: ObjectId, ref: 'Announcement', required: true },
  createdBy: { type: ObjectId, ref: 'User', required: true },
  content: { type: String, required: true, maxlength: 2000 },
  hidden: { type: Boolean, default: false },
  hiddenBy: { type: ObjectId, ref: 'User' },
  hiddenAt: Date,
  hideReason: { type: String, trim: true, maxlength: 500 }, // Tùy chọn cho dữ liệu cũ; bắt buộc tại API/service khi ẩn mới.
}, schemaOptions('announcement_comments'));
commentSchema.index({ announcementId: 1, createdAt: -1 });
export const AnnouncementComment = model('AnnouncementComment', commentSchema);

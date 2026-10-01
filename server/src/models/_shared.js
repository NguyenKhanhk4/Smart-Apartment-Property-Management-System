import mongoose from 'mongoose';

export const { Schema } = mongoose;
export const ObjectId = Schema.Types.ObjectId;

/**
 * Options chung cho mọi collection (srs_final.md §III.2.2): có createdAt/updatedAt,
 * tên collection snake_case đúng như tài liệu, JSON trả thêm `id` và bỏ `__v`.
 */
export const schemaOptions = (collection, extra = {}) => ({
  collection,
  timestamps: true,
  toJSON: { virtuals: true, versionKey: false },
  toObject: { virtuals: true, versionKey: false },
  ...extra,
});

// Tránh OverwriteModelError khi vitest/nodemon import lại module
export const model = (name, schema) => mongoose.models[name] ?? mongoose.model(name, schema);

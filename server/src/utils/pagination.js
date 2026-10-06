import Joi from 'joi';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/**
 * Rule cho ?sort= — chỉ nhận field trong danh sách cho phép (dạng `field` hoặc `-field`),
 * tránh sort theo field tuỳ ý (field nhạy cảm / không có index).
 * @example Joi.object({ ...paginationQuery, sort: sortable('createdAt', 'dueDate') })
 */
export const sortable = (...fields) =>
  Joi.string()
    .valid(...fields.flatMap((f) => [f, `-${f}`]))
    .default('-createdAt')
    .messages({ 'any.only': `{{#label}} chỉ nhận: ${fields.join(', ')} (thêm "-" để giảm dần)` });

// Dùng trong Joi schema của query: Joi.object({ ...paginationQuery, status: ... })
// Mặc định chỉ sort theo createdAt; module cần thêm field thì ghi đè `sort: sortable(...)`.
export const paginationQuery = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  sort: sortable('createdAt'),
};

export function getPagination(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(query.limit, 10) || DEFAULT_LIMIT));
  return { page, limit, skip: (page - 1) * limit };
}

// "-createdAt" → { createdAt: -1 }
export function getSort(sort = '-createdAt') {
  const desc = sort.startsWith('-');
  return { [desc ? sort.slice(1) : sort]: desc ? -1 : 1 };
}

/**
 * Chạy find + countDocuments song song, trả về { items, pagination } cho res paginated().
 */
export async function paginate(Model, filter, query, { populate, select, lean = true } = {}) {
  const { page, limit, skip } = getPagination(query);
  let q = Model.find(filter).sort(getSort(query.sort)).skip(skip).limit(limit);
  if (select) q = q.select(select);
  if (populate) q = q.populate(populate);
  if (lean) q = q.lean();
  const [items, total] = await Promise.all([q, Model.countDocuments(filter)]);
  return { items, pagination: { page, limit, total } };
}

export function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

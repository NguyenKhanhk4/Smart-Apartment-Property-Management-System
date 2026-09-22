import { ApiError } from '../utils/ApiError.js';

// Thông báo lỗi Joi tiếng Việt cho các rule hay dùng
const messages = {
  'any.required': '{{#label}} là bắt buộc',
  'any.only': '{{#label}} phải là một trong: {{#valids}}',
  'string.base': '{{#label}} phải là chuỗi',
  'string.empty': '{{#label}} không được để trống',
  'string.min': '{{#label}} tối thiểu {{#limit}} ký tự',
  'string.max': '{{#label}} tối đa {{#limit}} ký tự',
  'string.email': '{{#label}} không đúng định dạng email',
  'string.pattern.base': '{{#label}} không đúng định dạng',
  'number.base': '{{#label}} phải là số',
  'number.integer': '{{#label}} phải là số nguyên',
  'number.min': '{{#label}} phải lớn hơn hoặc bằng {{#limit}}',
  'number.max': '{{#label}} phải nhỏ hơn hoặc bằng {{#limit}}',
  'date.base': '{{#label}} phải là ngày hợp lệ',
  'boolean.base': '{{#label}} phải là true/false',
  'array.base': '{{#label}} phải là mảng',
  'object.unknown': '{{#label}} không được phép',
};

const joiOptions = {
  abortEarly: false,
  stripUnknown: true,
  convert: true,
  messages,
  errors: { wrap: { label: false } },
};

/**
 * Validate input bằng Joi (NFR-04). Dữ liệu đã chuẩn hóa nằm ở `req.validated.{body,query,params}`.
 * (Express 5 không cho gán lại req.query nên controller đọc từ req.validated.)
 *
 * @example router.get('/', validate({ query: listQuerySchema }), controller.list)
 */
export function validate(schemas) {
  return (req, _res, next) => {
    req.validated ??= {};
    const details = [];

    for (const key of ['params', 'query', 'body']) {
      if (!schemas[key]) continue;
      const { value, error } = schemas[key].validate(req[key] ?? {}, joiOptions);
      if (error) {
        details.push(
          ...error.details.map((d) => ({ field: d.path.join('.'), message: d.message })),
        );
      } else {
        req.validated[key] = value;
      }
    }

    if (details.length) return next(ApiError.badRequest(details[0].message, details));
    if (req.validated.body) req.body = req.validated.body;
    return next();
  };
}

import Joi from 'joi';

// Joi rule dùng chung giữa các module
export const objectId = () =>
  Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .messages({ 'string.pattern.base': '{{#label}} không phải ObjectId hợp lệ' });

export const ymd = () =>
  Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .messages({ 'string.pattern.base': '{{#label}} phải có dạng YYYY-MM-DD' });

export const hhmm = () =>
  Joi.string()
    .pattern(/^([01]\d|2[0-3]):[0-5]\d$/)
    .messages({ 'string.pattern.base': '{{#label}} phải có dạng HH:mm' });

/** SĐT Việt Nam (tiền tố 0 / 84 / +84): di động 3/5/7/8/9 + 8 số, hoặc máy bàn 2x + 8 số */
export const phoneVn = () =>
  Joi.string()
    .trim()
    .pattern(/^(?:\+?84|0)(?:[35789]\d{8}|2\d{9})$/)
    .messages({ 'string.pattern.base': '{{#label}} không phải số điện thoại hợp lệ' });

export const idParams = Joi.object({ id: objectId().required() });

export const period = () =>
  Joi.string()
    .pattern(/^\d{4}-(0[1-9]|1[0-2])$/)
    .messages({ 'string.pattern.base': '{{#label}} phải có dạng YYYY-MM' });

/** Query dạng ?status=A,B hoặc ?status=A&status=B → mảng */
export const csvEnum = (allowed) =>
  Joi.alternatives().try(
    Joi.array().items(Joi.string().valid(...allowed)),
    Joi.string()
      .custom((v, helpers) => {
        const items = v.split(',').map((s) => s.trim()).filter(Boolean);
        const bad = items.find((s) => !allowed.includes(s));
        return bad ? helpers.error('any.only', { valids: allowed }) : items;
      })
      .messages({ 'any.only': `{{#label}} phải thuộc: ${allowed.join(', ')}` }),
  );

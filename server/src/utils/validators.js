import Joi from 'joi';

// Joi rule dùng chung giữa các module
export const objectId = () =>
  Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .messages({ 'string.pattern.base': '{{#label}} không phải ObjectId hợp lệ' });

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

import Joi from 'joi';
import { objectId } from '../../utils/validators.js';

export const sourceReference = Joi.string().trim().min(1).max(500);
export const changeReason = Joi.string().trim().min(1).max(500);
export const floorInventory = Joi.array().items(Joi.object({
  floor: Joi.number().integer().min(1).max(200).required(),
  expectedCount: Joi.number().integer().min(1).max(500).required(),
})).min(1).max(200).required();
export const inventoryRows = Joi.array().items(Joi.object({
  id: objectId(),
  code: Joi.string().trim().uppercase().pattern(/^[A-Z0-9_-]+$/).max(20).required(),
  floor: Joi.number().integer().min(1).max(200).required(),
  managementArea: Joi.number().min(1).max(100000).precision(2).required(),
})).min(1).max(5000).required();

export const inventoryBody = Joi.object({
  sourceReference: sourceReference.required(),
  reason: changeReason,
  totalFloors: Joi.number().integer().min(1).max(200).required(),
  floors: floorInventory,
  apartments: inventoryRows,
  expectedRevision: Joi.number().integer().min(0).required(),
});

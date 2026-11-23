// buildingSettings.api.js — API cho UC05 (Thông tin tòa nhà, Biểu phí điện nước, Thu hộ)
import { http } from './axiosClient';

export const buildingProfileApi = {
  get: () => http.get('/building-profile'),
  update: (formData) =>
    http.put('/building-profile', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
};

export const utilityTariffsApi = {
  list: (params) => http.get('/utility-tariffs', { params }),
  create: (body) => http.post('/utility-tariffs', body),
  delete: (id) => http.delete(`/utility-tariffs/${id}`),
};

export const collectionSettingsApi = {
  get: () => http.get('/collection-settings'),
  update: (body) => http.put('/collection-settings', body),
  cancelUpcoming: (utility) => http.delete(`/collection-settings/${utility}/upcoming`),
};

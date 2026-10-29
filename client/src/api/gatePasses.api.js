import { http } from './axiosClient';

export const gatePassesApi = {
  list: (params) => http.get('/gate-passes', { params }),
  listToday: (params) => http.get('/gate-passes/today', { params }),
  getById: (id) => http.get(`/gate-passes/${id}`),
  create: (body) => http.post('/gate-passes', body),
  ownerDecision: (id, body) => http.patch(`/gate-passes/${id}/owner-decision`, body),
  review: (id, body) => http.patch(`/gate-passes/${id}/review`, body),
  approve: (id) => http.patch(`/gate-passes/${id}/approve`),
  reject: (id, rejectReason) => http.patch(`/gate-passes/${id}/reject`, { rejectReason }),
  markUsed: (id) => http.patch(`/gate-passes/${id}/mark-used`),
  lookupPlate: (plate) => http.get('/plates/lookup', { params: { plate } }),
};

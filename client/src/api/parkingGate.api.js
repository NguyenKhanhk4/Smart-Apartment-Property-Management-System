import { http } from './axiosClient';

export const parkingGateApi = {
  history: (params) => http.get('/parking-gate/history', { params }),
  lookup: (plate) => http.get('/parking-gate/lookup', { params: { plate } }),
  recordResident: (body) => http.post('/parking-gate/resident', body),
  admitGuest: (body) => http.post('/parking-gate/guests', body),
  quoteGuestExit: (body) => http.post('/parking-gate/guests/quote', body),
  completeGuestExit: (id, body) => http.post(`/parking-gate/guests/${id}/close`, body),
};

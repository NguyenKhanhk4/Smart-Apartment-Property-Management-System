import { useContext } from 'react';
import { ResidentContext } from '../layouts/resident/ResidentContext';

/** { loading, cards, card, apartment, apartmentId, setApartmentId, isHead, code, memberCount, vehicleCount } */
export function useResident() {
  const ctx = useContext(ResidentContext);
  if (!ctx) throw new Error('useResident phải được dùng bên trong <ResidentProvider>');
  return ctx;
}

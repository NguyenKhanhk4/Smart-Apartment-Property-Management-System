import { PARKING_VEHICLE_TYPES as TYPES } from '../../models/ParkingSession.js';
import { DAY_MS, HOUR_MS, startOfVnDay } from '../../utils/time.js';
import { ApiError } from '../../utils/ApiError.js';

const tariffs = {
  [TYPES.CAR]: { day: 40000, night: 40000 },
  [TYPES.MOTORBIKE]: { day: 5000, night: 15000 },
  [TYPES.ELECTRIC_BICYCLE]: { day: 5000, night: 15000 },
  [TYPES.BICYCLE]: { day: 3000, night: 8000 },
};

export function calculateGuestFee(vehicleType, enteredAt, exitedAt) {
  const dayStart = startOfVnDay(enteredAt).getTime();
  const morning = dayStart + 6 * HOUR_MS;
  const evening = dayStart + 18 * HOUR_MS;
  const nextMorning = morning + DAY_MS;
  const enteredDuringDay = enteredAt >= morning && enteredAt < evening;
  const bandEnd = enteredDuringDay ? evening : enteredAt < morning ? morning : nextMorning;

  if (exitedAt < enteredAt) throw ApiError.badRequest('Giờ ra phải từ giờ vào trở đi');
  if (exitedAt < bandEnd) return tariffs[vehicleType][enteredDuringDay ? 'day' : 'night'];
  if (enteredDuringDay && vehicleType === TYPES.CAR && exitedAt < nextMorning) return 80000;

  throw new ApiError('PARKING_TARIFF_UNDEFINED');
}

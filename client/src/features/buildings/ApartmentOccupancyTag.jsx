import { Tag } from 'antd';
import { APARTMENT_OCCUPANCY } from '../../constants/enums';
import { unknownOccupancy } from './apartmentOccupancy';

export default function ApartmentOccupancyTag({ status }) {
  const state = APARTMENT_OCCUPANCY[status] ?? unknownOccupancy;
  return (
    <Tag style={{ backgroundColor: state.color, borderColor: '#94a3b8', color: '#0f172a' }}>
      {state.label}
    </Tag>
  );
}

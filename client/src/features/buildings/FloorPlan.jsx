import { Alert, Button, Empty, Select, Space, Spin } from 'antd';
import ApartmentOccupancyTag from './ApartmentOccupancyTag';
import { APARTMENT_OCCUPANCY } from '../../constants/enums';
import { unknownOccupancy } from './apartmentOccupancy';

export default function FloorPlan({
  buildings, building, selection, onSelect, apartments, loading, error, onOpen,
}) {
  return (
    <div className="space-y-4">
      <Space wrap>
        <Select
          aria-label="Tòa nhà"
          placeholder="Chọn tòa nhà"
          style={{ minWidth: 200 }}
          value={building?._id}
          options={buildings.map((item) => ({ value: item._id, label: item.name }))}
          onChange={(buildingId) => onSelect({ buildingId, floor: 1 })}
        />
        <Select
          aria-label="Tầng"
          disabled={!building}
          style={{ minWidth: 110 }}
          value={selection.floor}
          options={Array.from({ length: building?.totalFloors ?? 0 }, (_, index) => ({
            value: index + 1,
            label: `Tầng ${index + 1}`,
          }))}
          onChange={(floor) => onSelect({ ...selection, floor })}
        />
      </Space>
      <Space size={[4, 4]} wrap>
        {Object.keys(APARTMENT_OCCUPANCY).map((status) => <ApartmentOccupancyTag key={status} status={status} />)}
      </Space>
      {error && <Alert type="error" showIcon message="Không thể tải sơ đồ tầng" />}
      <Spin spinning={loading}>
        {building && !error && (
          apartments.length ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {apartments.map((apartment) => (
                <Button
                  key={apartment._id}
                  onClick={() => onOpen(apartment._id)}
                  className="w-full !h-auto !py-3 !flex !flex-col"
                  style={{
                    backgroundColor: (APARTMENT_OCCUPANCY[apartment.occupancyStatus] ?? unknownOccupancy).color,
                    color: '#0f172a',
                  }}
                >
                  <strong>{apartment.code}</strong>
                  <ApartmentOccupancyTag status={apartment.occupancyStatus} />
                </Button>
              ))}
            </div>
          ) : !loading && <Empty description="Tầng này chưa có căn hộ" />
        )}
      </Spin>
    </div>
  );
}

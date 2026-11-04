import { useState } from 'react';
import { Select } from 'antd';
import { lookupApi } from '../api/moduleE.api';
import { useApi } from '../hooks/useApi';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

/**
 * Ô chọn căn hộ tìm phía server (lookupApi.apartments, tối đa 20 kết quả / lần) — không giới hạn ở N căn đầu tiên.
 * Giữ thông tin căn đã chọn để nhãn không mất khi kết quả tìm kiếm đổi.
 * `renderLabel(apartment)` tùy chọn; mặc định "A101 (Tòa A)".
 */
export default function ApartmentSelect({ renderLabel, onChange, ...props }) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState({}); // _id → căn đã chọn
  const q = useDebouncedValue(search.trim());
  const { data: found = [], loading } = useApi(() => lookupApi.apartments({ q: q || undefined }), [q]);

  const label = renderLabel ?? ((a) => (a.buildingId?.name ? `${a.code} (${a.buildingId.name})` : a.code));
  const selected = [props.value].flat().filter(Boolean);
  const byId = new Map([...selected.map((id) => [id, picked[id]]), ...found.map((a) => [a._id, a])]);
  const options = [...byId.values()].filter(Boolean).map((a) => ({ value: a._id, label: label(a) }));

  const handleChange = (value, option) => {
    const ids = [value].flat().filter(Boolean);
    setPicked((prev) => ({ ...prev, ...Object.fromEntries(found.filter((a) => ids.includes(a._id)).map((a) => [a._id, a])) }));
    onChange?.(value, option);
  };

  return (
    <Select
      showSearch
      filterOption={false}
      onSearch={setSearch}
      loading={loading}
      options={options}
      notFoundContent={loading ? 'Đang tìm...' : 'Không tìm thấy căn hộ'}
      onChange={handleChange}
      {...props}
    />
  );
}

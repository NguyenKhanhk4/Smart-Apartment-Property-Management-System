import { Dropdown } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { useResident } from '../../hooks/useResident';

// "Căn A101 · Block A"; cư dân ở nhiều căn thì bấm để đổi căn
export default function ApartmentLabel({ className = 'text-[13px] text-r-muted' }) {
  const { apartment, cards, apartmentId, setApartmentId, loading } = useResident();
  if (!apartment) return <span className={className}>{loading ? ' ' : 'Chưa có căn hộ'}</span>;

  const text = `Căn ${apartment.code}${apartment.building?.name ? ` · ${apartment.building.name}` : ''}`;
  if (cards.length < 2) return <span className={className}>{text}</span>;

  return (
    <Dropdown
      trigger={['click']}
      menu={{
        selectable: true,
        selectedKeys: [apartmentId],
        onClick: ({ key }) => setApartmentId(key),
        items: cards.map((c) => ({
          key: c.apartment._id,
          label: `Căn ${c.apartment.code}${c.apartment.building?.name ? ` · ${c.apartment.building.name}` : ''}`,
        })),
      }}
    >
      <button type="button" className={`p-0 border-0 bg-transparent cursor-pointer flex items-center gap-1 ${className}`}>
        {text}
        <DownOutlined style={{ fontSize: 10 }} />
      </button>
    </Dropdown>
  );
}


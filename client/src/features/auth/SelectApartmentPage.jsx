import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Button, Card, Spin } from 'antd';
import { HomeOutlined, RightOutlined } from '@ant-design/icons';
import EnumTag from '../../components/EnumTag';
import { RELATION_TYPES } from '../../constants/enums';
import { useResident } from '../../hooks/useResident';

// UC01 bước 5 (màn hình 4 của SRS): cư dân có từ 2 căn chọn căn làm việc; đổi lại được ở header
export default function SelectApartmentPage() {
  const navigate = useNavigate();
  const { cards, loading, apartmentId, setApartmentId } = useResident();

  // Chỉ có 1 căn (hoặc chưa có) thì không cần chọn
  useEffect(() => {
    if (!loading && cards.length < 2) navigate('/r/home', { replace: true });
  }, [loading, cards.length, navigate]);

  if (loading) return <Spin />;

  const choose = (id) => {
    setApartmentId(id);
    navigate('/r/home', { replace: true });
  };

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-xl font-semibold m-0">Chọn căn hộ</h1>
      <p className="text-r-muted mt-1 mb-4">Bạn có quyền ở nhiều căn. Chọn căn để làm việc, có thể đổi lại ở đầu trang.</p>
      <div className="flex flex-col gap-3">
        {cards.map((c) => (
          <Card key={c.apartment._id} size="small" hoverable onClick={() => choose(c.apartment._id)}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <HomeOutlined className="text-lg" />
                <div>
                  <div className="font-semibold">
                    Căn {c.apartment.code}
                    {c.apartment.building?.name ? ` · ${c.apartment.building.name}` : ''}
                  </div>
                  <EnumTag map={RELATION_TYPES} value={c.relationType} />
                </div>
              </div>
              <Button type={c.apartment._id === apartmentId ? 'primary' : 'default'} icon={<RightOutlined />}>
                Chọn
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

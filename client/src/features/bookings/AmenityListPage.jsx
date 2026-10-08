import { useNavigate, useSearchParams } from 'react-router';
import { Button, Card, Empty, Flex, Segmented, Spin, Typography } from 'antd';
import { AppstoreOutlined, HistoryOutlined } from '@ant-design/icons';
import { amenityApi, memberCodeApi } from '../../api/moduleD.api';
import EnumTag from '../../components/EnumTag';
import { AMENITY_ACCESS_MODES } from '../../constants/enums';
import { useApi } from '../../hooks/useApi';
import { vtName } from '../../motion/viewTransition';

const HERO_HEIGHT = 132;

// Ảnh bìa; dùng chung view-transition-name với ảnh hero ở trang đặt chỗ để card "bay" sang hero
export function AmenityCover({ amenity, height = HERO_HEIGHT, style }) {
  return amenity.imageUrl ? (
    <img
      src={amenity.imageUrl}
      alt={amenity.name}
      style={{ width: '100%', height, objectFit: 'cover', borderRadius: 8, display: 'block', ...vtName('amenity-img', amenity._id), ...style }}
    />
  ) : (
    <Flex align="center" justify="center" style={{ width: '100%', height, borderRadius: 8, background: 'rgba(128,128,128,0.12)', ...vtName('amenity-img', amenity._id), ...style }}>
      <AppstoreOutlined style={{ fontSize: 36, opacity: 0.45 }} />
    </Flex>
  );
}

// UC-D06 — "Đặt tiện ích" của cư dân: FREE (chỉ xem giờ), WALK_IN (đến quầy, đưa mã), BOOKING (đặt slot)
export default function AmenityListPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const { data: mine = [], loading: loadingMine } = useApi(() => memberCodeApi.mine(), []);
  const apartmentId = search.get('apartmentId') ?? mine[0]?.apartment._id;
  const { data = [], loading } = useApi(() => amenityApi.list({ limit: 100, sort: 'name' }), []);
  const withApt = apartmentId ? `?apartmentId=${apartmentId}` : '';

  return (
    <Flex vertical gap={12}>
      <Flex justify="space-between" align="center" gap={8}>
        <Typography.Title level={4} style={{ margin: 0, ...vtName('amenities-title') }}>
          Tiện ích
        </Typography.Title>
        <Button icon={<HistoryOutlined />} onClick={() => navigate(`/r/amenities/bookings${withApt}`, { viewTransition: true })}>
          Lịch sử đặt
        </Button>
      </Flex>

      {mine.length > 1 && (
        <Segmented
          block
          value={apartmentId}
          onChange={(id) => setSearch({ apartmentId: id })}
          options={mine.map((c) => ({ value: c.apartment._id, label: `Căn ${c.apartment.code}` }))}
        />
      )}

      <Spin spinning={loading || loadingMine}>
        {!loadingMine && !mine.length && (
          <Empty description="Tài khoản chưa có quyền sử dụng tiện ích trong căn hộ nào. Liên hệ Lễ tân để được hỗ trợ." />
        )}
        {mine.length > 0 && !data.length && !loading && <Empty description="Chưa có tiện ích" />}
        <Flex vertical gap={12}>
          {data.map((a) => {
            const isBooking = a.accessMode === 'BOOKING';
            const sellsPass = a.accessMode !== 'FREE' && a.monthlyPassFeeAdult != null;
            return (
              <Card
                key={a._id}
                hoverable={isBooking}
                size="small"
                onClick={isBooking ? () => navigate(`/r/amenities/${a._id}${withApt}`, { viewTransition: true }) : undefined}
              >
                <Flex vertical gap={8}>
                  <AmenityCover amenity={a} />
                  <Flex justify="space-between" align="center" gap={8}>
                    <Typography.Text strong style={{ fontSize: 16 }}>
                      {a.name}
                    </Typography.Text>
                    <EnumTag map={AMENITY_ACCESS_MODES} value={a.accessMode} />
                  </Flex>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {a.location ? `${a.location} · ` : ''}
                    {a.openTime && a.closeTime ? `${a.openTime} – ${a.closeTime}` : 'Mở cửa tự do'}
                  </Typography.Text>

                  {a.accessMode === 'FREE' && <Typography.Text>Không cần đặt — bạn có thể đến sử dụng trong giờ mở cửa.</Typography.Text>}

                  {a.accessMode === 'WALK_IN' && (
                    <>
                      <Typography.Text>{a.priceSummary}</Typography.Text>
                      <Typography.Text type="secondary">Đến quầy lễ tân, đưa mã của bạn để vào.</Typography.Text>
                    </>
                  )}

                  {isBooking && <Typography.Text>{a.priceSummary}</Typography.Text>}

                  <Flex gap={8} wrap>
                    {isBooking && (
                      <Button
                        type="primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/r/amenities/${a._id}${withApt}`, { viewTransition: true });
                        }}
                      >
                        Đặt chỗ
                      </Button>
                    )}
                    {sellsPass && (
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/r/my-code/passes${withApt}`, { viewTransition: true });
                        }}
                      >
                        Gói tháng
                      </Button>
                    )}
                  </Flex>
                </Flex>
              </Card>
            );
          })}
        </Flex>
      </Spin>
    </Flex>
  );
}

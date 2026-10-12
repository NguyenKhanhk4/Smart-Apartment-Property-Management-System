import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Card,
  Segmented,
  Row,
  Col,
  Statistic,
  Tag,
  Space,
  Empty,
  Button,
  List,
  Avatar,
  Badge,
  Spin,
} from 'antd';
import {
  HomeOutlined,
  TeamOutlined,
  CrownOutlined,
  ToolOutlined,
  CoffeeOutlined,
  IdcardOutlined,
  UsergroupAddOutlined,
  UserOutlined,
} from '@ant-design/icons';
import PageHeader from '../../components/PageHeader';
import EnumTag from '../../components/EnumTag';
import { APARTMENT_STATUS, RELATION_TYPES } from '../../constants/enums';
import { formatDate } from '../../utils/format';
import { useAuth } from '../../hooks/useAuth';
import { useApi } from '../../hooks/useApi';
import { residentsApi } from '../../api/moduleA.api';

export default function MyApartmentPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Load danh sách căn hộ của tôi
  const {
    data: apartments = [],
    loading: loadingApts,
    reload: reloadApts,
  } = useApi(residentsApi.myApartments, []);

  const [selectedAptId, setSelectedAptId] = useState(null);

  // Lấy căn hộ đang chọn hoặc mặc định căn đầu tiên
  const activeAptId =
    selectedAptId && apartments.some((a) => a.apartmentId === selectedAptId)
      ? selectedAptId
      : apartments[0]?.apartmentId ?? null;

  // Căn hộ hiện tại đang chọn
  const currentApartment = apartments.find((a) => a.apartmentId === activeAptId);

  // Load danh sách thành viên trong căn hộ đang chọn
  const {
    data: members = [],
    loading: loadingMembers,
  } = useApi(
    () => (activeAptId ? residentsApi.listByApartment(activeAptId) : Promise.resolve({ data: [] })),
    [activeAptId],
    { enabled: Boolean(activeAptId) },
  );

  if (loadingApts) {
    return (
      <div className="flex justify-center items-center py-24">
        <Spin size="large" tip="Đang tải thông tin căn hộ..." />
      </div>
    );
  }

  if (!apartments || apartments.length === 0) {
    return (
      <div className="p-4 md:p-6 max-w-xl mx-auto text-center py-12">
        <Card className="shadow-sm border-gray-100 dark:border-gray-800">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <div>
                <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-1">
                  Chưa gắn căn hộ
                </h3>
                <p className="text-sm text-gray-400">
                  Bạn chưa được gắn vào căn hộ nào trong tòa nhà. Vui lòng liên hệ Lễ tân để được hỗ trợ.
                </p>
              </div>
            }
          >
            <Button type="primary" onClick={() => reloadApts()}>
              Thử lại
            </Button>
          </Empty>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <PageHeader
        title="Căn hộ của tôi"
        subtitle="Thông tin căn hộ và danh sách nhân khẩu cùng sinh sống"
      />

      {/* Bộ chọn căn nếu cư dân ở nhiều hơn 1 căn */}
      {apartments.length > 1 && (
        <div className="overflow-x-auto pb-1">
          <Segmented
            value={activeAptId}
            onChange={setSelectedAptId}
            options={apartments.map((a) => ({
              label: (
                <span className="px-2 py-1 flex items-center gap-1.5">
                  <HomeOutlined />
                  <b>{a.code}</b> ({a.building?.name || ''})
                  {a.isHead && <CrownOutlined className="text-gold text-xs" />}
                </span>
              ),
              value: a.apartmentId,
            }))}
            className="bg-gray-100 dark:bg-gray-800 p-1"
          />
        </div>
      )}

      {/* Thẻ thông tin chi tiết căn hộ */}
      {currentApartment && (
        <Card
          className="shadow-sm border-gray-100 dark:border-gray-800 overflow-hidden"
          title={
            <div className="flex items-center justify-between">
              <Space align="center">
                <span className="text-lg font-bold text-blue-600 dark:text-blue-400">
                  {currentApartment.code}
                </span>
                <span className="text-xs text-gray-400 font-normal">
                  {currentApartment.building?.name || ''}
                </span>
              </Space>
              <Space>
                {currentApartment.isHead && (
                  <Tag color="gold" icon={<CrownOutlined />}>
                    Chủ hộ
                  </Tag>
                )}
                <EnumTag map={RELATION_TYPES} value={currentApartment.relationType} />
              </Space>
            </div>
          }
        >
          <Row gutter={[16, 16]}>
            <Col xs={12} sm={6}>
              <Statistic
                title="Tầng"
                value={currentApartment.floor}
                prefix={<HomeOutlined className="text-blue-500 mr-1" />}
              />
            </Col>
            <Col xs={12} sm={6}>
              <Statistic
                title="Diện tích"
                value={currentApartment.area}
                suffix="m²"
              />
            </Col>
            <Col xs={12} sm={6}>
              <Statistic
                title="Số nhân khẩu"
                value={members.length}
                prefix={<TeamOutlined className="text-emerald-500 mr-1" />}
                suffix="người"
              />
            </Col>
            <Col xs={12} sm={6}>
              <Statistic
                title="Trạng thái"
                valueRender={() => (
                  <div className="mt-1">
                    <EnumTag map={APARTMENT_STATUS} value={currentApartment.status} />
                  </div>
                )}
              />
            </Col>
          </Row>

          <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-400 flex flex-wrap justify-between gap-2">
            <span>
              Địa chỉ: <b>{currentApartment.building?.address || 'Khu chung cư SAPMS'}</b>
            </span>
            <span>
              Ngày dọn vào: <b>{formatDate(currentApartment.moveInDate) || '—'}</b>
            </span>
          </div>
        </Card>
      )}

      {/* Danh sách thành viên trong căn hộ */}
      <Card
        className="shadow-sm border-gray-100 dark:border-gray-800"
        title={
          <div className="flex items-center gap-2">
            <TeamOutlined className="text-blue-500" />
            <span>Danh sách thành viên ({members.length})</span>
          </div>
        }
      >
        <List
          loading={loadingMembers}
          itemLayout="horizontal"
          dataSource={members}
          locale={{ emptyText: 'Chưa có thông tin thành viên' }}
          renderItem={(m) => (
            <List.Item className="border-b border-gray-50 dark:border-gray-800/60 last:border-0 py-3">
              <List.Item.Meta
                avatar={
                  <Avatar
                    src={m.avatarUrl}
                    icon={<UserOutlined />}
                    className="bg-blue-100 text-blue-600 dark:bg-gray-700"
                    size={40}
                  />
                }
                title={
                  <Space align="center" wrap>
                    <span className="font-semibold text-gray-800 dark:text-gray-100">
                      {m.fullName}
                    </span>
                    {m.isHead && (
                      <Tag color="gold" icon={<CrownOutlined />}>
                        Chủ hộ
                      </Tag>
                    )}
                    <EnumTag map={RELATION_TYPES} value={m.relationType} />
                    {String(m.userId) === String(user?._id || user?.id) && (
                      <Badge status="processing" text={<span className="text-xs text-gray-400">(Bạn)</span>} />
                    )}
                  </Space>
                }
                description={
                  <div className="text-xs text-gray-400 space-x-3 mt-0.5">
                    {m.phone && <span>SĐT: {m.phone}</span>}
                    {m.dateOfBirth && <span>Ngày sinh: {formatDate(m.dateOfBirth)}</span>}
                    <span>Ngày dọn vào: {formatDate(m.moveInDate)}</span>
                  </div>
                }
              />
            </List.Item>
          )}
        />
      </Card>

      {/* Lối tắt tiện ích nhanh cho cư dân */}
      <Card
        size="small"
        className="shadow-sm border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50"
      >
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
          Dịch vụ & Tiện ích căn hộ
        </div>
        <Row gutter={[12, 12]}>
          {/* Gia đình (cấp quyền phát sinh phí, ngày sinh) — chỉ chủ hộ; không còn nút ở "Mã của tôi" */}
          {currentApartment?.isHead && (
            <Col xs={12} sm={6}>
              <Button
                block
                icon={<TeamOutlined className="text-emerald-500" />}
                onClick={() => navigate(`/r/my-code/family?apartmentId=${activeAptId}`)}
              >
                Quản lý gia đình
              </Button>
            </Col>
          )}
          <Col xs={12} sm={6}>
            <Button
              block
              icon={<IdcardOutlined className="text-blue-500" />}
              onClick={() => navigate('/r/my-code')}
            >
              Mã cư dân
            </Button>
          </Col>
          <Col xs={12} sm={6}>
            <Button
              block
              icon={<CoffeeOutlined className="text-gold" />}
              onClick={() => navigate('/r/amenities')}
            >
              Đặt tiện ích
            </Button>
          </Col>
          <Col xs={12} sm={6}>
            <Button
              block
              icon={<ToolOutlined className="text-amber-500" />}
              onClick={() => navigate('/r/tickets')}
            >
              Gửi phản ánh
            </Button>
          </Col>
          <Col xs={12} sm={6}>
            <Button
              block
              icon={<UsergroupAddOutlined className="text-purple-500" />}
              onClick={() => navigate('/r/guests')}
            >
              Sổ khách
            </Button>
          </Col>
        </Row>
      </Card>
    </div>
  );
}

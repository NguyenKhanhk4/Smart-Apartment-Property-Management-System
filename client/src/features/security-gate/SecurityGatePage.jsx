import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  Popconfirm,
  Space,
  Spin,
  Tag,
  message,
} from 'antd';
import {
  CarOutlined,
  CheckCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { gatePassesApi } from '../../api/gatePasses.api';
import EnumTag from '../../components/EnumTag';
import PageHeader from '../../components/PageHeader';
import { VEHICLE_TYPES } from '../../constants/enums';
import { useAction, useApi } from '../../hooks/useApi';
import { formatDateTime } from '../../utils/format';
import {
  GATE_PASS_DIRECTIONS_MAP,
  GATE_PASS_STATUS_MAP,
} from '../gatePasses/gatePassConstants';

export default function SecurityGatePage() {
  const [plateInput, setPlateInput] = useState('');
  const [lookupResult, setLookupResult] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);

  const [includeUsed, setIncludeUsed] = useState(false);
  const [searchToday, setSearchToday] = useState('');

  const {
    data: todayPasses = [],
    loading: loadingToday,
    reload: reloadToday,
  } = useApi(
    () =>
      gatePassesApi.listToday({
        includeUsed,
        search: searchToday || undefined,
      }),
    [includeUsed, searchToday],
  );

  const [runMarkUsed, markingUsed] = useAction((id) => gatePassesApi.markUsed(id), {
    success: 'Đã đánh dấu Gate Pass qua cổng thành công',
  });

  const handleLookup = async () => {
    const trimmed = plateInput.trim();
    if (!trimmed) {
      message.warning('Vui lòng nhập biển số cần tra cứu');
      return;
    }
    setLookingUp(true);
    try {
      const res = await gatePassesApi.lookupPlate(trimmed);
      setLookupResult(res.data || res);
    } catch (err) {
      message.error(err?.response?.data?.message || 'Không thể tra cứu biển số');
    } finally {
      setLookingUp(false);
    }
  };

  const handleMarkUsed = async (id) => {
    try {
      await runMarkUsed(id);
      reloadToday();
      if (lookupResult?.gatePass?._id === id) {
        handleLookup();
      }
    } catch {
      // handled
    }
  };

  const renderLookupCard = () => {
    if (!lookupResult) return null;

    if (lookupResult.result === 'REGISTERED_VEHICLE') {
      const v = lookupResult.vehicle;
      const apt = lookupResult.apartment;
      return (
        <Alert
          type="success"
          showIcon
          className="mt-3"
          message={
            <span className="text-base font-bold">
              XE CƯ DÂN ĐÃ ĐĂNG KÝ ({lookupResult.plateNumber})
            </span>
          }
          description={
            <div className="space-y-1 text-sm mt-1">
              <div>
                Căn hộ: <b className="text-base">{apt?.code}</b> ({apt?.buildingId?.name || ''})
              </div>
              <div>
                Loại xe: <EnumTag map={VEHICLE_TYPES} value={v?.type} /> · Hãng/Màu:{' '}
                <b>{[v?.brand, v?.color].filter(Boolean).join(' - ') || '—'}</b>
              </div>
              <div>
                Người đăng ký: <b>{v?.registeredBy?.fullName || '—'}</b>{' '}
                {v?.registeredBy?.phone ? `(${v.registeredBy.phone})` : ''}
              </div>
            </div>
          }
        />
      );
    }

    if (lookupResult.result === 'MATCHES_GATE_PASS') {
      const gp = lookupResult.gatePass;
      const apt = lookupResult.apartment;
      return (
        <Alert
          type="info"
          showIcon
          className="mt-3"
          message={
            <span className="text-base font-bold">
              KHỚP ĐƠN GATE PASS HÔM NAY ({gp?.code})
            </span>
          }
          description={
            <div className="space-y-2 text-sm mt-1">
              <div>
                Căn hộ: <b className="text-base">{apt?.code}</b> ({apt?.buildingId?.name || ''}) ·{' '}
                <EnumTag map={GATE_PASS_DIRECTIONS_MAP} value={gp?.direction} />
              </div>
              <div>
                Khung giờ: <b>{gp?.timeSlot?.from} – {gp?.timeSlot?.to}</b> · Người đăng ký:{' '}
                <b>{gp?.createdBy?.fullName || '—'}</b>
              </div>
              <div>
                Đồ đạc:{' '}
                {(gp?.items || []).map((it) => `${it.name} (x${it.quantity})`).join(', ')}
              </div>
              {gp?.status === 'APPROVED' && (
                <Popconfirm
                  title="Xác nhận xe tải & đơn chuyển đồ này đã qua cổng?"
                  onConfirm={() => handleMarkUsed(gp._id)}
                  okText="Xác nhận"
                  cancelText="Hủy"
                >
                  <Button
                    type="primary"
                    size="large"
                    block
                    icon={<CheckCircleOutlined />}
                    loading={markingUsed}
                  >
                    Đánh dấu Đã sử dụng (Used)
                  </Button>
                </Popconfirm>
              )}
            </div>
          }
        />
      );
    }

    return (
      <Alert
        type="warning"
        showIcon
        className="mt-3"
        message={
          <span className="text-base font-bold">
            XE LẠ / CHƯA ĐĂNG KÝ ({lookupResult.plateNumber})
          </span>
        }
        description="Không tìm thấy trong danh sách xe cư dân đã duyệt hoặc Gate Pass hợp lệ trong ngày hôm nay."
      />
    );
  };

  const rows = Array.isArray(todayPasses) ? todayPasses : todayPasses?.items || [];

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <PageHeader
        title="Kiểm soát cổng Bảo vệ"
        subtitle="Tra cứu biển số xe ra/vào và xác nhận Gate Pass đã duyệt trong ngày"
        extra={
          <Button size="large" icon={<ReloadOutlined />} onClick={() => reloadToday()}>
            Làm mới
          </Button>
        }
      />

      {/* Khu vực 1: Tra cứu biển số nhanh (UC62) — Mobile-first, nút bấm to */}
      <Card
        title={
          <Space>
            <CarOutlined className="text-blue-600" />
            <span className="font-bold text-base">Tra cứu biển số xe (UC62)</span>
          </Space>
        }
        className="shadow-sm"
      >
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            size="large"
            allowClear
            placeholder="Nhập biển số (VD: 30A-123.45)"
            value={plateInput}
            onChange={(e) => setPlateInput(e.target.value.toUpperCase())}
            onPressEnter={handleLookup}
            className="text-lg font-semibold uppercase"
          />
          <Button
            type="primary"
            size="large"
            icon={<SearchOutlined />}
            loading={lookingUp}
            onClick={handleLookup}
            className="min-h-[44px] sm:w-44 font-semibold"
          >
            Tra biển số
          </Button>
        </div>
        {renderLookupCard()}
      </Card>

      {/* Khu vực 2: Danh sách Gate Pass đã duyệt trong ngày hôm nay (UC54) */}
      <Card
        title={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-base">
              Gate Pass hôm nay ({rows.length})
            </span>
            <Checkbox
              checked={includeUsed}
              onChange={(e) => setIncludeUsed(e.target.checked)}
            >
              Hiện cả đơn đã qua cổng
            </Checkbox>
          </div>
        }
        className="shadow-sm"
      >
        <div className="mb-3">
          <Input
            size="large"
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Lọc nhanh mã đơn hoặc biển số xe tải..."
            value={searchToday}
            onChange={(e) => setSearchToday(e.target.value)}
          />
        </div>

        {loadingToday ? (
          <div className="py-12 text-center">
            <Spin size="large" />
          </div>
        ) : rows.length === 0 ? (
          <Empty description="Không có đơn Gate Pass nào cần xử lý hôm nay" />
        ) : (
          <div className="space-y-3">
            {rows.map((gp) => (
              <Card
                key={gp._id}
                size="small"
                className="border-l-4 border-l-blue-500 shadow-xs"
              >
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Space wrap>
                      <span className="text-base font-bold text-blue-600">{gp.code}</span>
                      <Tag color="geekblue" className="text-sm font-semibold">
                        Căn {gp.apartmentId?.code}
                      </Tag>
                      <EnumTag map={GATE_PASS_DIRECTIONS_MAP} value={gp.direction} />
                      <EnumTag map={GATE_PASS_STATUS_MAP} value={gp.status} />
                    </Space>
                    <Tag icon={<CarOutlined />} className="text-sm font-bold">
                      {gp.truckPlate}
                    </Tag>
                  </div>

                  <div className="text-sm">
                    Khung giờ: <b>{gp.timeSlot?.from} – {gp.timeSlot?.to}</b> · Cư dân:{' '}
                    <b>{gp.createdBy?.fullName || '—'}</b>{' '}
                    {gp.createdBy?.phone ? `(${gp.createdBy.phone})` : ''}
                  </div>

                  {gp.driverPhone && (
                    <div className="text-xs text-gray-500">SĐT tài xế: {gp.driverPhone}</div>
                  )}

                  <div className="text-sm bg-gray-50 dark:bg-gray-800 p-2 rounded">
                    <b>Đồ đạc:</b>{' '}
                    {(gp.items || []).map((it) => `${it.name} (x${it.quantity})`).join(', ')}
                  </div>

                  {gp.status === 'APPROVED' ? (
                    <Popconfirm
                      title={`Đánh dấu đơn ${gp.code} đã qua cổng?`}
                      onConfirm={() => handleMarkUsed(gp._id)}
                      okText="Xác nhận"
                      cancelText="Hủy"
                    >
                      <Button
                        type="primary"
                        size="large"
                        block
                        icon={<CheckCircleOutlined />}
                        loading={markingUsed}
                        className="min-h-[44px] font-semibold"
                      >
                        Đánh dấu Đã sử dụng (Used)
                      </Button>
                    </Popconfirm>
                  ) : (
                    <div className="text-xs text-emerald-600 font-medium">
                      Đã qua cổng lúc {formatDateTime(gp.usedAt)} ({gp.usedBy?.fullName || 'Bảo vệ'})
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

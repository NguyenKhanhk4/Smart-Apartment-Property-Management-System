import { useCallback, useState } from 'react';
import { Alert, Avatar, Button, Card, Checkbox, Empty, Flex, Input, InputNumber, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { amenityApi, amenityVisitApi, bookingApi, memberCodeApi } from '../../api/moduleD.api';
import EnumTag from '../../components/EnumTag';
import { AGE_GROUPS, BOOKING_STATUS, VISIT_CHARGE_TYPES, VISIT_STATUS } from '../../constants/enums';
import { useAction, useApi } from '../../hooks/useApi';
import { formatMoney } from '../../utils/format';

const monthLabel = (m) => `${m.slice(5)}/${m.slice(0, 4)}`;
const hhmm = (d) => new Date(d).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
const SectionTitle = ({ children }) => (
  <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
    {children}
  </Typography.Text>
);

/** Loại lượt và giá sẽ tính cho người này ở tiện ích đã chọn — khớp luật của máy chủ (gói tháng → vé lẻ theo nhóm tuổi) */
function planOf(person, amenity) {
  if (!person || !amenity) return null;
  const group = person.person.ageGroup;
  if (group === 'CHILD_FREE') return { blocked: true };
  const pass = person.passes?.some((p) => p.amenityId === amenity._id);
  if (pass) return { type: 'PASS', fee: 0 };
  const fee = (group === 'CHILD' ? amenity.perVisitFeeChild : amenity.perVisitFeeAdult) ?? 0;
  return { type: fee > 0 ? 'SINGLE' : 'FREE', fee };
}

// UC-D10 — tra mã, đối chiếu ảnh, check-in booking hôm nay, ghi lượt vào tiện ích WALK_IN
export default function ResidentPanel({ onRecorded }) {
  const [text, setText] = useState('');
  const [state, setState] = useState({ status: 'idle', query: '', data: null });
  const [amenityId, setAmenityId] = useState();
  const [escortCode, setEscortCode] = useState('');
  const [children, setChildren] = useState(0);
  // Không có QR: lễ tân phải tự xác nhận người đứng trước quầy đúng là chủ mã (đối chiếu ảnh / giấy tờ)
  const [confirmed, setConfirmed] = useState(false);
  const { data: amenities = [] } = useApi(() => amenityApi.list({ accessMode: 'WALK_IN', isActive: true, limit: 100 }), []);

  const lookup = useCallback(async (query) => {
    const q = query.trim();
    if (!q) return;
    setState((s) => ({ ...s, status: 'loading', query: q }));
    setConfirmed(false);
    try {
      const res = await memberCodeApi.lookup(q);
      setState({ status: 'found', query: q, data: res.data });
    } catch (e) {
      setState({ status: e.errorCode === 'MEMBER_CODE_NOT_FOUND' ? 'notfound' : 'error', query: q, data: null, message: e.message });
    }
  }, []);

  const d = state.data;
  const amenity = amenities.find((a) => a._id === amenityId);
  const plan = planOf(d, amenity);
  const group = d?.person.ageGroup;

  const [record, recording] = useAction(
    () =>
      amenityVisitApi.create({
        amenityId,
        code: d.code,
        ...(group === 'CHILD' && escortCode.trim() && { escortCode: escortCode.trim() }),
        ...(group !== 'CHILD' && children > 0 && { accompaniedChildren: children }),
      }),
    {
      success: 'Đã ghi lượt vào',
      onDone: () => {
        setChildren(0);
        setEscortCode('');
        onRecorded?.();
        lookup(d.code);
      },
    },
  );
  const [checkIn, checkingIn] = useAction((id) => bookingApi.checkIn(id, d.code), {
    success: 'Đã check-in',
    onDone: () => {
      onRecorded?.();
      lookup(d.code);
    },
  });

  const canSubmit = Boolean(d && confirmed && amenityId && plan && !plan.blocked && (group !== 'CHILD' || escortCode.trim()));

  return (
    <Card title="Tra mã cư dân">
      <Flex gap={8} wrap>
        <Input.Search
          style={{ maxWidth: 420, flex: 1 }}
          size="large"
          placeholder="Nhập mã cư dân, ví dụ A-0501-01"
          enterButton="Tra cứu"
          allowClear
          value={text}
          loading={state.status === 'loading'}
          onChange={(e) => setText(e.target.value)}
          onSearch={lookup}
        />
      </Flex>

      {state.status === 'notfound' && <Alert style={{ marginTop: 16 }} type="warning" showIcon title="Không tìm thấy cư dân với mã này" />}
      {state.status === 'error' && <Alert style={{ marginTop: 16 }} type="error" showIcon title={state.message} />}
      {state.status === 'idle' && <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>Nhập mã cư dân để xem thông tin và đối chiếu ảnh trước khi cho vào tiện ích.</Typography.Paragraph>}

      {d && (
        <Flex vertical gap={20} style={{ marginTop: 20 }}>
          {/* Ảnh đại diện lớn để đối chiếu với người đứng trước quầy */}
          <Flex gap={20} wrap align="flex-start">
            <Avatar size={140} shape="square" src={d.person.avatarUrl} icon={<UserOutlined />} alt={d.person.fullName} />
            <Flex vertical gap={6} style={{ minWidth: 240 }}>
              <Typography.Title level={4} style={{ margin: 0 }}>
                {d.person.fullName}
              </Typography.Title>
              <Typography.Text>
                {d.person.age != null ? `${d.person.age} tuổi · ` : 'Chưa có ngày sinh · '}
                {AGE_GROUPS[d.person.ageGroup]?.label}
              </Typography.Text>
              <Typography.Text type="secondary">
                Căn {d.apartment.code} · {d.apartment.building?.name} ·{' '}
                <span style={{ fontFamily: 'monospace' }}>{d.code}</span>
              </Typography.Text>
              <Space wrap size={[4, 4]}>
                <Tag color="orange">Đối chiếu ảnh với người đến</Tag>
                {d.needsEscort && <Tag color="red">Cần người lớn đi kèm</Tag>}
                {d.isHead && <Tag color="gold">Chủ hộ</Tag>}
                <Tag color={d.canIncurCharges ? 'default' : 'orange'}>{d.canIncurCharges ? 'Được phát sinh phí' : 'Chưa được phát sinh phí'}</Tag>
              </Space>
            </Flex>
          </Flex>

          {!d.person.avatarUrl && (
            <Alert type="warning" showIcon title="Cư dân chưa có ảnh đại diện — kiểm tra giấy tờ tùy thân trước khi cho vào" />
          )}
          <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}>
            Đã đối chiếu đúng người (ảnh đại diện hoặc giấy tờ)
          </Checkbox>

          <div>
            <SectionTitle>Gói đang dùng</SectionTitle>
            {d.passes?.length ? (
              <Space wrap>
                {d.passes.map((p) => (
                  <Tag key={p._id} color="cyan">
                    {p.amenityName} · tháng {monthLabel(p.month)}
                  </Tag>
                ))}
              </Space>
            ) : (
              <Typography.Text type="secondary">Không có gói tháng đang dùng</Typography.Text>
            )}
          </div>

          <div>
            <SectionTitle>Booking hôm nay (cả căn)</SectionTitle>
            {d.bookingsToday?.length ? (
              <Flex vertical gap={8}>
                {d.bookingsToday.map((b) => {
                  const now = Date.parse(d.serverTime);
                  const inWindow = b.status === 'APPROVED' && now >= Date.parse(b.checkIn.opensAt) && now <= Date.parse(b.checkIn.closesAt);
                  return (
                    <Flex key={b._id} gap={8} align="center" wrap>
                      <Typography.Text strong style={{ minWidth: 110 }}>
                        {b.slotStart}–{b.slotEnd}
                      </Typography.Text>
                      <span>{b.amenity?.name}</span>
                      <EnumTag map={BOOKING_STATUS} value={b.status} />
                      {!b.isMine && b.bookedBy && <Typography.Text type="secondary">đặt bởi {b.bookedBy.fullName}</Typography.Text>}
                      {b.status === 'APPROVED' && (
                        <Tooltip title={inWindow ? null : `Mở check-in lúc ${hhmm(b.checkIn.opensAt)}, hạn ${hhmm(b.checkIn.closesAt)}`}>
                          <Button size="small" type="primary" disabled={!inWindow} loading={checkingIn} onClick={() => checkIn(b._id).catch(() => {})}>
                            Check-in
                          </Button>
                        </Tooltip>
                      )}
                    </Flex>
                  );
                })}
              </Flex>
            ) : (
              <Typography.Text type="secondary">Hôm nay căn hộ không có booking</Typography.Text>
            )}
          </div>

          {d.visitsToday?.length > 0 && (
            <div>
              <SectionTitle>Lượt vào hôm nay của người này</SectionTitle>
              <Space wrap>
                {d.visitsToday.map((v) => (
                  <Tag key={v._id} color={v.status === 'CANCELLED' ? 'default' : VISIT_CHARGE_TYPES[v.chargeType]?.color}>
                    {hhmm(v.visitedAt)} · {v.amenity?.name} · {VISIT_CHARGE_TYPES[v.chargeType]?.label}
                    {v.status === 'CANCELLED' && ` (${VISIT_STATUS.CANCELLED.label})`}
                  </Tag>
                ))}
              </Space>
            </div>
          )}

          <div>
            <SectionTitle>Cho vào</SectionTitle>
            {group === 'CHILD_FREE' ? (
              <Alert
                type="info"
                showIcon
                title="Trẻ nhỏ được miễn phí, không có lượt riêng"
                description="Hãy tra mã của người lớn đi kèm và nhập số trẻ nhỏ đi kèm ở lượt của người lớn."
              />
            ) : (
              <Flex vertical gap={12} style={{ maxWidth: 560 }}>
                <Select
                  placeholder="Chọn tiện ích vào cửa"
                  value={amenityId}
                  onChange={setAmenityId}
                  options={amenities.map((a) => ({ value: a._id, label: a.name }))}
                  notFoundContent={<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có tiện ích kiểu Vào cửa" />}
                />
                {plan && !plan.blocked && (
                  <Alert
                    type={plan.type === 'SINGLE' ? 'warning' : 'success'}
                    showIcon
                    title={
                      <>
                        Loại lượt: <b>{VISIT_CHARGE_TYPES[plan.type].label}</b> — {plan.fee > 0 ? `${formatMoney(plan.fee)} (tính vào hóa đơn tháng sau, không thu tại quầy)` : '0 đ'}
                      </>
                    }
                    description={plan.type === 'SINGLE' && !d.canIncurCharges && group !== 'CHILD' ? 'Người này chưa được chủ hộ cho phép phát sinh phí: lượt sẽ bị từ chối.' : null}
                  />
                )}
                {group === 'CHILD' && (
                  <Input
                    placeholder="Mã cư dân của người lớn đi kèm (bắt buộc)"
                    value={escortCode}
                    onChange={(e) => setEscortCode(e.target.value)}
                    status={escortCode.trim() ? undefined : 'warning'}
                  />
                )}
                {group !== 'CHILD' && (
                  <Flex gap={8} align="center">
                    <InputNumber min={0} max={20} value={children} onChange={(v) => setChildren(v ?? 0)} />
                    <Typography.Text type="secondary">trẻ dưới 6 tuổi đi kèm (miễn phí, tính vào sức chứa)</Typography.Text>
                  </Flex>
                )}
                <div>
                  {!confirmed && (
                    <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                      Tích ô &quot;Đã đối chiếu đúng người&quot; ở trên để ghi lượt vào.
                    </Typography.Paragraph>
                  )}
                  <Button type="primary" size="large" disabled={!canSubmit} loading={recording} onClick={() => record().catch(() => {})}>
                    Ghi lượt vào
                  </Button>
                </div>
              </Flex>
            )}
          </div>
        </Flex>
      )}
    </Card>
  );
}

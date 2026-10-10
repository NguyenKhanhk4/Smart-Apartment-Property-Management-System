import { useState } from 'react';
import { Alert, Avatar, Button, Card, Checkbox, DatePicker, Empty, Flex, Input, Modal, Radio, Select, Skeleton, Tag, Typography } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { amenityApi, bookingApi, memberCodeApi } from '../../api/moduleD.api';
import EnumTag from '../../components/EnumTag';
import { AGE_GROUPS } from '../../constants/enums';
import { useAction, useApi } from '../../hooks/useApi';
import { formatMoney } from '../../utils/format';

const DEFAULT_ADVANCE_DAYS = 14;

/**
 * UC-D07 — Lễ tân đặt hộ tại quầy: nhập mã cư dân → đối chiếu ảnh → chọn tiện ích, ngày, giờ.
 * Phí > 0 mà người được đặt hộ không có quyền phí thì phải chọn người chịu phí (chủ hộ / thành viên có quyền phí cùng căn).
 */
export default function CounterBookingModal({ initialDate, onClose, onDone }) {
  const [codeText, setCodeText] = useState('');
  const [person, setPerson] = useState(null); // kết quả /member-codes/lookup
  const [amenityId, setAmenityId] = useState();
  const [date, setDate] = useState(initialDate ?? dayjs());
  const [slotStart, setSlotStart] = useState();
  const [payerCode, setPayerCode] = useState();
  const [checkInNow, setCheckInNow] = useState(false);

  const [lookup, looking] = useAction(async (text) => {
    const res = await memberCodeApi.lookup(text);
    setPerson(res.data);
    setPayerCode(undefined);
  });
  const { data: amenities = [] } = useApi(() => amenityApi.list({ accessMode: 'BOOKING', isActive: true, limit: 100 }), []);
  const dateText = date.format('YYYY-MM-DD');
  const { data: grid, loading: loadingSlots } = useApi(() => amenityApi.slots(amenityId, { date: dateText }), [amenityId, dateText], {
    enabled: Boolean(amenityId),
  });
  const slot = grid?.slots.find((s) => s.slotStart === slotStart);

  // Phí áp cho người này: gói tháng của chính họ (đúng tháng của ngày đặt) → 0; ngược lại phí/lượt của slot
  const hasPass = Boolean(person?.passes?.some((p) => p.amenityId === amenityId && p.month === date.format('YYYY-MM')));
  const fee = slot ? (hasPass ? 0 : slot.fee) : 0;
  const needsPayer = Boolean(person) && fee > 0 && !person.canIncurCharges;
  const payers = (person?.household ?? []).filter((m) => m.canIncurCharges && m.userId !== person?.person.userId && m.code);

  const [submit, submitting] = useAction(
    async () => {
      const res = await bookingApi.counter({
        memberCode: person.code,
        amenityId,
        date: dateText,
        slotStart,
        ...(needsPayer && { payerCode }),
        ...(checkInNow && { checkInNow: true }),
      });
      return res;
    },
    {
      success: (res) =>
        res?.data?.checkedIn
          ? 'Đã đặt và check-in cho cư dân'
          : checkInNow
            ? 'Đã đặt tiện ích — chưa trong khung check-in nên chưa check-in'
            : 'Đã đặt tiện ích giúp cư dân',
      onDone: () => {
        onDone?.();
        onClose();
      },
    },
  );

  const advance = grid?.rules?.advanceDays ?? DEFAULT_ADVANCE_DAYS;
  const canSubmit = Boolean(person && amenityId && slot?.available && (!needsPayer || payerCode));

  return (
    <Modal
      open
      title="Đặt hộ tại quầy"
      onCancel={onClose}
      width={640}
      destroyOnHidden
      footer={[
        <Button key="close" onClick={onClose}>
          Đóng
        </Button>,
        <Button key="ok" type="primary" disabled={!canSubmit} loading={submitting} onClick={() => submit().catch(() => {})}>
          Đặt chỗ
        </Button>,
      ]}
    >
      <Flex vertical gap={16}>
        <div>
          <Typography.Text strong>1. Mã cư dân của người được đặt hộ</Typography.Text>
          <Input.Search
            style={{ marginTop: 8 }}
            placeholder="Ví dụ A-0501-01"
            enterButton="Tra mã"
            value={codeText}
            loading={looking}
            onChange={(e) => {
              setCodeText(e.target.value);
              setPerson(null);
            }}
            onSearch={(v) => v.trim() && lookup(v.trim()).catch(() => {})}
          />
        </div>

        {person && (
          <Card size="small">
          <Flex gap={16} align="center">
            {/* Ảnh đại diện lớn để lễ tân đối chiếu với người đứng trước quầy */}
            <Avatar size={96} shape="square" src={person.person.avatarUrl} icon={<UserOutlined />} />
            <Flex vertical gap={4}>
              <Typography.Text strong style={{ fontSize: 16 }}>
                {person.person.fullName}
              </Typography.Text>
              <Typography.Text type="secondary">
                Căn {person.apartment.code} · {person.apartment.building?.name}
              </Typography.Text>
              <Flex gap={4} wrap>
                <Tag style={{ fontFamily: 'monospace' }}>{person.code}</Tag>
                <EnumTag map={AGE_GROUPS} value={person.person.ageGroup} />
                {person.isHead && <Tag color="gold">Chủ hộ</Tag>}
                <Tag color={person.canIncurCharges ? 'green' : 'orange'}>{person.canIncurCharges ? 'Được phát sinh phí' : 'Chưa được phát sinh phí'}</Tag>
              </Flex>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Mã nhập tay — hãy đối chiếu ảnh với người đến
              </Typography.Text>
            </Flex>
          </Flex>
          </Card>
        )}

        {person && (
          <>
            <div>
              <Typography.Text strong>2. Tiện ích và ngày</Typography.Text>
              <Flex gap={8} wrap style={{ marginTop: 8 }}>
                <Select
                  style={{ minWidth: 220 }}
                  placeholder="Chọn tiện ích"
                  value={amenityId}
                  onChange={(v) => (setAmenityId(v), setSlotStart(undefined))}
                  options={amenities.map((a) => ({ value: a._id, label: a.name }))}
                />
                <DatePicker
                  allowClear={false}
                  format="DD/MM/YYYY"
                  value={date}
                  onChange={(d) => (setDate(d), setSlotStart(undefined))}
                  disabledDate={(d) => d.isBefore(dayjs().startOf('day')) || d.isAfter(dayjs().add(advance, 'day').endOf('day'))}
                />
              </Flex>
            </div>

            {amenityId && (
              <div>
                <Typography.Text strong>3. Khung giờ</Typography.Text>
                <div style={{ marginTop: 8 }}>
                  {loadingSlots && !grid ? (
                    <Skeleton active paragraph={{ rows: 2 }} title={false} />
                  ) : !grid?.slots.length ? (
                    <Empty description="Tiện ích chưa có khung giờ" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    <Radio.Group optionType="button" value={slotStart} onChange={(e) => setSlotStart(e.target.value)} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {grid.slots.map((s) => (
                        <Radio.Button key={s.slotStart} value={s.slotStart} disabled={!s.available} title={s.lockMessage ?? `Còn ${s.remaining}/${s.capacity} chỗ`}>
                          {s.slotStart}–{s.slotEnd}
                        </Radio.Button>
                      ))}
                    </Radio.Group>
                  )}
                </div>
                {slot?.lockMessage && <Typography.Text type="secondary">{slot.lockMessage}</Typography.Text>}
              </div>
            )}

            {slot && (
              <Flex vertical gap={8}>
                <Typography.Text>
                  Phí: <Typography.Text strong>{fee > 0 ? formatMoney(fee) : hasPass ? 'Miễn phí theo gói tháng' : 'Miễn phí'}</Typography.Text>
                </Typography.Text>
                {needsPayer && (
                  <div>
                    <Alert
                      type="warning"
                      showIcon
                      style={{ marginBottom: 8 }}
                      message="Người này chưa được phát sinh phí tiện ích. Chọn chủ hộ hoặc thành viên có quyền phí cùng căn đi cùng để chịu phí."
                    />
                    <Select
                      style={{ width: '100%' }}
                      placeholder="Người chịu phí"
                      value={payerCode}
                      onChange={setPayerCode}
                      options={payers.map((m) => ({ value: m.code, label: `${m.fullName} · ${m.code}${m.isHead ? ' (chủ hộ)' : ''}` }))}
                      notFoundContent="Căn hộ chưa có người nào có quyền phát sinh phí"
                    />
                  </div>
                )}
                <Checkbox checked={checkInNow} onChange={(e) => setCheckInNow(e.target.checked)}>
                  Check-in ngay (chỉ có hiệu lực khi đang trong khung check-in của khung giờ này)
                </Checkbox>
              </Flex>
            )}
          </>
        )}
      </Flex>
    </Modal>
  );
}

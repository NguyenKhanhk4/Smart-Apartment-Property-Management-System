import { useMemo, useState } from 'react';
import { Button, Card, Empty, Flex, Popconfirm, Segmented, Skeleton, Tag, Typography } from 'antd';
import { DeleteOutlined, LeftOutlined, PhoneOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { dutyShiftApi } from '../../api/moduleE.api';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import PageHeader from '../../components/PageHeader';
import { DUTY_ROLE_TITLES, enumOptions } from '../../constants/enums';
import CreateShiftModal from './CreateShiftModal';
import { formatDate } from '../../utils/format';

const hhmm = (d) => dayjs(d).format('HH:mm');

// Ca qua đêm hiện ở ngày bắt đầu, kèm "(+1)" ở giờ kết thúc
function shiftTime(s) {
  const overnight = !dayjs(s.endAt).isSame(dayjs(s.startAt), 'day');
  return `${hhmm(s.startAt)} – ${hhmm(s.endAt)}${overnight ? ' (+1)' : ''}`;
}

function OnDutyCard({ roleTitle }) {
  const { data, loading } = useApi(() => dutyShiftApi.onDuty(roleTitle), [roleTitle]);
  const person = (p, backup) => (
    <Flex key={p._id} align="center" gap={8} wrap>
      <Typography.Text strong>{p.fullName}</Typography.Text>
      {backup && <Tag color="purple">Dự phòng</Tag>}
      {p.phone && (
        <a href={`tel:${p.phone}`}>
          <PhoneOutlined /> {p.phone}
        </a>
      )}
      <Typography.Text type="secondary">đến {hhmm(p.endAt)}</Typography.Text>
    </Flex>
  );
  return (
    <Card size="small" title={`${DUTY_ROLE_TITLES[roleTitle].label} đang trực`} className="mb-4">
      {loading ? (
        <Skeleton active paragraph={{ rows: 1 }} title={false} />
      ) : data?.hasSchedule ? (
        <Flex vertical gap={6}>
          {data.primary.map((p) => person(p, false))}
          {data.backup.map((p) => person(p, true))}
        </Flex>
      ) : (
        <Typography.Text type="warning">Hiện không có ai trong ca trực</Typography.Text>
      )}
    </Card>
  );
}

// Người 4 — Lịch ca trực theo tuần. Trưởng BQL xếp / hủy ca; Kỹ thuật viên, Bảo vệ xem lịch và ca của mình.
export default function DutyShiftsPage() {
  const { user, hasRole } = useAuth();
  const isManager = hasRole('MANAGER');
  const [roleTitle, setRoleTitle] = useState(hasRole('STAFF:SECURITY') ? 'SECURITY' : 'TECHNICIAN');
  const [weekStart, setWeekStart] = useState(() => dayjs().startOf('week'));
  const [creating, setCreating] = useState(null); // ngày mặc định khi mở form

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => weekStart.add(i, 'day')), [weekStart]);
  const params = useMemo(
    () => ({ roleTitle, from: weekStart.toISOString(), to: weekStart.add(7, 'day').toISOString() }),
    [roleTitle, weekStart],
  );
  const { data: shifts = [], loading, reload } = useApi(() => dutyShiftApi.list(params), [params]);
  const [remove] = useAction(dutyShiftApi.remove, { success: 'Đã hủy ca trực', onDone: reload });

  const byDay = (day) => shifts.filter((s) => dayjs(s.startAt).isSame(day, 'day'));
  const isToday = (day) => day.isSame(dayjs(), 'day');

  return (
    <>
      <PageHeader
        title="Lịch ca trực"
        subtitle="Kỹ thuật viên và Bảo vệ theo ca; người trực dự phòng nhận cảnh báo khẩn khi người trực chính chưa xử lý."
        extra={
          isManager && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(dayjs())}>
              Xếp ca
            </Button>
          )
        }
      />

      <Flex gap={12} wrap align="center" justify="space-between" className="mb-4">
        <Segmented value={roleTitle} options={enumOptions(DUTY_ROLE_TITLES)} onChange={setRoleTitle} />
        <Flex gap={8} align="center">
          <Button icon={<LeftOutlined />} onClick={() => setWeekStart((w) => w.subtract(7, 'day'))} />
          <Button onClick={() => setWeekStart(dayjs().startOf('week'))}>Tuần này</Button>
          <Button icon={<RightOutlined />} onClick={() => setWeekStart((w) => w.add(7, 'day'))} />
          <Typography.Text strong>
            {weekStart.format('DD/MM')} – {formatDate(weekStart.add(6, 'day'))}
          </Typography.Text>
        </Flex>
      </Flex>

      <OnDutyCard roleTitle={roleTitle} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        {days.map((day) => {
          const items = byDay(day);
          return (
            <Card
              key={day.valueOf()}
              size="small"
              loading={loading}
              title={
                <Typography.Text strong type={isToday(day) ? 'warning' : undefined}>
                  {day.format('dd DD/MM')}
                  {isToday(day) && ' · Hôm nay'}
                </Typography.Text>
              }
              extra={
                isManager &&
                !day.isBefore(dayjs(), 'day') && (
                  <Button size="small" type="text" icon={<PlusOutlined />} onClick={() => setCreating(day)} />
                )
              }
            >
              {items.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa xếp ca" />
              ) : (
                <Flex vertical gap={8}>
                  {items.map((s) => {
                    const mine = s.userId?._id === user.id;
                    return (
                      <Flex
                        key={s._id}
                        justify="space-between"
                        align="start"
                        gap={4}
                        className={`rounded-md px-2 py-1.5 ${mine ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-black/[0.03] dark:bg-white/[0.04]'}`}
                      >
                        <Flex vertical className="min-w-0">
                          <Typography.Text strong>{shiftTime(s)}</Typography.Text>
                          <Typography.Text ellipsis>{s.userId?.fullName ?? '—'}</Typography.Text>
                          <Flex gap={4} wrap>
                            {s.isBackup && <Tag color="purple">Dự phòng</Tag>}
                            {mine && <Tag color="gold">Ca của tôi</Tag>}
                          </Flex>
                          {s.note && (
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              {s.note}
                            </Typography.Text>
                          )}
                        </Flex>
                        {isManager && dayjs(s.endAt).isAfter(dayjs()) && (
                          <Popconfirm
                            title="Hủy ca trực này?"
                            description="Nhân viên sẽ nhận thông báo ca bị hủy."
                            okText="Hủy ca"
                            cancelText="Không"
                            onConfirm={() => remove(s._id).catch(() => {})}
                          >
                            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                          </Popconfirm>
                        )}
                      </Flex>
                    );
                  })}
                </Flex>
              )}
            </Card>
          );
        })}
      </div>

      {creating && (
        <CreateShiftModal
          open
          roleTitle={roleTitle}
          defaultDate={creating}
          onClose={() => setCreating(null)}
          onDone={reload}
        />
      )}
    </>
  );
}

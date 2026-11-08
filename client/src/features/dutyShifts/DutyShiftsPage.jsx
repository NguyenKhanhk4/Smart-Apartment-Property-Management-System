import { useMemo, useState } from 'react';
import { Button, Card, Flex, Segmented, Skeleton, Typography } from 'antd';
import { CalendarOutlined, DragOutlined, LeftOutlined, MoonOutlined, PhoneOutlined, PlusOutlined, RightOutlined, TableOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { dutyShiftApi } from '../../api/moduleE.api';
import { useAction, useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import PageHeader from '../../components/PageHeader';
import { DUTY_ROLE_TITLES, enumOptions } from '../../constants/enums';
import CreateShiftModal from './CreateShiftModal';
import EditShiftModal from './EditShiftModal';
import ShiftDetailModal from './ShiftDetailModal';
import MonthCalendar from './MonthCalendar';
import WeekTimeline from './WeekTimeline';
import { SHIFT_KINDS } from './shiftLayout';
import { moveToDay } from './shiftWindow';

const hhmm = (d) => dayjs(d).format('HH:mm');

function OnDutyCard({ roleTitle }) {
  const { data, loading } = useApi(() => dutyShiftApi.onDuty(roleTitle), [roleTitle]);
  const person = (p) => (
    <Flex key={p._id} align="center" gap={8} wrap>
      <Typography.Text strong>{p.fullName}</Typography.Text>
      {p.phone && (
        <a href={`tel:${p.phone}`}>
          <PhoneOutlined /> {p.phone}
        </a>
      )}
      <Typography.Text type="secondary">đến {hhmm(p.endAt)}</Typography.Text>
    </Flex>
  );
  return (
    <Card
      size="small"
      className="mb-4"
      title={
        <span className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${data?.onDuty?.length ? 'bg-emerald-500' : 'bg-amber-500'}`} aria-hidden />
          {DUTY_ROLE_TITLES[roleTitle].label} đang trực
        </span>
      }
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 1 }} title={false} />
      ) : data?.hasSchedule ? (
        <Flex gap={24} wrap>
          {data.onDuty.map(person)}
        </Flex>
      ) : (
        <Typography.Text type="warning">Hiện không có ai trong ca trực</Typography.Text>
      )}
    </Card>
  );
}

/** Chú thích màu loại ca + cách hiển thị ca qua đêm */
function Legend({ view }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px] text-ink-2">
      {Object.values(SHIFT_KINDS).map((k) => (
        <span key={k.label} className="inline-flex items-center gap-1.5" title={k.hint}>
          <span className={`w-3 h-3 rounded-[3px] border ${k.className}`} aria-hidden />
          {k.label} <span className="text-ink-3">({k.hint})</span>
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <MoonOutlined />
        {view === 'week'
          ? 'Ca qua đêm: khối nối qua nửa đêm, mép nét đứt = còn tiếp ở ngày bên cạnh'
          : 'Ca qua đêm nằm ở ngày bắt đầu, giờ kết thúc ghi sau mũi tên (sáng hôm sau)'}
      </span>
    </div>
  );
}

// Lịch ca trực Kỹ thuật viên / Bảo vệ — 2 chế độ xem: Tuần (lưới giờ) và Tháng (lịch).
// Trưởng BQL xếp, sửa, kéo thả, hủy ca; Kỹ thuật viên, Bảo vệ xem lịch (ca của mình có viền đậm).
export default function DutyShiftsPage() {
  const { user, hasRole } = useAuth();
  const isManager = hasRole('MANAGER');
  const [roleTitle, setRoleTitle] = useState(hasRole('STAFF:SECURITY') ? 'SECURITY' : 'TECHNICIAN');
  const [view, setView] = useState('week');
  const [anchor, setAnchor] = useState(() => dayjs()); // ngày bất kỳ trong tuần / tháng đang xem
  const [creating, setCreating] = useState(null); // thời điểm mặc định khi mở form xếp ca
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null); // ca chỉ xem (đã kết thúc, hoặc người xem không phải Trưởng BQL)

  const unit = view === 'week' ? 'week' : 'month';
  const rangeStart = anchor.startOf(unit);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => anchor.startOf('week').add(i, 'day')), [anchor]);
  // Tuần: lấy thêm hôm trước để hiện đoạn tiếp của ca đêm bắt đầu từ Chủ nhật tuần trước.
  // Tháng: lấy trọn lưới lịch (có thể gồm vài ngày của tháng trước / sau).
  const params = useMemo(() => {
    const from = view === 'week' ? anchor.startOf('week').subtract(1, 'day') : anchor.startOf('month').startOf('week');
    const to = view === 'week' ? anchor.startOf('week').add(7, 'day') : anchor.endOf('month').endOf('week').add(1, 'millisecond');
    return { roleTitle, from: from.toISOString(), to: to.toISOString() };
  }, [roleTitle, view, anchor]);
  const { data: shifts = [], loading, reload } = useApi(() => dutyShiftApi.list(params), [params]);
  const [remove] = useAction(dutyShiftApi.remove, { success: 'Đã hủy ca trực', onDone: reload });

  // Kéo thả: chỉ Trưởng BQL, ca chưa bắt đầu; thả vào ngày chưa qua → dời ca, giữ giờ và độ dài
  const [dragging, setDragging] = useState(null);
  const [overDay, setOverDay] = useState(null);
  const [move] = useAction(({ shift, day }) => dutyShiftApi.update(shift._id, moveToDay(shift, day, dayjs)), {
    success: (res) => `Đã chuyển ca sang ${dayjs(res.data.startAt).format('dd DD/MM')}`,
    onDone: reload,
  });
  const dnd = {
    dragging,
    setDragging,
    overDay,
    setOverDay,
    canDrag: (s) => isManager && dayjs(s.startAt).isAfter(dayjs()),
    canDropOn: (day) => Boolean(dragging) && !day.isBefore(dayjs(), 'day') && !day.isSame(dragging.startAt, 'day'),
    dropOn: (day) => {
      const shift = dragging;
      setDragging(null);
      setOverDay(null);
      if (shift && !day.isBefore(dayjs(), 'day') && !day.isSame(shift.startAt, 'day')) move({ shift, day }).catch(() => {});
    },
  };
  // Lịch cũ chỉ để xem: ca đã kết thúc (hoặc người xem không phải Trưởng BQL) mở chi tiết chỉ đọc
  const openShift = (s) => (isManager && dayjs(s.endAt).isAfter(dayjs()) ? setEditing(s) : setViewing(s));
  // Xếp ca mới: không vào ngày / giờ đã qua — mặc định 06:00, hôm nay đã qua 06:00 thì lấy giờ chẵn kế tiếp
  const createAt = (t) => {
    const now = dayjs();
    if (t.isBefore(now, 'day')) return;
    setCreating(t.isBefore(now) ? now.add(1, 'hour').startOf('hour') : t);
  };

  const title =
    view === 'week'
      ? `${rangeStart.format('DD/MM')} – ${rangeStart.add(6, 'day').format('DD/MM/YYYY')}`
      : `Tháng ${anchor.format('MM/YYYY')}`;
  const shared = { shifts, userId: user.id, isManager, onOpen: openShift, onCreate: createAt, dnd };

  return (
    <>
      <PageHeader
        title="Lịch ca trực"
        subtitle="Kỹ thuật viên và Bảo vệ theo ca, 1 ca có thể nhiều người trực. Ngoài giờ hành chính chỉ sự cố Khẩn cấp / Cao báo người trực ngay."
        extra={
          isManager && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => createAt(dayjs().hour(6).minute(0))}>
              Xếp ca
            </Button>
          )
        }
      />

      <OnDutyCard roleTitle={roleTitle} />

      <Flex gap={12} wrap align="center" justify="space-between" className="mb-3">
        <Flex gap={8} wrap align="center">
          <Segmented value={roleTitle} options={enumOptions(DUTY_ROLE_TITLES)} onChange={setRoleTitle} />
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'week', label: 'Tuần', icon: <TableOutlined /> },
              { value: 'month', label: 'Tháng', icon: <CalendarOutlined /> },
            ]}
          />
        </Flex>
        <Flex gap={8} align="center">
          <Button icon={<LeftOutlined />} aria-label={view === 'week' ? 'Tuần trước' : 'Tháng trước'} onClick={() => setAnchor((a) => a.subtract(1, unit))} />
          <Button onClick={() => setAnchor(dayjs())}>{view === 'week' ? 'Tuần này' : 'Tháng này'}</Button>
          <Button icon={<RightOutlined />} aria-label={view === 'week' ? 'Tuần sau' : 'Tháng sau'} onClick={() => setAnchor((a) => a.add(1, unit))} />
          <span className="min-w-[150px] text-[14px] font-semibold text-ink">{title}</span>
        </Flex>
      </Flex>

      <div className="mb-3 flex flex-col gap-1.5">
        <Legend view={view} />
        {isManager && (
          <div className="flex items-center gap-2 text-[12px] text-ink-3">
            <DragOutlined />
            Bấm ô trống để xếp ca{view === 'week' ? ' vào giờ đó' : ' ngày đó'} · bấm một ca để sửa / hủy · kéo ca sang ngày khác để dời (giữ nguyên giờ) · lịch đã qua chỉ để xem.
          </div>
        )}
      </div>

      {loading && !shifts.length ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : view === 'week' ? (
        <WeekTimeline days={days} {...shared} />
      ) : (
        <MonthCalendar month={anchor} {...shared} />
      )}

      {viewing && <ShiftDetailModal shift={viewing} onClose={() => setViewing(null)} />}
      {editing && <EditShiftModal shift={editing} onClose={() => setEditing(null)} onDone={reload} onRemove={(id) => remove(id)} />}
      {creating && (
        <CreateShiftModal open roleTitle={roleTitle} defaultDate={creating} onClose={() => setCreating(null)} onDone={reload} />
      )}
    </>
  );
}

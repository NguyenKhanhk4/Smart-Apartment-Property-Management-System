import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { App, Button, Tooltip } from 'antd';
import { vehicleApi } from '../../../api/moduleA.api';
import { bookingApi } from '../../../api/moduleD.api';
import { AssignModal } from '../../tickets/TicketActionModals';
import { Block } from './Block';
import { refreshReceptionDashboard, useReceptionDashboard } from './receptionDashboard';
import { DIVIDER, LINK, MUTED, TEXT } from './styles';
import { ReasonModal } from './TodoModals';
import { TODO_KINDS, buildTodos } from './todos';

const COLLAPSED_ROWS = 6;
const SOURCE_LABELS = { tickets: 'phản ánh', bookings: 'đặt tiện ích', vehicles: 'gửi xe' };
const DONE_TONES = { ok: 'text-r-ok-fg', muted: 'text-r-neutral-fg' };

function Tag({ kind }) {
  const k = TODO_KINDS[kind];
  return (
    <span className="w-24 shrink-0 text-center rounded-full py-1.5 text-xs font-medium" style={{ background: k.bg, color: k.fg }}>
      {k.label}
    </span>
  );
}

// "Cần xử lý": phản ánh chưa phân công, booking sắp tới giờ chưa check-in, yêu cầu gửi xe chờ duyệt.
// Làm xong một dòng thì dòng đó đổi thành chữ trạng thái và mọi số đếm (thẻ số liệu, sidebar) được tải lại.
export default function TodoList() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const snap = useReceptionDashboard();
  const todos = useMemo(() => buildTodos(snap), [snap]);

  const [done, setDone] = useState({}); // key → { item, index, text, tone }
  const [busy, setBusy] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [modal, setModal] = useState(null); // { type: 'assign' | 'reject' | 'cancel', item }

  // Dòng đã xử lý giữ nguyên vị trí cho tới khi người dùng tải lại trang
  const rows = useMemo(() => {
    const out = todos.filter((t) => !done[t.key]);
    Object.values(done)
      .sort((a, b) => a.index - b.index)
      .forEach((d) => out.splice(Math.min(d.index, out.length), 0, { ...d.item, done: d }));
    return out;
  }, [todos, done]);
  const pending = rows.filter((r) => !r.done);

  const markDone = (item, text, tone = 'ok') => {
    setDone((d) => ({ ...d, [item.key]: { item, text, tone, index: rows.findIndex((r) => r.key === item.key) } }));
    refreshReceptionDashboard();
  };
  const run = async (item, fn, text, tone) => {
    setBusy(item.key);
    try {
      await fn();
      message.success(text);
      markDone(item, text, tone);
    } catch (e) {
      message.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const failedParts = Object.entries(SOURCE_LABELS).filter(([k]) => snap.parts[k].status === 'error');
  const initialLoading = snap.fetchedAt === 0;
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);

  const actions = (item) => {
    const loading = busy === item.key;
    const r = item.raw;
    switch (item.kind) {
      case 'ticket':
        return (
          <>
            <Button size="large" onClick={() => navigate(`/app/tickets/${r._id}`, { viewTransition: true })}>
              Xem
            </Button>
            <Button size="large" type="primary" onClick={() => setModal({ type: 'assign', item })}>
              Phân công
            </Button>
          </>
        );
      case 'booking': {
        const inWindow = snap.fetchedAt >= Date.parse(r.checkIn.opensAt) && snap.fetchedAt <= Date.parse(r.checkIn.closesAt);
        return (
          <>
            <Button size="large" onClick={() => setModal({ type: 'cancel', item })}>
              Hủy
            </Button>
            <Tooltip title={inWindow ? null : 'Ngoài khung check-in'}>
              <Button
                size="large"
                type="primary"
                loading={loading}
                disabled={!inWindow}
                onClick={() => run(item, () => bookingApi.checkIn(r._id), 'Đã check-in')}
              >
                Check-in
              </Button>
            </Tooltip>
          </>
        );
      }
      case 'vehicle':
        return (
          <>
            <Button size="large" onClick={() => setModal({ type: 'reject', item })}>
              Từ chối
            </Button>
            <Button size="large" type="primary" loading={loading} onClick={() => run(item, () => vehicleApi.approve(r._id), 'Đã duyệt')}>
              Duyệt
            </Button>
          </>
        );
      default:
        return null;
    }
  };

  const close = () => setModal(null);
  const item = modal?.item;

  return (
    <>
      <Block
        title="Cần xử lý"
        loading={initialLoading}
        extra={<span className={`text-[13px] ${MUTED}`}>Sắp xếp theo mức gấp</span>}
      >
        {failedParts.length > 0 && (
          <div className="mx-6 mb-3 px-3 py-2 rounded-lg bg-r-warn-bg text-r-warn-fg text-[13px] flex items-center justify-between gap-2" role="alert">
            <span>Chưa tải được: {failedParts.map(([, label]) => label).join(', ')}.</span>
            <Button type="link" size="small" onClick={() => refreshReceptionDashboard()}>
              Thử lại
            </Button>
          </div>
        )}
        {rows.length === 0 ? (
          <div className={`px-6 pb-8 pt-4 text-center text-sm ${MUTED}`}>Không có việc nào đang chờ</div>
        ) : (
          <ul className="list-none m-0 p-0">
            {visible.map((row) => (
              <li key={row.key} className={`flex items-center gap-4 flex-wrap px-6 py-3.5 border-t ${DIVIDER}`}>
                <Tag kind={row.kind} />
                <div className="flex-1 basis-60 min-w-0">
                  <div className={`font-semibold text-[15px] ${TEXT}`}>{row.title}</div>
                  <div className={`text-[13px] ${MUTED}`}>{row.sub}</div>
                </div>
                {row.done ? (
                  <span className={`text-sm font-medium ${DONE_TONES[row.done.tone]}`} role="status">
                    {row.done.text}
                  </span>
                ) : (
                  <div className="flex gap-2 ml-auto">{actions(row)}</div>
                )}
              </li>
            ))}
          </ul>
        )}
        {rows.length > COLLAPSED_ROWS && (
          <div className={`px-6 py-4 border-t ${DIVIDER}`}>
            <button type="button" className={LINK} onClick={() => setExpanded((e) => !e)}>
              {expanded ? 'Thu gọn' : `Xem tất cả việc cần xử lý (${pending.length})`}
            </button>
          </div>
        )}
      </Block>

      {modal?.type === 'assign' && (
        <AssignModal
          ticket={item.raw}
          open
          onClose={close}
          onDone={() => markDone(item, 'Đã phân công')}
        />
      )}
      <ReasonModal
        open={modal?.type === 'reject'}
        title="Từ chối đăng ký phương tiện"
        hint={item && `${item.title} · ${item.sub}. Lý do sẽ được gửi cho cư dân.`}
        okText="Xác nhận từ chối"
        action={(reason) => vehicleApi.reject(item.raw._id, { reason })}
        onClose={close}
        onDone={() => {
          message.success('Đã từ chối đăng ký xe');
          markDone(item, 'Đã từ chối', 'muted');
          close();
        }}
      />
      <ReasonModal
        open={modal?.type === 'cancel'}
        title="Hủy booking"
        hint={item && `${item.title} · ${item.sub}. Người đặt được thông báo và không bị tính phí.`}
        okText="Hủy booking"
        minLength={5}
        action={(reason) => bookingApi.cancel(item.raw._id, reason)}
        onClose={close}
        onDone={() => {
          message.success('Đã hủy booking');
          markDone(item, 'Đã hủy', 'muted');
          close();
        }}
      />
    </>
  );
}

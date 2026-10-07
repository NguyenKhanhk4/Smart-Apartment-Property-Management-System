import { createElement, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { RightOutlined, SearchOutlined } from '@ant-design/icons';
import { adminMenu } from '../config/menu';
import { useAuth } from '../hooks/useAuth';
import { springConfig } from '../motion/presets';

const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();

// Tìm nhanh chức năng (Ctrl+K): lấy từ config/menu.js, chỉ những trang người dùng có quyền
export default function CommandPalette({ open, onClose }) {
  // Hộp thoại chỉ được mount khi mở → mỗi lần mở là ô tìm kiếm trống
  return <AnimatePresence>{open && <PaletteDialog onClose={onClose} />}</AnimatePresence>;
}

function PaletteDialog({ onClose }) {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const commands = useMemo(
    () => adminMenu.filter((m) => !m.hideInMenu && hasRole(...(m.roles ?? []))),
    [hasRole],
  );
  const results = query.trim()
    ? commands.filter((c) => normalize(`${c.label} ${c.group ?? ''}`).includes(normalize(query.trim())))
    : commands;

  const go = (item) => {
    onClose();
    navigate(`/app/${item.path}`, { viewTransition: true });
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowDown') setCursor((c) => Math.min(c + 1, results.length - 1));
    if (e.key === 'ArrowUp') setCursor((c) => Math.max(c - 1, 0));
    if (e.key === 'Enter' && results[cursor]) go(results[cursor]);
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center pt-[15vh] px-4">
      <motion.div
        className="fixed inset-0 bg-midnight/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        role="dialog"
        aria-label="Tìm chức năng"
        initial={{ opacity: 0, scale: 0.96, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: -8 }}
        transition={springConfig}
        className="relative w-full max-w-xl overflow-hidden rounded-[14px] border border-line-strong bg-white shadow-2xl dark:bg-[#121E31] dark:border-[#24344D]"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3 dark:border-[#24344D]">
          <SearchOutlined className="text-ink-3" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Gõ tên chức năng, vd: tài sản, phản ánh…"
            className="w-full border-none bg-transparent text-sm text-ink outline-none placeholder:text-ink-3 dark:text-[#EEF1F6]"
          />
          <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-ink-2">ESC</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {!results.length && <div className="p-6 text-center text-[13px] text-ink-3">Không tìm thấy chức năng phù hợp</div>}
          {results.map((item, i) => (
            <button
              type="button"
              key={item.key}
              onClick={() => go(item)}
              onMouseEnter={() => setCursor(i)}
              className={`flex w-full cursor-pointer items-center justify-between rounded-lg border-0 px-3 py-2.5 text-left transition-colors ${
                i === cursor ? 'bg-ivory dark:bg-[#18263D]' : 'bg-transparent'
              }`}
            >
              <span className="flex items-center gap-3">
                <span className="text-base text-navy dark:text-gold">{item.icon && createElement(item.icon)}</span>
                <span>
                  <span className="block text-[13px] font-semibold text-ink dark:text-[#EEF1F6]">{item.label}</span>
                  <span className="block text-[11px] text-ink-3">{item.group ?? 'Tổng quan'}</span>
                </span>
              </span>
              <RightOutlined className="text-[10px] text-ink-3" />
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

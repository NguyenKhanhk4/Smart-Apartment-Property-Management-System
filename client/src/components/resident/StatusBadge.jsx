// Badge trạng thái dạng pill theo thiết kế. tone: ok | warn | info | neutral
const TONES = {
  ok: 'bg-r-ok-bg text-r-ok-fg',
  warn: 'bg-r-warn-bg text-r-warn-fg',
  info: 'bg-r-info-bg text-r-info-fg',
  neutral: 'bg-r-neutral-bg text-r-neutral-fg',
};

export default function StatusBadge({ tone = 'neutral', children, square = false }) {
  return (
    <span
      className={`inline-block whitespace-nowrap text-xs font-medium ${square ? 'px-2 py-0.5 rounded-md' : 'px-2.5 py-1 rounded-full'} ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

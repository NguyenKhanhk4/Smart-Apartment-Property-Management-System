// Thanh tab phân đoạn (nền be, tab chọn nền trắng). options: [{ value, label }]
export default function SegmentedTabs({ options, value, onChange, label, className = '' }) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={`grid gap-1 p-1 bg-r-segment rounded-xl ${className}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            id={`tab-${o.value}`}
            aria-selected={selected}
            onClick={() => onChange(o.value)}
            className={`h-10 px-4 rounded-[9px] border-0 text-sm cursor-pointer ${
              selected ? 'bg-white text-r-text font-semibold' : 'bg-transparent text-r-muted font-medium'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

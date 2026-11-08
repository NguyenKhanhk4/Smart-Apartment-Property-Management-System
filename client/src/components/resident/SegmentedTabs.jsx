// Thanh tab phân đoạn (nền xám xanh, tab chọn nền trắng có bóng + chữ màu chính). options: [{ value, label }]
export default function SegmentedTabs({ options, value, onChange, label, className = '' }) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={`grid gap-1 p-1 bg-r-segment border border-r-border rounded-xl ${className}`}
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
              selected ? 'bg-white text-r-navy font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'bg-transparent text-r-muted font-medium hover:text-r-text'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

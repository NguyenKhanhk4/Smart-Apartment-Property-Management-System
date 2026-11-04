import { Button } from 'antd';
import { CARD, MUTED, TEXT } from './styles';

/** Khối có tiêu đề, link bên phải, và 3 trạng thái: đang tải / lỗi (có nút thử lại) / nội dung */
export function Block({ title, extra, loading, error, onRetry, className = '', children }) {
  return (
    <section className={`${CARD} ${className}`}>
      <header className={`flex items-center justify-between gap-3 px-6 pt-5 pb-4`}>
        <h2 className={`m-0 text-lg font-semibold ${TEXT}`}>{title}</h2>
        {extra}
      </header>
      {loading ? (
        <div className="px-6 pb-6 space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 rounded-lg bg-r-segment/60 dark:bg-[#18263D] animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className={`px-6 pb-6 text-sm ${MUTED}`} role="alert">
          {error}
          {onRetry && (
            <Button type="link" onClick={onRetry} style={{ paddingInline: 8 }}>
              Thử lại
            </Button>
          )}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

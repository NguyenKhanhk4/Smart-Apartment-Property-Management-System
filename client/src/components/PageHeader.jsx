import { Breadcrumb } from 'antd';
import { Link } from 'react-router';

/**
 * Tiêu đề trang chuẩn: breadcrumb + tiêu đề 24/600 + gạch vàng 32×2px + mô tả + nút hành động.
 * Tiêu đề có view-transition-name "page-title" → morph khi chuyển trang.
 * `titleTransitionName`: đặt tên riêng để tiêu đề morph từ 1 phần tử ở trang trước (vd tên tài sản trong bảng).
 * @example <PageHeader title="Tài sản chung" subtitle="…" breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Tài sản' }]} extra={<Button>…</Button>} />
 */
export default function PageHeader({ title, subtitle, breadcrumb, extra, titleTransitionName, className = '' }) {
  return (
    <div className={`mb-6 ${className}`}>
      {breadcrumb?.length > 0 && (
        <Breadcrumb
          className="mb-2"
          items={breadcrumb.map((b) => ({
            title: b.path ? (
              <Link to={b.path} viewTransition>
                {b.label}
              </Link>
            ) : (
              <span className="font-medium text-ink dark:text-[#EEF1F6]">{b.label}</span>
            ),
          }))}
        />
      )}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="min-w-0">
          <h1
            style={titleTransitionName ? { viewTransitionName: titleTransitionName } : undefined}
            className="vt-page-title m-0 text-2xl font-semibold leading-tight tracking-[-0.01em] text-ink dark:text-[#EEF1F6]">
            {title}
          </h1>
          <div className="w-8 h-0.5 bg-gold rounded-full mt-2" />
          {subtitle && <p className="mt-2 mb-0 text-[13px] text-ink-2 dark:text-[#A7B0BF]">{subtitle}</p>}
        </div>
        {extra && <div className="flex items-center gap-2.5 shrink-0 flex-wrap">{extra}</div>}
      </div>
    </div>
  );
}

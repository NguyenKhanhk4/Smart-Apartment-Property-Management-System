import { Breadcrumb } from 'antd';
import { Link } from 'react-router';

/**
 * Tiêu đề trang chuẩn: breadcrumb + tiêu đề 20/600 + mô tả (tối đa ~90 ký tự/dòng) + nút hành động, cách nội dung 20px.
 * Tiêu đề có view-transition-name "page-title" → morph khi chuyển trang.
 * `titleTransitionName`: đặt tên riêng để tiêu đề morph từ 1 phần tử ở trang trước (vd tên tài sản trong bảng).
 * @example <PageHeader title="Tài sản chung" subtitle="…" breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Tài sản' }]} extra={<Button>…</Button>} />
 */
export default function PageHeader({ title, subtitle, breadcrumb, extra, titleTransitionName, className = '' }) {
  return (
    <div className={`mb-5 ${className}`}>
      {breadcrumb?.length > 0 && (
        <Breadcrumb
          className="mb-2"
          items={breadcrumb.map((b) => ({
            title: b.path ? (
              <Link to={b.path} viewTransition>
                {b.label}
              </Link>
            ) : (
              <span className="font-medium text-ink dark:text-[#FAFAFA]">{b.label}</span>
            ),
          }))}
        />
      )}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 md:gap-6">
        <div className="min-w-0">
          <h1
            style={titleTransitionName ? { viewTransitionName: titleTransitionName } : undefined}
            className="vt-page-title m-0 text-xl font-semibold leading-tight tracking-[-0.01em] text-ink dark:text-[#FAFAFA]">
            {title}
          </h1>
          {subtitle && <p className="mt-1.5 mb-0 max-w-[90ch] text-[13px] leading-relaxed text-ink-2 dark:text-[#A1A1AA]">{subtitle}</p>}
        </div>
        {extra && <div className="flex items-center gap-2.5 shrink-0 flex-wrap">{extra}</div>}
      </div>
    </div>
  );
}

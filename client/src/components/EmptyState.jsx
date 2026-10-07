import { Button } from 'antd';
import { PlusOutlined } from '@ant-design/icons';

/**
 * Trạng thái rỗng có minh họa nét mảnh.
 * @example <EmptyState title="Chưa có tài sản" description="Thêm tài sản đầu tiên để bắt đầu theo dõi bảo trì." actionText="Thêm tài sản" onAction={…} />
 */
export default function EmptyState({ title = 'Chưa có dữ liệu', description, actionText, onAction }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
        <rect x="10" y="14" width="44" height="38" rx="4" stroke="#1E3A5F" fill="#FAF8F4" />
        <line x1="18" y1="24" x2="38" y2="24" stroke="#8C93A0" />
        <line x1="18" y1="32" x2="32" y2="32" stroke="#8C93A0" />
        <circle cx="44" cy="38" r="8" stroke="#C9A35B" fill="#FFFFFF" />
        <path d="M42 38H46M44 36V40" stroke="#C9A35B" />
      </svg>
      <h3 className="mt-4 mb-1.5 text-base font-semibold text-ink dark:text-[#EEF1F6]">{title}</h3>
      {description && <p className="m-0 max-w-sm text-[13px] text-ink-2 dark:text-[#A7B0BF]">{description}</p>}
      {actionText && (
        <Button type="primary" icon={<PlusOutlined />} onClick={onAction} className="mt-5">
          {actionText}
        </Button>
      )}
    </div>
  );
}

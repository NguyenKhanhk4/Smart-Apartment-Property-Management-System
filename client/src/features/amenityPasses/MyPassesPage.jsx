import { Navigate, useSearchParams } from 'react-router';

// Đường dẫn cũ /r/my-code/passes (còn trong thông báo cũ): nay là tab "Gói tháng" của trang Tiện ích
export default function MyPassesPage() {
  const [search] = useSearchParams();
  const apt = search.get('apartmentId');
  return <Navigate to={`/r/amenities?tab=plan${apt ? `&apartmentId=${apt}` : ''}`} replace />;
}

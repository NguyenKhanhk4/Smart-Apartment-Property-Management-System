import { Navigate, useSearchParams } from 'react-router';

// Đường dẫn cũ /r/amenities/bookings (còn trong thông báo cũ): nay là tab "Lịch sử đặt" của trang Tiện ích
export default function MyBookingsPage() {
  const [search] = useSearchParams();
  const apt = search.get('apartmentId');
  return <Navigate to={`/r/amenities?tab=history${apt ? `&apartmentId=${apt}` : ''}`} replace />;
}

import { lazy } from 'react';
import { HomeOutlined } from '@ant-design/icons';

// Route + menu sinh ra từ đây, KHÔNG sửa file router. Thêm trang mới = thêm một phần tử:
//   {
//     key: 'buildings',                 // duy nhất
//     label: 'Tòa nhà',                 // chữ trên menu
//     icon: BankOutlined,               // component icon của @ant-design/icons
//     path: 'buildings',                // tương đối: /app/buildings hoặc /r/buildings
//     roles: ['ADMIN', 'STAFF'],        // spec như authorize() backend; bỏ trống = ai đăng nhập cũng xem được
//     component: lazy(() => import('../features/buildings/BuildingListPage')),
//     hideInMenu: true,                 // (tuỳ chọn) có route nhưng không hiện trên menu, vd trang chi tiết
//   }

const HomePage = lazy(() => import('../features/home/HomePage'));

// Giao diện quản trị (/app/*) cho ADMIN, STAFF, BOARD — hiện ở sidebar
export const adminMenu = [
  { key: 'home', label: 'Trang chủ', icon: HomeOutlined, path: 'home', component: HomePage },
];

// Giao diện cư dân (/r/*) — hiện ở thanh điều hướng dưới cùng, nên giữ tối đa 5 mục
export const residentMenu = [
  { key: 'home', label: 'Trang chủ', icon: HomeOutlined, path: 'home', component: HomePage },
];

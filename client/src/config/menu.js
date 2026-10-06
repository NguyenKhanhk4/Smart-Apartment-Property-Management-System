import { lazy } from 'react';
import {
  AppstoreOutlined,
  BarChartOutlined,
  BellOutlined,
  DashboardOutlined,
  FundOutlined,
  HomeOutlined,
  NotificationOutlined,
  PieChartOutlined,
  SettingOutlined,
  ToolOutlined,
  UsergroupAddOutlined,
} from '@ant-design/icons';

// Route + menu sinh ra từ đây, KHÔNG sửa file router. Thêm trang mới = thêm một phần tử:
//   {
//     key: 'buildings',                 // duy nhất
//     label: 'Tòa nhà',                 // chữ trên menu
//     icon: BankOutlined,               // component icon của @ant-design/icons
//     path: 'buildings',                // tương đối: /app/buildings hoặc /r/buildings
//     roles: ['ADMIN', 'MANAGER'],      // spec như authorize() backend; bỏ trống = ai đăng nhập cũng xem được
//     component: lazy(() => import('../features/buildings/BuildingListPage')),
//     hideInMenu: true,                 // (tuỳ chọn) có route nhưng không hiện trên menu, vd trang chi tiết
//   }

const HomePage = lazy(() => import('../features/home/HomePage'));

// ===== Module E (Phạm Lượng) =====
const TicketsPage = lazy(() => import('../features/tickets/TicketsPage'));
const ResidentTicketsPage = lazy(() => import('../features/tickets/ResidentTicketsPage'));
const TicketDetailPage = lazy(() => import('../features/tickets/TicketDetailPage'));
const ComplaintSettingsPage = lazy(() => import('../features/settings/ComplaintSettingsPage'));
const GuestBookPage = lazy(() => import('../features/guests/GuestBookPage'));
const ResidentGuestsPage = lazy(() => import('../features/guests/ResidentGuestsPage'));
const AnnouncementsPage = lazy(() => import('../features/announcements/AnnouncementsPage'));
const NotificationsPage = lazy(() => import('../features/notifications/NotificationsPage'));
const BillingReportPage = lazy(() => import('../features/reports/BillingReportPage'));
const FundDashboardPage = lazy(() => import('../features/reports/FundDashboardPage'));
const OperationsDashboardPage = lazy(() => import('../features/reports/OperationsDashboardPage'));
const AmenityUsagePage = lazy(() => import('../features/reports/AmenityUsagePage'));

// Giao diện nội bộ (/app/*) — hiện ở sidebar
export const adminMenu = [
  { key: 'home', label: 'Trang chủ', icon: HomeOutlined, path: 'home', component: HomePage },

  // Ticket (UC-E01..E04)
  {
    key: 'tickets',
    label: 'Phản ánh',
    icon: ToolOutlined,
    path: 'tickets',
    roles: ['MANAGER', 'STAFF:RECEPTIONIST', 'STAFF:TECHNICIAN'],
    component: TicketsPage,
  },
  {
    key: 'ticket-detail',
    label: 'Chi tiết phản ánh',
    path: 'tickets/:id',
    roles: ['MANAGER', 'STAFF:RECEPTIONIST', 'STAFF:TECHNICIAN'],
    component: TicketDetailPage,
    hideInMenu: true,
  },
  {
    key: 'complaint-settings',
    label: 'Danh mục & tham số',
    icon: SettingOutlined,
    path: 'complaint-settings',
    roles: ['MANAGER'],
    component: ComplaintSettingsPage,
  },
  // Sổ khách (UC-E08)
  {
    key: 'guests',
    label: 'Sổ khách',
    icon: UsergroupAddOutlined,
    path: 'guests',
    roles: ['STAFF:SECURITY', 'STAFF:RECEPTIONIST', 'MANAGER'],
    component: GuestBookPage,
  },
  // Bảng tin & thông báo (UC-E09)
  {
    key: 'announcements',
    label: 'Bảng tin',
    icon: NotificationOutlined,
    path: 'announcements',
    component: AnnouncementsPage,
  },
  {
    key: 'notifications',
    label: 'Thông báo',
    icon: BellOutlined,
    path: 'notifications',
    component: NotificationsPage,
    hideInMenu: true,
  },
  // Báo cáo (UC-E10..E14)
  {
    key: 'report-billing',
    label: 'Báo cáo thu phí',
    icon: BarChartOutlined,
    path: 'report-billing',
    roles: ['MANAGER', 'ACCOUNTANT', 'BOARD'],
    component: BillingReportPage,
  },
  {
    key: 'report-fund',
    label: 'Dashboard quỹ',
    icon: FundOutlined,
    path: 'report-fund',
    roles: ['MANAGER', 'BOARD'],
    component: FundDashboardPage,
  },
  {
    key: 'report-operations',
    label: 'Dashboard vận hành',
    icon: DashboardOutlined,
    path: 'report-operations',
    roles: ['MANAGER'],
    component: OperationsDashboardPage,
  },
  {
    key: 'report-amenity',
    label: 'Thống kê tiện ích',
    icon: PieChartOutlined,
    path: 'report-amenity',
    roles: ['MANAGER', 'ACCOUNTANT'],
    component: AmenityUsagePage,
  },
];

// Giao diện cư dân (/r/*) — hiện ở thanh điều hướng dưới cùng, nên giữ tối đa 5 mục.
// Thông báo vào qua chuông trên header nên ẩn khỏi thanh dưới.
export const residentMenu = [
  { key: 'home', label: 'Trang chủ', icon: HomeOutlined, path: 'home', component: HomePage },
  { key: 'tickets', label: 'Phản ánh', icon: ToolOutlined, path: 'tickets', component: ResidentTicketsPage },
  {
    key: 'ticket-detail',
    label: 'Chi tiết phản ánh',
    path: 'tickets/:id',
    component: TicketDetailPage,
    hideInMenu: true,
  },
  { key: 'guests', label: 'Khách', icon: UsergroupAddOutlined, path: 'guests', component: ResidentGuestsPage },
  {
    key: 'announcements',
    label: 'Bảng tin',
    icon: AppstoreOutlined,
    path: 'announcements',
    component: AnnouncementsPage,
  },
  {
    key: 'notifications',
    label: 'Thông báo',
    icon: BellOutlined,
    path: 'notifications',
    component: NotificationsPage,
    hideInMenu: true,
  },
];

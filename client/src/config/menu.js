import { lazy } from 'react';
import {
  AppstoreOutlined,
  BankOutlined,
  CarOutlined,
  CoffeeOutlined,
  BarChartOutlined,
  BellOutlined,
  CheckSquareOutlined,
  ClusterOutlined,
  DashboardOutlined,
  FileTextOutlined,
  FundOutlined,
  HomeOutlined,
  NotificationOutlined,
  IdcardOutlined,
  TagsOutlined,
  PieChartOutlined,
  ScheduleOutlined,
  SettingOutlined,
  TeamOutlined,
  ToolOutlined,
  UsergroupAddOutlined,
  UserOutlined,
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
//     group: 'Tài chính',               // (tuỳ chọn, chỉ /app) nhóm hiển thị trên sidebar — dùng 1 trong MENU_GROUPS
//   }

// Thứ tự các nhóm trên sidebar /app. Mục không khai báo group rơi vào 'Tổng quan'.
export const MENU_GROUPS = [
  'Tổng quan',
  'Cư dân & dịch vụ',
  'Tài chính',
  'Kỹ thuật & vận hành',
  'Tiện ích & khách',
  'Báo cáo',
  'Cấu hình',
];

const HomePage = lazy(() => import('../features/home/HomePage'));
const ResidentHomePage = lazy(() => import('../features/home/ResidentHomePage'));

// ===== Module A (Vũ Việt) =====
const ProfilePage = lazy(() => import('../features/profile/ProfilePage'));
const InternalAccountsPage = lazy(() => import('../features/users/InternalAccountsPage'));
const BuildingsPage = lazy(() => import('../features/buildings/BuildingsPage'));
const ContractsPage = lazy(() => import('../features/contracts/ContractsPage'));
const ApartmentDetailPage = lazy(() => import('../features/apartments/ApartmentDetailPage'));
const MyApartmentPage = lazy(() => import('../features/residents/MyApartmentPage'));
const VehicleRequestsPage = lazy(() => import('../features/vehicles/VehicleRequestsPage'));
const MyVehiclesPage = lazy(() => import('../features/vehicles/MyVehiclesPage'));
const SystemDashboardPage = lazy(() => import('../features/adminDashboard/SystemDashboardPage'));

// ===== Module D (Thanh Bình) =====
const AssetsPage = lazy(() => import('../features/assets/AssetsPage'));
const AssetDetailPage = lazy(() => import('../features/assets/AssetDetailPage'));
const WorkOrdersPage = lazy(() => import('../features/workOrders/WorkOrdersPage'));
const AmenitiesPage = lazy(() => import('../features/amenities/AmenitiesPage'));
const MyCodePage = lazy(() => import('../features/memberCodes/MyCodePage'));
const FamilyPage = lazy(() => import('../features/memberCodes/FamilyPage'));
const MyPassesPage = lazy(() => import('../features/amenityPasses/MyPassesPage'));
const AmenityPassesPage = lazy(() => import('../features/amenityPasses/AmenityPassesPage'));
const UtilitiesPage = lazy(() => import('../features/bookings/UtilitiesPage'));
const AmenityBookingPage = lazy(() => import('../features/bookings/AmenityBookingPage'));
const MyBookingsPage = lazy(() => import('../features/bookings/MyBookingsPage'));

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
    group: 'Cư dân & dịch vụ',
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
    group: 'Cấu hình',
    label: 'Danh mục & tham số',
    icon: SettingOutlined,
    path: 'complaint-settings',
    roles: ['MANAGER'],
    component: ComplaintSettingsPage,
  },
  // Tài sản & bảo trì (UC-D01)
  {
    key: 'assets',
    group: 'Kỹ thuật & vận hành',
    label: 'Tài sản',
    icon: ClusterOutlined,
    path: 'assets',
    roles: ['MANAGER', 'STAFF:TECHNICIAN'],
    component: AssetsPage,
  },
  {
    key: 'asset-detail',
    label: 'Chi tiết tài sản',
    path: 'assets/:id',
    roles: ['MANAGER', 'STAFF:TECHNICIAN'],
    component: AssetDetailPage,
    hideInMenu: true,
  },
  // Work order: danh sách + phân công (UC-D03)
  {
    key: 'work-orders',
    group: 'Kỹ thuật & vận hành',
    label: 'Work order',
    icon: ScheduleOutlined,
    path: 'work-orders',
    roles: ['MANAGER'],
    component: WorkOrdersPage,
  },
  // Work order của tôi: KTV bắt đầu / hoàn thành (UC-D04) — dùng lại WorkOrdersPage ở chế độ KTV
  {
    key: 'my-work-orders',
    group: 'Kỹ thuật & vận hành',
    label: 'Work order của tôi',
    icon: CheckSquareOutlined,
    path: 'my-work-orders',
    roles: ['STAFF:TECHNICIAN'],
    component: WorkOrdersPage,
  },
  // Tiện ích (UC-D05)
  {
    key: 'amenities',
    group: 'Tiện ích & khách',
    label: 'Tiện ích',
    icon: CoffeeOutlined,
    path: 'amenities',
    roles: ['MANAGER'],
    component: AmenitiesPage,
  },
  // Gói tháng tiện ích (UC-D09): Trưởng BQL hủy được, Lễ tân chỉ xem
  {
    key: 'amenity-passes',
    group: 'Tiện ích & khách',
    label: 'Gói tháng',
    icon: TagsOutlined,
    path: 'amenity-passes',
    roles: ['MANAGER', 'STAFF:RECEPTIONIST'],
    component: AmenityPassesPage,
  },
  // Sổ khách (UC-E08)
  {
    key: 'guests',
    group: 'Tiện ích & khách',
    label: 'Sổ khách',
    icon: UsergroupAddOutlined,
    path: 'guests',
    roles: ['STAFF:SECURITY', 'STAFF:RECEPTIONIST', 'MANAGER'],
    component: GuestBookPage,
  },
  // Bảng tin & thông báo (UC-E09)
  {
    key: 'announcements',
    group: 'Cư dân & dịch vụ',
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
    group: 'Báo cáo',
    label: 'Báo cáo thu phí',
    icon: BarChartOutlined,
    path: 'report-billing',
    roles: ['MANAGER', 'ACCOUNTANT', 'BOARD'],
    component: BillingReportPage,
  },
  {
    key: 'report-fund',
    group: 'Báo cáo',
    label: 'Dashboard quỹ',
    icon: FundOutlined,
    path: 'report-fund',
    roles: ['MANAGER', 'BOARD'],
    component: FundDashboardPage,
  },
  {
    key: 'report-operations',
    group: 'Báo cáo',
    label: 'Dashboard vận hành',
    icon: DashboardOutlined,
    path: 'report-operations',
    roles: ['MANAGER'],
    component: OperationsDashboardPage,
  },
  {
    key: 'report-amenity',
    group: 'Báo cáo',
    label: 'Thống kê tiện ích',
    icon: PieChartOutlined,
    path: 'report-amenity',
    roles: ['MANAGER', 'ACCOUNTANT'],
    component: AmenityUsagePage,
  },

  // ===== Module A (Vũ Việt) =====
  {
    key: 'contracts',
    group: 'Cư dân & dịch vụ',
    label: 'Hợp đồng',
    icon: FileTextOutlined,
    path: 'contracts',
    roles: ['MANAGER', 'STAFF:RECEPTIONIST'],
    component: ContractsPage,
  },
  {
    key: 'vehicle-requests',
    group: 'Cư dân & dịch vụ',
    label: 'Yêu cầu gửi xe',
    icon: CarOutlined,
    path: 'vehicle-requests',
    roles: ['MANAGER', 'STAFF:RECEPTIONIST'],
    component: VehicleRequestsPage,
  },
  {
    key: 'buildings',
    group: 'Cấu hình',
    label: 'Tòa nhà & Căn hộ',
    icon: BankOutlined,
    path: 'buildings',
    roles: ['ADMIN', 'MANAGER', 'STAFF:RECEPTIONIST'],
    component: BuildingsPage,
  },
  {
    key: 'internal-accounts',
    group: 'Cấu hình',
    label: 'Tài khoản nội bộ',
    icon: TeamOutlined,
    path: 'internal-accounts',
    roles: ['ADMIN'],
    component: InternalAccountsPage,
  },
  {
    key: 'apartment-detail',
    label: 'Chi tiết căn hộ',
    path: 'apartments/:id',
    roles: ['MANAGER', 'STAFF:RECEPTIONIST'],
    component: ApartmentDetailPage,
    hideInMenu: true,
  },
  {
    key: 'profile',
    group: 'Tổng quan',
    label: 'Hồ sơ cá nhân',
    icon: UserOutlined,
    path: 'profile',
    component: ProfilePage,
    hideInMenu: true,
  },
  {
    key: 'system-dashboard',
    group: 'Tổng quan',
    label: 'Dashboard hệ thống',
    icon: DashboardOutlined,
    path: 'system-dashboard',
    roles: ['ADMIN'],
    component: SystemDashboardPage,
  },
];

// Giao diện cư dân (/r/*). Mục nào hiện ở đâu do residentBottomNav / residentWebNav bên dưới quyết định
// (theo `key`), không còn do hideInMenu. Thông báo vào qua chuông trên header.
export const residentMenu = [
  { key: 'home', label: 'Trang chủ', icon: HomeOutlined, path: 'home', component: ResidentHomePage },
  { key: 'tickets', label: 'Phản ánh', icon: ToolOutlined, path: 'tickets', component: ResidentTicketsPage },
  {
    key: 'ticket-detail',
    label: 'Chi tiết phản ánh',
    path: 'tickets/:id',
    component: TicketDetailPage,
    hideInMenu: true,
  },
  { key: 'guests', label: 'Khách', icon: UsergroupAddOutlined, path: 'guests', component: ResidentGuestsPage },
  // Thẻ cư dân (UC-D11): mã chữ; trang Gia đình chỉ chủ hộ, mở từ nút trong "Mã của tôi"
  { key: 'my-code', label: 'Mã của tôi', icon: IdcardOutlined, path: 'my-code', component: MyCodePage },
  { key: 'family', label: 'Gia đình', path: 'my-code/family', component: FamilyPage, hideInMenu: true },
  // Gói tháng tiện ích (UC-D09): mở từ "Mã của tôi" / "Gia đình" (thanh dưới đã khá chật)
  { key: 'my-passes', label: 'Gói tháng', path: 'my-code/passes', component: MyPassesPage, hideInMenu: true },
  // Đặt tiện ích (UC-D06). 'amenities/bookings' (đường dẫn tĩnh) được ưu tiên hơn 'amenities/:id'
  { key: 'amenities', label: 'Tiện ích', icon: CoffeeOutlined, path: 'amenities', component: UtilitiesPage },
  { key: 'my-bookings', label: 'Lịch sử đặt', path: 'amenities/bookings', component: MyBookingsPage, hideInMenu: true },
  { key: 'amenity-booking', label: 'Đặt tiện ích', path: 'amenities/:id', component: AmenityBookingPage, hideInMenu: true },
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
  // ===== Module A (Vũ Việt) =====
  {
    key: 'my-apartment',
    label: 'Căn hộ của tôi',
    icon: HomeOutlined,
    path: 'my-apartment',
    component: MyApartmentPage,
    hideInMenu: true,
  },
  {
    key: 'my-vehicles',
    label: 'Xe của tôi',
    icon: CarOutlined,
    path: 'my-vehicles',
    component: MyVehiclesPage,
    hideInMenu: true,
  },
  {
    key: 'profile',
    label: 'Hồ sơ cá nhân',
    icon: UserOutlined,
    path: 'profile',
    component: ProfilePage,
    hideInMenu: true,
  },
];

// Thanh điều hướng dưới (mobile): 5 mục, mục giữa là nút nổi "Mã của tôi". Bảng tin vào qua "Xem tất cả" ở trang chủ.
export const residentBottomNav = ['home', 'amenities', 'my-code', 'tickets', 'guests'];
// Thanh điều hướng ngang (web ≥768px). "Mã của tôi" là nút riêng bên phải nên không nằm trong danh sách này.
export const residentWebNav = ['home', 'amenities', 'tickets', 'guests', 'announcements'];

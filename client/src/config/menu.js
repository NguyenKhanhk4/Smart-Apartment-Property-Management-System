import { lazy } from 'react';
import {
  AppstoreOutlined,
  ProjectOutlined,
  BankOutlined,
  CarOutlined,
  CoffeeOutlined,
  BarChartOutlined,
  BellOutlined,
  CalendarOutlined,
  ScanOutlined,
  CheckSquareOutlined,
  ClusterOutlined,
  DashboardOutlined,
  DollarOutlined,
  FieldTimeOutlined,
  FileTextOutlined,
  FundOutlined,
  HomeOutlined,
  NotificationOutlined,
  IdcardOutlined,
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
//     roles: ['MANAGER', 'ACCOUNTANT'],      // spec như authorize() backend; bỏ trống = ai đăng nhập cũng xem được
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
const SelectApartmentPage = lazy(() => import('../features/auth/SelectApartmentPage'));

// ===== Module A (Vũ Việt) =====
const ProfilePage = lazy(() => import('../features/profile/ProfilePage'));
const InternalAccountsPage = lazy(() => import('../features/users/InternalAccountsPage'));
const IssueActivationCodePage = lazy(() => import('../features/users/IssueActivationCodePage'));
const BuildingsPage = lazy(() => import('../features/buildings/BuildingsPage'));
const ContractsPage = lazy(() => import('../features/contracts/ContractsPage'));
const ApartmentDetailPage = lazy(() => import('../features/apartments/ApartmentDetailPage'));
const MyApartmentPage = lazy(() => import('../features/residents/MyApartmentPage'));
const VehicleRequestsPage = lazy(() => import('../features/vehicles/VehicleRequestsPage'));
const MyVehiclesPage = lazy(() => import('../features/vehicles/MyVehiclesPage'));
const SystemDashboardPage = lazy(() => import('../features/systemDashboard/SystemDashboardPage'));

// ===== Module B =====
const FeeTypesPage = lazy(() => import('../features/feeTypes/FeeTypesPage'));
const InvoiceGeneratePage = lazy(() => import('../features/invoices/InvoiceGeneratePage'));
const InvoiceListPage = lazy(() => import('../features/invoices/InvoiceListPage'));
const InvoiceDetailPage = lazy(() => import('../features/invoices/InvoiceDetailPage'));
const MyInvoicesPage = lazy(() => import('../features/invoices/MyInvoicesPage'));
const MyInvoiceDetailPage = lazy(() => import('../features/invoices/MyInvoiceDetailPage'));
const PaymentListPage = lazy(() => import('../features/payments/PaymentListPage'));
const AdminReceiptPage = lazy(() => import('../features/payments/ReceiptPage'));
const MyReceiptPage = lazy(() => import('../features/payments/MyReceiptPage'));
const PaymentResultPage = lazy(() => import('../features/payments/PaymentResultPage'));
const DebtLedgerPage = lazy(() => import('../features/debts/DebtLedgerPage'));
const DebtApartmentPage = lazy(() => import('../features/debts/DebtApartmentPage'));
const FundPage = lazy(() => import('../features/fund/FundPage'));
const FundProposalPage = lazy(() => import('../features/fund/FundProposalPage'));

// ===== Người 1 — Vũ Việt (Mô đun 10: Thiết bị & bảo trì) =====
const AssetsPage = lazy(() => import('../features/assets/AssetsPage'));
const AssetDetailPage = lazy(() => import('../features/assets/AssetDetailPage'));
const WorkOrdersPage = lazy(() => import('../features/workOrders/WorkOrdersPage'));

// ===== Module D (Thanh Bình) =====
const AmenitiesPage = lazy(() => import('../features/amenities/AmenitiesPage'));
const MyCodePage = lazy(() => import('../features/memberCodes/MyCodePage'));
const FamilyPage = lazy(() => import('../features/memberCodes/FamilyPage'));
const BookingSchedulePage = lazy(() => import('../features/bookings/BookingSchedulePage'));
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
const FinanceDashboardPage = lazy(() => import('../features/reports/FinanceDashboardPage'));
const SupervisionPage = lazy(() => import('../features/reports/SupervisionPage'));

// ===== Sự cố & Tiện ích (Người 4) =====
const DutyShiftsPage = lazy(() => import('../features/dutyShifts/DutyShiftsPage'));
const TicketBoardPage = lazy(() => import('../features/tickets/TicketBoardPage'));

// ===== Module C — audit (TM) =====
const AuditLogsPage = lazy(() => import('../features/auditLogs/AuditLogsPage'));

// ===== Gate Pass & Kiểm soát xe (Người 2) =====
const ManagerGatePassesPage = lazy(() => import('../features/gatePasses/ManagerGatePassesPage'));
const ResidentGatePassesPage = lazy(() => import('../features/gatePasses/ResidentGatePassesPage'));
const SecurityGatePage = lazy(() => import('../features/security-gate/SecurityGatePage'));
const ParkingCardsPage = lazy(() => import('../features/vehicles/ParkingCardsPage'));
const OccupantChangesPage = lazy(() => import('../features/residents/OccupantChangesPage'));

// Giao diện nội bộ (/app/*) — hiện ở sidebar
export const adminMenu = [
  { key: 'home', label: 'Trang chủ', icon: HomeOutlined, path: 'home', component: HomePage },

  // Ticket (UC-E01..E04)
  {
    key: 'tickets',
    group: 'Cư dân & dịch vụ',
    label: 'Sự cố & phản ánh',
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
  // Kanban điều phối sự cố của Trưởng BQL (Người 4)
  {
    key: 'ticket-board',
    group: 'Kỹ thuật & vận hành',
    label: 'Điều phối sự cố',
    icon: ProjectOutlined,
    path: 'ticket-board',
    roles: ['MANAGER'],
    component: TicketBoardPage,
  },
  // Lịch ca trực Kỹ thuật / Bảo vệ (Người 4): Trưởng BQL xếp ca, nhân viên xem lịch
  {
    key: 'duty-shifts',
    group: 'Kỹ thuật & vận hành',
    label: 'Lịch ca trực',
    icon: FieldTimeOutlined,
    path: 'duty-shifts',
    roles: ['MANAGER', 'STAFF:TECHNICIAN', 'STAFF:SECURITY'],
    component: DutyShiftsPage,
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
  // Lịch đặt tiện ích trong ngày (UC-D07): lễ tân mọi thao tác, bảo vệ check-in, Trưởng BQL chỉ xem
  {
    key: 'booking-schedule',
    group: 'Tiện ích & khách',
    label: 'Lịch đặt tiện ích',
    icon: CalendarOutlined,
    path: 'booking-schedule',
    roles: ['STAFF:RECEPTIONIST', 'STAFF:SECURITY', 'MANAGER'],
    component: BookingSchedulePage,
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
    key: 'report-finance',
    group: 'Báo cáo',
    label: 'Dashboard tài chính',
    icon: DashboardOutlined,
    path: 'report-finance',
    roles: ['MANAGER', 'ACCOUNTANT'],
    component: FinanceDashboardPage,
  },
  {
    key: 'report-supervision',
    group: 'Báo cáo',
    label: 'Báo cáo giám sát',
    icon: FileTextOutlined,
    path: 'report-supervision',
    roles: ['BOARD', 'MANAGER'],
    component: SupervisionPage,
  },
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

  // ===== Module C — audit chỉ đọc =====
  {
    key: 'audit-logs', group: 'Cấu hình', label: 'Nhật ký hoạt động', icon: FileTextOutlined,
    path: 'audit-logs', roles: ['MANAGER', 'BOARD'], component: AuditLogsPage,
  },

  // ===== Module B — Phí & hóa đơn (UC-B01, UC-B02) =====
  {
    key: 'fee-types',
    group: 'Tài chính',
    label: 'Bảng phí',
    icon: DollarOutlined,
    path: 'fee-types',
    roles: ['MANAGER', 'ACCOUNTANT'],
    component: FeeTypesPage,
  },
  {
    key: 'invoice-generate',
    group: 'Tài chính',
    label: 'Tính phí',
    icon: FileTextOutlined,
    path: 'invoices/generate',
    roles: ['ACCOUNTANT', 'MANAGER'],
    component: InvoiceGeneratePage,
  },
  {
    key: 'invoices',
    group: 'Tài chính',
    label: 'Thông báo phí',
    icon: FileTextOutlined,
    path: 'invoices',
    roles: ['ACCOUNTANT', 'MANAGER'],
    component: InvoiceListPage,
  },
  {
    key: 'invoice-detail',
    label: 'Chi tiết thông báo phí',
    path: 'invoices/:id',
    roles: ['ACCOUNTANT', 'MANAGER'],
    component: InvoiceDetailPage,
    hideInMenu: true,
  },
  {
    key: 'payments',
    group: 'Tài chính',
    label: 'Giao dịch thu',
    icon: DollarOutlined,
    path: 'payments',
    roles: ['ACCOUNTANT', 'MANAGER'],
    component: PaymentListPage,
  },
  {
    key: 'payment-receipt',
    label: 'Biên lai',
    path: 'payments/:id/receipt',
    roles: ['ACCOUNTANT', 'MANAGER'],
    component: AdminReceiptPage,
    hideInMenu: true,
  },
  {
    key: 'debts',
    group: 'Tài chính',
    label: 'Sổ công nợ',
    icon: FundOutlined,
    path: 'debts',
    roles: ['ACCOUNTANT', 'MANAGER'],
    component: DebtLedgerPage,
  },
  {
    key: 'fund',
    group: 'Tài chính',
    label: 'Quỹ bảo trì',
    icon: BankOutlined,
    path: 'fund',
    roles: ['ACCOUNTANT', 'MANAGER', 'BOARD'],
    component: FundPage,
  },
  {
    key: 'fund-proposal',
    label: 'Đề xuất chi quỹ',
    path: 'fund/proposals/:id',
    roles: ['ACCOUNTANT', 'MANAGER', 'BOARD'],
    component: FundProposalPage,
    hideInMenu: true,
  },
  {
    key: 'debt-apartment',
    label: 'Công nợ căn hộ',
    path: 'debts/apartments/:id',
    roles: ['ACCOUNTANT', 'MANAGER'],
    component: DebtApartmentPage,
    hideInMenu: true,
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
    roles: ['MANAGER', 'STAFF:RECEPTIONIST'],
    component: BuildingsPage,
  },
  {
    key: 'activation-codes',
    group: 'Cấu hình',
    label: 'Cấp mã kích hoạt',
    icon: IdcardOutlined,
    path: 'activation-codes',
    roles: ['STAFF:RECEPTIONIST', 'MANAGER'],
    component: IssueActivationCodePage,
  },
  {
    key: 'internal-accounts',
    group: 'Cấu hình',
    label: 'Tài khoản nội bộ',
    icon: TeamOutlined,
    path: 'internal-accounts',
    roles: ['MANAGER'],
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
    roles: ['MANAGER'],
    component: SystemDashboardPage,
  },
  // ===== Gate Pass & Kiểm soát xe (Người 2) =====
  {
    key: 'gate-passes',
    group: 'Cư dân & dịch vụ',
    label: 'Duyệt Gate Pass',
    icon: FileTextOutlined,
    path: 'gate-passes',
    roles: ['MANAGER'],
    component: ManagerGatePassesPage,
  },
  {
    key: 'security-gate',
    group: 'Tiện ích & khách',
    label: 'Gate Pass & Tra biển số',
    icon: ScanOutlined,
    path: 'security-gate',
    roles: ['STAFF:SECURITY', 'MANAGER'],
    component: SecurityGatePage,
  },
  {
    key: 'parking-cards',
    group: 'Cư dân & dịch vụ',
    label: 'Thẻ cần thu hồi',
    icon: IdcardOutlined,
    path: 'parking-cards',
    roles: ['STAFF:RECEPTIONIST', 'MANAGER'],
    component: ParkingCardsPage,
  },
  {
    key: 'resident-changes',
    group: 'Cư dân & dịch vụ',
    label: 'Biến động nhân khẩu',
    icon: TeamOutlined,
    path: 'resident-changes',
    roles: ['STAFF:RECEPTIONIST', 'MANAGER'],
    component: OccupantChangesPage,
  },
];

// Sidebar riêng của Lễ tân (trang chủ mới): nhóm lại các mục có sẵn trong adminMenu theo `key`, kèm khóa badge số việc chờ.
// Chỉ đổi cách sắp xếp hiển thị; route và quyền vẫn lấy từ adminMenu.
export const receptionNav = [
  { items: [{ key: 'home' }] },
  {
    group: 'Vận hành hằng ngày',
    items: [
      { key: 'guests', badge: 'guestsPending', badgeTone: 'neutral' },
      { key: 'booking-schedule', badge: 'bookingsWaiting' },
      { key: 'tickets', badge: 'ticketsNew' },
      { key: 'vehicle-requests', badge: 'vehiclesPending' },
      { key: 'parking-cards' },
      { key: 'resident-changes' },
      { key: 'contracts' },
    ],
  },
  { group: 'Cư dân và dịch vụ', items: [{ key: 'announcements' }, { key: 'activation-codes' }] },
  { group: 'Cấu hình', items: [{ key: 'buildings' }] },
];

// Giao diện cư dân (/r/*). Mục nào hiện ở đâu do residentBottomNav / residentWebNav bên dưới quyết định
// (theo `key`), không còn do hideInMenu. Thông báo vào qua chuông trên header.
export const residentMenu = [
  { key: 'home', label: 'Trang chủ', icon: HomeOutlined, path: 'home', component: ResidentHomePage },
  { key: 'select-apartment', label: 'Chọn căn hộ', path: 'select-apartment', component: SelectApartmentPage, hideInMenu: true },
  { key: 'tickets', label: 'Phản ánh', icon: ToolOutlined, path: 'tickets', component: ResidentTicketsPage },
  {
    key: 'ticket-detail',
    label: 'Chi tiết phản ánh',
    path: 'tickets/:id',
    component: TicketDetailPage,
    hideInMenu: true,
  },
  { key: 'guests', label: 'Khách', icon: UsergroupAddOutlined, path: 'guests', component: ResidentGuestsPage },
  // Mô đun 4 — thông báo phí của căn đang chọn (UC28)
  { key: 'my-invoices', label: 'Phí dịch vụ', icon: DollarOutlined, path: 'invoices', component: MyInvoicesPage },
  { key: 'my-invoice-detail', label: 'Chi tiết phí', path: 'invoices/:id', component: MyInvoiceDetailPage, hideInMenu: true },
  { key: 'my-receipt', label: 'Biên lai', path: 'payments/:id/receipt', component: MyReceiptPage, hideInMenu: true },
  // payOS trả về sau khi thanh toán (PAYOS_RETURN_URL / PAYOS_CANCEL_URL). Đường tĩnh 'result' ưu tiên hơn ':id'
  { key: 'payment-result', label: 'Kết quả thanh toán', path: 'payments/result', component: PaymentResultPage, hideInMenu: true },
  // Thẻ cư dân (UC-D11): mã chữ; trang Gia đình chỉ chủ hộ, mở từ nút trong "Mã của tôi"
  { key: 'my-code', label: 'Mã của tôi', icon: IdcardOutlined, path: 'my-code', component: MyCodePage },
  { key: 'family', label: 'Gia đình', path: 'my-code/family', component: FamilyPage, hideInMenu: true },
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
  {
    key: 'gate-passes',
    label: 'Đơn chuyển đồ',
    icon: FileTextOutlined,
    path: 'gate-passes',
    component: ResidentGatePassesPage,
  },
];

// Thanh điều hướng dưới (mobile): 5 mục, mục giữa là nút nổi "Mã của tôi". Bảng tin vào qua "Xem tất cả" ở trang chủ.
export const residentBottomNav = ['home', 'amenities', 'my-code', 'tickets', 'guests'];
// Thanh điều hướng ngang (web ≥768px). "Mã của tôi" là nút riêng bên phải nên không nằm trong danh sách này.
export const residentWebNav = ['home', 'my-invoices', 'amenities', 'tickets', 'guests', 'announcements'];

// Toàn bộ Mongoose model của hệ thống (srs_final.md §III.2.2 — 27 collection).
// Module nào cũng import từ đây: import { Ticket, User } from '../../models/index.js';
// Sơ đồ quan hệ + giải thích từng collection: doc/database_design.md

// Module A — Tài khoản, tòa nhà, căn hộ, cư dân, hợp đồng, xe
export { User } from './User.js';
export { VerificationCode } from './VerificationCode.js';
export { RolePermission } from './RolePermission.js';
export { Building } from './Building.js';
export { Apartment } from './Apartment.js';
export { Contract } from './Contract.js';
export { Resident } from './Resident.js';
export { Vehicle } from './Vehicle.js';
export { GatePass } from './GatePass.js';
export { ParkingCard } from './ParkingCard.js';
export { ParkingSession } from './ParkingSession.js';

// Module B — Phí, hóa đơn, thanh toán, công nợ
export { FeeType } from './FeeType.js';
export { Invoice } from './Invoice.js';
export { Payment } from './Payment.js';
export { PrepaidBalance } from './PrepaidBalance.js';
export { PrepaidTransaction } from './PrepaidTransaction.js';
export { InvoiceAdjustment } from './InvoiceAdjustment.js';
export { DebtFollowup } from './DebtFollowup.js';
export { RepairQuote } from './RepairQuote.js'; // báo giá sửa chữa trong căn hộ (Mô đun 5, phần Người 3)

// Module C — Quỹ bảo trì, chi phí vận hành, audit log
export { MaintenanceFund } from './MaintenanceFund.js';
export { FundTransaction } from './FundTransaction.js';
export { FundProposal } from './FundProposal.js';
export { OperatingExpense } from './OperatingExpense.js';
export { AuditLog } from './AuditLog.js';

// Người 1 — Thiết bị, bảo trì (Mô đun 10)
export { Asset } from './Asset.js';
export { WorkOrder } from './WorkOrder.js';

// Module D — Tiện ích
export { Amenity } from './Amenity.js';
export { Booking } from './Booking.js';
export { MemberCode } from './MemberCode.js';
export { DutyShift } from './DutyShift.js';

// Module E — Ticket, sổ khách, bảng tin, thông báo, tham số hệ thống
export { ComplaintCategory } from './ComplaintCategory.js';
export { Ticket } from './Ticket.js';
export { GuestLog } from './GuestLog.js';
export { Announcement } from './Announcement.js';
export { Notification } from './Notification.js';
export { SystemConfig } from './SystemConfig.js';

// Hệ thống
export { CronRun } from './CronRun.js';

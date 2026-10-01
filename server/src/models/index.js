// Toàn bộ Mongoose model của hệ thống (srs_final.md §III.2.2 — 27 collection).
// Module nào cũng import từ đây: import { Ticket, User } from '../../models/index.js';
// Sơ đồ quan hệ + giải thích từng collection: doc/database_design.md

// Module A — Tài khoản, tòa nhà, căn hộ, cư dân, hợp đồng, xe
export { User } from './User.js';
export { Building } from './Building.js';
export { Apartment } from './Apartment.js';
export { Contract } from './Contract.js';
export { Resident } from './Resident.js';
export { Vehicle } from './Vehicle.js';

// Module B — Phí, hóa đơn, thanh toán, công nợ
export { FeeType } from './FeeType.js';
export { Invoice } from './Invoice.js';
export { Payment } from './Payment.js';
export { InvoiceAdjustment } from './InvoiceAdjustment.js';
export { DebtFollowup } from './DebtFollowup.js';

// Module C — Quỹ bảo trì, chi phí vận hành, audit log
export { MaintenanceFund } from './MaintenanceFund.js';
export { FundTransaction } from './FundTransaction.js';
export { FundProposal } from './FundProposal.js';
export { OperatingExpense } from './OperatingExpense.js';
export { AuditLog } from './AuditLog.js';

// Module D — Tài sản, bảo trì, tiện ích
export { Asset } from './Asset.js';
export { WorkOrder } from './WorkOrder.js';
export { Amenity } from './Amenity.js';
export { Booking } from './Booking.js';

// Module E — Ticket, sổ khách, bảng tin, thông báo, tham số hệ thống
export { ComplaintCategory } from './ComplaintCategory.js';
export { Ticket } from './Ticket.js';
export { GuestLog } from './GuestLog.js';
export { Announcement } from './Announcement.js';
export { Notification } from './Notification.js';
export { SystemConfig } from './SystemConfig.js';

// Hệ thống
export { CronRun } from './CronRun.js';

import { AMENITY_ACCESS_MODES, AUDIT_ACTIONS, BOOKING_STATUS, ROLES } from '../../constants/enums.js';
import { Amenity, Apartment, Booking, Building } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { getActiveApartmentIds } from '../../services/residency.service.js';
import { uploadToCloudinary } from '../../services/upload.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeRegex, paginate } from '../../utils/pagination.js';
import { accessModeOf, priceSummaryOf } from './pricing.js';
import { getBookingConfig, toMinutes } from './slot.utils.js';

// Booking còn hiệu lực: đã xác nhận hoặc đang dùng (BR-O19)
export const ACTIVE_BOOKING_STATUSES = [BOOKING_STATUS.APPROVED, BOOKING_STATUS.CHECKED_IN];

const POPULATE = [{ path: 'buildingId', select: 'code name' }];

const MODE = AMENITY_ACCESS_MODES;

// Các trường phụ thuộc kiểu tiện ích — đổi kiểu thì bắt nhập lại nhóm trường của kiểu mới
const MODE_FIELDS = [
  'accessMode',
  'openTime',
  'closeTime',
  'slotDurationMinutes',
  'capacityPerSlot',
  'feePerBooking',
  'perVisitFeeAdult',
  'perVisitFeeChild',
  'maxConcurrent',
  'monthlyPassFeeAdult',
  'monthlyPassFeeChild',
];
const COMMON_FIELDS = ['name', 'buildingId', 'location', 'description'];
// Trường phí: đổi bất kỳ trường nào đều ghi audit AMENITY_FEE_CHANGED
const FEE_FIELDS = ['feePerBooking', 'perVisitFeeAdult', 'perVisitFeeChild', 'monthlyPassFeeAdult', 'monthlyPassFeeChild'];
// Khi đổi kiểu: bỏ giá trị cũ của các trường này (giờ mở cửa và gói tháng được giữ lại)
const RESET_ON_MODE_CHANGE = ['slotDurationMinutes', 'capacityPerSlot', 'feePerBooking', 'perVisitFeeAdult', 'perVisitFeeChild', 'maxConcurrent'];

const LABELS = {
  openTime: 'Giờ mở cửa',
  closeTime: 'Giờ đóng cửa',
  slotDurationMinutes: 'Thời lượng slot',
  capacityPerSlot: 'Sức chứa mỗi slot',
  perVisitFeeAdult: 'Giá vé người lớn',
  perVisitFeeChild: 'Giá vé trẻ em',
  monthlyPassFeeAdult: 'Giá gói tháng người lớn',
  monthlyPassFeeChild: 'Giá gói tháng trẻ em',
};

const blank = (v) => v === undefined || v === null || v === '';
const orNull = (v) => (blank(v) ? null : v);
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));

/**
 * Kiểm tra giá trị tiện ích theo kiểu (accessMode) và trả đúng nhóm trường cần lưu (trường không thuộc kiểu → 0/null).
 * Gom hết lỗi theo field để form hiện đúng chỗ.
 *  - FREE: giờ mở cửa tùy chọn (chỉ hiển thị, KHÔNG áp BR-O15), không phí/slot/gói
 *  - WALK_IN: giờ mở cửa bắt buộc + BR-O15; giá vé người lớn/trẻ em bắt buộc; gói tháng, maxConcurrent tùy chọn
 *  - BOOKING: giờ mở cửa + BR-O15 (vừa ≥ 1 slot); slot, sức chứa bắt buộc; phí đặt mặc định 0; gói tháng tùy chọn
 */
export async function resolveAmenityFields(raw) {
  const mode = raw.accessMode ?? MODE.BOOKING;
  const { receptionOpen, receptionClose } = await getBookingConfig();
  const details = [];
  const required = (field) => {
    if (blank(raw[field])) details.push({ field, message: `${LABELS[field]} là bắt buộc` });
  };

  // --- Giờ mở cửa ---
  const hasOpen = !blank(raw.openTime);
  const hasClose = !blank(raw.closeTime);
  if (mode === MODE.FREE) {
    if (hasOpen !== hasClose) required(hasOpen ? 'closeTime' : 'openTime');
  } else {
    required('openTime');
    required('closeTime');
  }
  if (hasOpen && hasClose) {
    const open = toMinutes(raw.openTime);
    const close = toMinutes(raw.closeTime);
    if (mode !== MODE.FREE) {
      // BR-O15: giờ mở cửa nằm trong giờ làm việc lễ tân (đọc từ system_configs)
      if (open < toMinutes(receptionOpen)) {
        details.push({ field: 'openTime', message: `Giờ mở cửa không được sớm hơn giờ lễ tân bắt đầu làm việc (${receptionOpen})` });
      }
      if (close > toMinutes(receptionClose)) {
        details.push({ field: 'closeTime', message: `Giờ đóng cửa không được muộn hơn giờ lễ tân nghỉ (${receptionClose})` });
      }
    }
    if (open >= close) {
      details.push({ field: 'closeTime', message: 'Giờ đóng cửa phải sau giờ mở cửa' });
    } else if (mode === MODE.BOOKING && !blank(raw.slotDurationMinutes) && open + raw.slotDurationMinutes > close) {
      details.push({ field: 'slotDurationMinutes', message: 'Khung giờ mở cửa không đủ cho 1 slot' });
    }
  }

  // --- Trường riêng của từng kiểu ---
  if (mode === MODE.BOOKING) {
    required('slotDurationMinutes');
    required('capacityPerSlot');
  }
  if (mode === MODE.WALK_IN) {
    required('perVisitFeeAdult');
    required('perVisitFeeChild');
  }

  // --- Gói tháng (WALK_IN / BOOKING): nhập đủ cả hai giá hoặc để trống cả hai (null = không bán gói) ---
  const sellsPass = mode !== MODE.FREE;
  const passAdult = sellsPass ? orNull(raw.monthlyPassFeeAdult) : null;
  const passChild = sellsPass ? orNull(raw.monthlyPassFeeChild) : null;
  if ((passAdult === null) !== (passChild === null)) {
    details.push({
      field: passAdult === null ? 'monthlyPassFeeAdult' : 'monthlyPassFeeChild',
      message: 'Gói tháng cần nhập cả giá người lớn và giá trẻ em (hoặc để trống cả hai nếu không bán gói)',
    });
  }

  if (details.length) throw ApiError.badRequest(details[0].message, details);

  return {
    accessMode: mode,
    openTime: orNull(raw.openTime),
    closeTime: orNull(raw.closeTime),
    slotDurationMinutes: mode === MODE.BOOKING ? raw.slotDurationMinutes : null,
    capacityPerSlot: mode === MODE.BOOKING ? raw.capacityPerSlot : null,
    feePerBooking: mode === MODE.BOOKING ? (orNull(raw.feePerBooking) ?? 0) : 0,
    perVisitFeeAdult: mode === MODE.WALK_IN ? raw.perVisitFeeAdult : 0,
    perVisitFeeChild: mode === MODE.WALK_IN ? raw.perVisitFeeChild : 0,
    maxConcurrent: mode === MODE.WALK_IN ? orNull(raw.maxConcurrent) : null,
    monthlyPassFeeAdult: passAdult,
    monthlyPassFeeChild: passChild,
  };
}

/** Thêm accessMode (bản ghi cũ → BOOKING) và priceSummary tính sẵn để FE hiển thị */
export function presentAmenity(doc) {
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    ...o,
    accessMode: accessModeOf(o),
    perVisitFeeAdult: o.perVisitFeeAdult ?? 0,
    perVisitFeeChild: o.perVisitFeeChild ?? 0,
    maxConcurrent: o.maxConcurrent ?? null,
    monthlyPassFeeAdult: o.monthlyPassFeeAdult ?? null,
    monthlyPassFeeChild: o.monthlyPassFeeChild ?? null,
    priceSummary: priceSummaryOf(o),
  };
}

/** Tòa của các căn cư dân đang ở — cư dân chỉ dùng tiện ích chung + tiện ích của tòa mình */
async function residentBuildingIds(userId) {
  const apartmentIds = await getActiveApartmentIds(userId);
  return Apartment.find({ _id: { $in: apartmentIds } }).distinct('buildingId');
}

async function visibilityFilter(user) {
  if (user.role !== ROLES.RESIDENT) return {};
  const buildingIds = await residentBuildingIds(user.id);
  return { isActive: true, $or: [{ buildingId: null }, { buildingId: { $in: buildingIds } }] };
}

async function normalizeBuilding(body) {
  if (!('buildingId' in body)) return;
  if (!body.buildingId) {
    body.buildingId = null; // để trống = dùng chung toàn khu
    return;
  }
  if (!(await Building.exists({ _id: body.buildingId }))) {
    throw ApiError.badRequest('Tòa nhà không tồn tại', [{ field: 'buildingId', message: 'Không tồn tại' }]);
  }
}

// ===== UC-D05: danh sách (Manager/Lễ tân thấy tất cả; cư dân chỉ tiện ích đang mở & được dùng) =====
export async function listAmenities(user, query) {
  const filter = { ...(await visibilityFilter(user)) };
  if (query.isActive !== undefined && user.role !== ROLES.RESIDENT) filter.isActive = query.isActive;
  if (query.buildingId) filter.buildingId = query.buildingId;
  if (query.q) filter.name = new RegExp(escapeRegex(query.q), 'i');
  // Bản ghi cũ chưa có accessMode tính là BOOKING ($in [..., null] khớp cả trường thiếu)
  if (query.accessMode) filter.accessMode = query.accessMode === MODE.BOOKING ? { $in: [MODE.BOOKING, null] } : query.accessMode;
  const { items, pagination } = await paginate(Amenity, filter, query, { populate: POPULATE });
  return { items: items.map(presentAmenity), pagination };
}

export async function getAmenity(user, id) {
  const amenity = await Amenity.findOne({ _id: id, ...(await visibilityFilter(user)) })
    .populate(POPULATE)
    .lean();
  if (!amenity) throw ApiError.notFound('Không tìm thấy tiện ích');
  return presentAmenity(amenity);
}

async function uploadImage(files) {
  const [url] = await uploadToCloudinary(files ?? [], 'amenities');
  return url;
}

// ===== UC-D05: thêm tiện ích =====
export async function createAmenity(user, body, files) {
  await normalizeBuilding(body);
  const fields = await resolveAmenityFields(body);
  const imageUrl = (await uploadImage(files)) ?? null;
  const amenity = await Amenity.create({ ...pick(body, COMMON_FIELDS), ...fields, imageUrl, isActive: true, createdBy: user.id });
  return presentAmenity(amenity);
}

// ===== UC-D05: sửa tiện ích — chỉ áp dụng cho booking mới (booking lưu snapshot phí, BR-O13) =====
export async function updateAmenity(user, id, body, files) {
  const amenity = await Amenity.findById(id);
  if (!amenity) throw ApiError.notFound('Không tìm thấy tiện ích');
  const current = amenity.toObject();
  const oldMode = accessModeOf(current);
  const modeChanged = body.accessMode !== undefined && body.accessMode !== oldMode;
  // Đổi kiểu làm các booking sắp tới mất nghĩa → chặn (BR-O19)
  if (modeChanged && (await hasUpcomingBookings(id))) throw new ApiError('AMENITY_HAS_ACTIVE_BOOKINGS');

  await normalizeBuilding(body);
  // Kiểm tra trên giá trị sau khi ghép (sửa 1 field vẫn phải hợp lệ với các field cũ). Đổi kiểu → nhóm trường riêng
  // của kiểu cũ bị bỏ, phải nhập lại nhóm trường của kiểu mới.
  const merged = { ...pick(current, MODE_FIELDS), accessMode: oldMode };
  if (modeChanged) for (const f of RESET_ON_MODE_CHANGE) delete merged[f];
  Object.assign(merged, pick(body, MODE_FIELDS));
  const fields = await resolveAmenityFields(merged);

  const oldFees = Object.fromEntries(FEE_FIELDS.map((f) => [f, current[f] ?? null]));
  amenity.set({ ...pick(body, COMMON_FIELDS), ...fields });
  const imageUrl = await uploadImage(files);
  if (imageUrl) amenity.imageUrl = imageUrl;
  await amenity.save();

  // Booking mới có thể chen vào giữa lúc kiểm tra và lúc ghi → kiểm tra lại, hoàn tác kiểu cũ (cùng cách với setAmenityStatus)
  if (modeChanged && (await hasUpcomingBookings(id))) {
    await Amenity.updateOne({ _id: id }, { $set: pick(current, MODE_FIELDS) });
    throw new ApiError('AMENITY_HAS_ACTIVE_BOOKINGS');
  }

  const changes = {};
  for (const f of FEE_FIELDS) {
    const next = amenity.get(f) ?? null;
    if (next !== oldFees[f]) changes[f] = [oldFees[f], next];
  }
  if (Object.keys(changes).length) {
    await logAudit({
      action: AUDIT_ACTIONS.AMENITY_FEE_CHANGED,
      user,
      targetType: 'amenities',
      targetId: amenity._id,
      metadata: { name: amenity.name, changes },
    });
  }
  return presentAmenity(amenity);
}

const hasUpcomingBookings = (amenityId) =>
  Booking.exists({ amenityId, status: { $in: ACTIVE_BOOKING_STATUSES }, endAt: { $gt: new Date() } });

// ===== UC-D05: ngừng / kích hoạt lại (không xóa cứng — BR-O17; BR-O19) =====
export async function setAmenityStatus(id, isActive) {
  const amenity = await Amenity.findById(id);
  if (!amenity) throw ApiError.notFound('Không tìm thấy tiện ích');
  if (!isActive && (await hasUpcomingBookings(id))) throw new ApiError('AMENITY_HAS_ACTIVE_BOOKINGS');
  amenity.isActive = isActive;
  await amenity.save();
  // Booking mới có thể chen vào giữa lúc kiểm tra và lúc ghi → kiểm tra lại sau khi ghi (cùng cách với tài sản UC-D01).
  // Bước đặt chỗ (UC-D06) cũng phải đọc lại isActive sau khi tạo booking.
  if (!isActive && (await hasUpcomingBookings(id))) {
    await Amenity.updateOne({ _id: id }, { isActive: true });
    throw new ApiError('AMENITY_HAS_ACTIVE_BOOKINGS');
  }
  return presentAmenity(amenity);
}

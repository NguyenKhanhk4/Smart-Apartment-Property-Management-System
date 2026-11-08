import ExcelJS from 'exceljs';
import { AUDIT_ACTIONS, AUDIT_TARGETS } from '../../constants/enums.js';
import { Apartment, Building, Resident } from '../../models/index.js';
import { logAudit } from '../../services/auditLog.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { fmtDateVn, toVnYmd } from '../../utils/time.js';
import { decryptIdNumber, maskIdNumber } from '../residents/idCrypto.js';
import {
  currentOccupants,
  effectiveOccupancy,
  findLegacyDeclarations,
  occupancyResidentSort,
} from '../residents/residentOccupancy.js';

const RELATION_LABELS = {
  OWNER: 'Chủ sở hữu đang ở',
  TENANT: 'Khách thuê (chủ hộ hiện tại)',
  FAMILY_MEMBER: 'Thành viên ở cùng',
};
const OCCUPANCY_LABELS = {
  NOT_HANDED_OVER: 'Chưa bàn giao',
  VACANT: 'Đang trống',
  OWNER_OCCUPIED: 'Chủ nhà đang ở',
  RENTED: 'Đang cho thuê',
  UNDER_REPAIR: 'Đang sửa chữa',
};

function reportPerson(row, isHead) {
  return {
    _id: row._id,
    fullName: row.userId?.fullName || row.fullName || '—',
    dateOfBirth: row.userId?.dateOfBirth ?? row.dateOfBirth ?? null,
    idNumber: maskIdNumber(decryptIdNumber(row.idNumberEnc)),
    relationType: row.relationType,
    isHead,
  };
}

/** UC21 — Danh sách theo tòa và căn, chỉ gồm chủ hộ đang ở và người họ khai báo. */
export async function listResidentOccupancy({ buildingId, floor } = {}, { now = new Date() } = {}) {
  const buildings = await Building.find(buildingId ? { _id: buildingId } : {})
    .select('code name address').sort({ code: 1, _id: 1 }).lean();
  const result = buildings.map((building) => ({ ...building, apartments: [] }));
  if (!result.length) return result;

  const byBuilding = new Map(result.map((building) => [String(building._id), building]));
  const apartments = await Apartment.find({
    buildingId: { $in: buildings.map((building) => building._id) },
    ...(floor == null ? {} : { floor }),
  }).select('code floor buildingId status occupancyStatus').sort({ code: 1, _id: 1 }).lean();
  const residents = await Resident.find({
    apartmentId: { $in: apartments.map((apartment) => apartment._id) },
    isActive: true,
    $or: [{ moveInDate: null }, { moveInDate: { $lte: now } }],
  }).populate('userId', 'fullName dateOfBirth').sort(occupancyResidentSort).lean();

  const byApartment = new Map();
  for (const resident of residents) {
    const key = String(resident.apartmentId);
    if (!byApartment.has(key)) byApartment.set(key, []);
    byApartment.get(key).push(resident);
  }
  const legacyDeclarations = await findLegacyDeclarations(residents);

  for (const apartment of apartments) {
    const rows = byApartment.get(String(apartment._id)) ?? [];
    const occupancyStatus = effectiveOccupancy(apartment);
    const occupants = currentOccupants(occupancyStatus, rows, legacyDeclarations)
      .map((resident, index) => reportPerson(resident, index === 0));

    byBuilding.get(String(apartment.buildingId)).apartments.push({
      _id: apartment._id, code: apartment.code, floor: apartment.floor ?? null, occupancyStatus, residents: occupants,
    });
  }
  return floor == null ? result : result.filter((building) => building.apartments.length > 0);
}

const SHEET_COLUMNS = [
  { header: 'STT', key: 'number', width: 8 },
  { header: 'Căn hộ', key: 'apartment', width: 14 },
  { header: 'Trạng thái căn', key: 'status', width: 22 },
  { header: 'Họ và tên', key: 'fullName', width: 28 },
  { header: 'Ngày sinh', key: 'dateOfBirth', width: 15 },
  { header: 'CCCD (che)', key: 'idNumber', width: 17 },
  { header: 'Vai trò tại căn', key: 'relation', width: 28 },
];

function describeBuildingSheet(building, index, now, floor) {
  const safeName = building.name.replace(/[\\/*?:[\]]/g, ' ');
  const name = (String(index + 1) + '. ' + safeName).slice(0, 31).replace(/'+$/, '');
  const rows = [];
  for (const apartment of building.apartments) {
    for (const resident of apartment.residents) {
      rows.push({
        number: rows.length + 1,
        apartment: apartment.code,
        status: OCCUPANCY_LABELS[apartment.occupancyStatus] ?? apartment.occupancyStatus,
        fullName: resident.fullName,
        dateOfBirth: resident.dateOfBirth ? fmtDateVn(resident.dateOfBirth) : '',
        idNumber: resident.idNumber || '',
        relation: RELATION_LABELS[resident.relationType],
      });
    }
  }
  return {
    name,
    title: [building.name, building.address].filter(Boolean).join(' · '),
    summary: [
      'Ngày xuất ' + fmtDateVn(now),
      floor == null ? null : 'Tầng ' + floor,
      rows.length + ' người đang ở',
    ].filter(Boolean).join(' · '),
    rows,
  };
}

export async function previewResidentOccupancyExcel(filters, { now = new Date() } = {}) {
  const buildings = await listResidentOccupancy(filters, { now });
  if (!buildings.length) throw ApiError.notFound('Chưa có tòa nhà phù hợp để xuất báo cáo');
  return {
    columns: SHEET_COLUMNS,
    sheets: buildings.map((building, index) => describeBuildingSheet(building, index, now, filters.floor)),
  };
}

export async function exportResidentOccupancyExcel(filters, actorUser, ip, { now = new Date() } = {}) {
  const { columns, sheets } = await previewResidentOccupancyExcel(filters, { now });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SAPMS';
  workbook.created = now;

  for (const { name, title, summary, rows } of sheets) {
    const sheet = workbook.addWorksheet(name);
    sheet.columns = columns.map(({ key, width }) => ({ key, width }));
    sheet.mergeCells(1, 1, 1, columns.length);
    sheet.getCell('A1').value = title;
    sheet.getRow(1).font = { bold: true };
    sheet.mergeCells(2, 1, 2, columns.length);
    sheet.getCell('A2').value = summary;
    sheet.addRow(columns.map(({ header }) => header)).font = { bold: true };
    sheet.addRows(rows);
    sheet.views = [{ state: 'frozen', ySplit: 3 }];
  }
  const buffer = await workbook.xlsx.writeBuffer();
  await logAudit({
    action: AUDIT_ACTIONS.RESIDENT_OCCUPANCY_EXPORTED,
    user: actorUser,
    targetType: AUDIT_TARGETS.RESIDENT,
    metadata: {
      buildingId: filters.buildingId ?? null,
      ...(filters.floor == null ? {} : { floor: filters.floor }),
      buildingCount: sheets.length,
      count: sheets.reduce((count, sheet) => count + sheet.rows.length, 0),
    },
    ip,
  });
  return { buffer, filename: 'thong-tin-cu-tru-' + toVnYmd(now) + '.xlsx' };
}

import ExcelJS from 'exceljs';
import { AUDIT_ACTIONS, AUDIT_TARGETS, OCCUPANT_CHANGE_TYPES } from '../../constants/enums.js';
import { logAudit } from '../../services/auditLog.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { DAY_MS, endOfVnDay, fmtDateVn, startOfVnDay, toVnYmd } from '../../utils/time.js';
import { decryptIdNumber, maskIdNumber } from '../residents/idCrypto.js';
import { Resident } from '../../models/index.js';

const RELATION_LABELS = {
  OWNER: 'Chủ sở hữu',
  TENANT: 'Người thuê',
  FAMILY_MEMBER: 'Thành viên gia đình',
};

const CHANGE_LABELS = {
  [OCCUPANT_CHANGE_TYPES.MOVE_IN]: 'Vào ở',
  [OCCUPANT_CHANGE_TYPES.MOVE_OUT]: 'Chuyển đi',
};

const formatVnDate = (date) => (date ? fmtDateVn(date) : '');

/** Giải mã idNumberEnc và trả về dạng che (4 số cuối, vd ********1234) */
const resolveMaskedId = (residentDoc) => maskIdNumber(decryptIdNumber(residentDoc?.idNumberEnc));

/**
 * UC21: Truy vấn danh sách biến động nhân khẩu trong khoảng [from, to]
 */
export async function listResidentChanges({ from, to }) {
  const now = new Date();
  const fromDate = from ? startOfVnDay(new Date(from)) : startOfVnDay(new Date(now.getTime() - 30 * DAY_MS));
  const toDate = to ? endOfVnDay(new Date(to)) : endOfVnDay(now);

  if (fromDate > toDate) {
    throw ApiError.badRequest('Ngày bắt đầu không được lớn hơn ngày kết thúc');
  }

  const residents = await Resident.find({
    $or: [
      { moveInDate: { $gte: fromDate, $lte: toDate } },
      { moveOutDate: { $gte: fromDate, $lte: toDate } },
    ],
  })
    .populate('userId', 'fullName dateOfBirth phone email')
    .populate({
      path: 'apartmentId',
      select: 'code floor buildingId',
      populate: { path: 'buildingId', select: 'code name' },
    })
    .lean();

  const events = [];

  for (const r of residents) {
    const u = r.userId || {};
    const apt = r.apartmentId || {};
    const maskedId = resolveMaskedId(r);

    if (r.moveInDate && r.moveInDate >= fromDate && r.moveInDate <= toDate) {
      events.push({
        _id: `${r._id}_IN`,
        residentId: r._id,
        fullName: u.fullName || '—',
        dateOfBirth: u.dateOfBirth || null,
        idNumber: maskedId,
        apartmentCode: apt.code || '—',
        buildingName: apt.buildingId?.name || '',
        relationType: r.relationType,
        relationLabel: RELATION_LABELS[r.relationType] || r.relationType,
        changeType: OCCUPANT_CHANGE_TYPES.MOVE_IN,
        changeLabel: CHANGE_LABELS.MOVE_IN,
        date: r.moveInDate,
      });
    }

    if (r.moveOutDate && r.moveOutDate >= fromDate && r.moveOutDate <= toDate) {
      events.push({
        _id: `${r._id}_OUT`,
        residentId: r._id,
        fullName: u.fullName || '—',
        dateOfBirth: u.dateOfBirth || null,
        idNumber: maskedId,
        apartmentCode: apt.code || '—',
        buildingName: apt.buildingId?.name || '',
        relationType: r.relationType,
        relationLabel: RELATION_LABELS[r.relationType] || r.relationType,
        changeType: OCCUPANT_CHANGE_TYPES.MOVE_OUT,
        changeLabel: CHANGE_LABELS.MOVE_OUT,
        date: r.moveOutDate,
      });
    }
  }

  events.sort((a, b) => new Date(b.date) - new Date(a.date));
  return events;
}

/**
 * UC21: Xuất file Excel biến động nhân khẩu và ghi AuditLog
 */
export async function exportResidentChangesExcel({ from, to }, actorUser, ip, { now = new Date() } = {}) {
  const rows = await listResidentChanges({ from, to });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'SAPMS';
  wb.created = now;

  const ws = wb.addWorksheet('Biến động nhân khẩu');

  ws.columns = [
    { header: 'STT', key: 'stt', width: 8 },
    { header: 'Họ tên', key: 'fullName', width: 26 },
    { header: 'Ngày sinh', key: 'dateOfBirth', width: 15 },
    { header: 'CCCD (che)', key: 'idNumber', width: 18 },
    { header: 'Căn hộ', key: 'apartmentCode', width: 14 },
    { header: 'Quan hệ', key: 'relationLabel', width: 22 },
    { header: 'Loại biến động', key: 'changeLabel', width: 16 },
    { header: 'Ngày', key: 'date', width: 15 },
  ];

  ws.getRow(1).font = { bold: true };

  rows.forEach((row, index) => {
    ws.addRow({
      stt: index + 1,
      fullName: row.fullName,
      dateOfBirth: row.dateOfBirth ? formatVnDate(row.dateOfBirth) : '',
      idNumber: row.idNumber || '',
      apartmentCode: row.apartmentCode,
      relationLabel: row.relationLabel,
      changeLabel: row.changeLabel,
      date: formatVnDate(row.date),
    });
  });

  const buffer = await wb.xlsx.writeBuffer();

  await logAudit({
    action: AUDIT_ACTIONS.RESIDENT_CHANGES_EXPORTED,
    user: actorUser,
    targetType: AUDIT_TARGETS.RESIDENT,
    targetId: null,
    metadata: {
      from: from || null,
      to: to || null,
      count: rows.length,
    },
    ip,
  });

  const filename = `bien-dong-nhan-khau-${toVnYmd(now)}.xlsx`;
  return { buffer, filename, count: rows.length };
}

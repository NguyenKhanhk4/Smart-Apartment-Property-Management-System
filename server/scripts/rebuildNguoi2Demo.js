// Mặc định lập kế hoạch chỉ đọc DB. --apply dọn đúng dữ liệu test Người 2 và tạo 5 bộ độc lập.
// Có backup EJSON trước ghi; không reset DB, không thay tài khoản nhân viên/cấu hình/dữ liệu T3.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { EJSON } from 'bson';
import bcrypt from 'bcryptjs';
import * as M from '../src/models/index.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { withTransaction } from '../src/utils/transaction.js';
import { CONSENT_POLICY_VERSION } from '../src/constants/enums.js';
import { confirmMoveIn, getApartmentById } from '../src/modules/apartments/apartments.service.js';
import { createContract, issueOwnerAccount } from '../src/modules/contracts/contracts.service.js';
import { startTenancy } from '../src/modules/residents/residentTenancies.js';
import { declareFamilyMember } from '../src/modules/residents/residents.service.js';
import * as vehicles from '../src/modules/vehicles/vehicles.service.js';
import * as cards from '../src/modules/parkingCards/parkingCards.service.js';
import { admitGuest, completeGuestExit, recordResidentPassage, quoteGuestExit } from '../src/modules/parkingGate/parkingGate.service.js';
import { calculateGuestFee } from '../src/modules/parkingGate/parkingFees.js';
import { checkApartmentDebt } from '../src/modules/debts/debts.check.js';
import { DAY_MS, HOUR_MS, periodStart, shiftPeriod, vnPeriod, toVnYmd, startOfVnDay } from '../src/utils/time.js';

const TAG = 'N2-20261115';
const PASSWORD = 'Sapms@123';
const APPLY = process.argv.includes('--apply');
const directory = new URL('../../../baocaotiendocode/DEMO_NGUOI2_2026-11-15/', import.meta.url);
const manifestUrl = new URL('manifest.json', directory);
const modeLabels = ['Tập thử tại nhà', 'Tập thử lần hai', 'Dự phòng', 'Trình bày chính', 'Dự phòng cuối'];
const markers = /\[(?:TEST|REVIEW|UC22)\]|\b(?:DEMO|REVIEW|SAMP)\b|kiểm thử/i;
const oldExtraCodes = new Set(['A105', 'A106', 'A108', 'A205', 'A206', 'A305', 'A306', 'A405', 'A406', 'B105', 'B106', 'B205', 'B206', 'B305', 'B306', 'A507']);
const singletonModels = new Set(['CronRun', 'RolePermission', 'SystemConfig', 'BuildingProfile', 'CollectionSetting', 'UtilityTariff', 'MaintenanceFund', 'FeeType', 'ComplaintCategory', 'Amenity', 'Asset']);
const actorOf = (u) => ({ id: String(u._id), role: u.role, roleTitle: u.roleTitle });
const str = (id) => id == null ? null : String(id);
const digest = (value) => createHash('sha256').update(EJSON.stringify(value)).digest('hex');
// Cron có thể chạm updatedAt của khoản thu đang chờ; đối chiếu giữ nguyên mọi trường nghiệp vụ.
const protectedDigest = ({ updatedAt: _updatedAt, ...value }) => digest(value);

function references(value, result = new Set()) {
  if (value == null) return result;
  if (value._bsontype === 'ObjectId') result.add(String(value));
  else if (typeof value === 'string' && /^[a-f\d]{24}$/i.test(value)) result.add(value);
  else if (Array.isArray(value)) for (const item of value) references(item, result);
  else if (typeof value === 'object' && !(value instanceof Date)) for (const [key, item] of Object.entries(value)) {
    if (key !== '_id') references(item, result);
  }
  return result;
}
const intersects = (a, b) => [...a].some((id) => b.has(id));
const textOf = (doc) => ['fullName', 'name', 'title', 'description', 'note', 'ownershipDocumentNumber', 'code', 'cardNumber', 'sourceReference', 'ip'].map((key) => doc[key] ?? '').join(' ');

async function loadFile(url) {
  try { return JSON.parse(await readFile(url, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function snapshot() {
  const state = {};
  for (const [name, Model] of Object.entries(M)) {
    if (name !== 'CronRun') state[name] = await Model.collection.find({}).toArray();
  }
  return state;
}

function planCleanup(state) {
  const targets = Object.fromEntries(Object.keys(state).map((name) => [name, new Map()]));
  const removed = new Set();
  const protectedBuildingIds = new Set(state.Building.filter((x) => x.code === 'T3').map((x) => str(x._id)));
  const protectedApartmentIds = new Set(state.Apartment.filter((x) => protectedBuildingIds.has(str(x.buildingId))).map((x) => str(x._id)));
  const protectedUserIds = new Set(state.User.filter((x) => x.role !== 'RESIDENT' || /@nguoi3\.test$/i.test(x.email ?? '')).map((x) => str(x._id)));
  for (const member of state.Resident) if (protectedApartmentIds.has(str(member.apartmentId)) && member.userId) protectedUserIds.add(str(member.userId));
  const scopeProtected = (doc) => protectedApartmentIds.has(str(doc.apartmentId)) || protectedBuildingIds.has(str(doc.buildingId));
  const mark = (name, doc, reason) => {
    assert.ok(name !== 'User' || !protectedUserIds.has(str(doc._id)), 'Không được xóa tài khoản nhân viên/T3');
    assert.ok(!scopeProtected(doc), `Không được xóa dữ liệu T3: ${name}`);
    if (!targets[name].has(str(doc._id))) {
      targets[name].set(str(doc._id), { doc, reason }); removed.add(str(doc._id)); return true;
    }
    return false;
  };
  for (const building of state.Building) if (['U13', 'RV13'].includes(building.code)) mark('Building', building, 'Tòa tạo riêng để test UC13');
  const testBuildingIds = new Set(targets.Building.keys());
  const abIds = new Set(state.Building.filter((x) => ['A', 'B'].includes(x.code)).map((x) => str(x._id)));
  for (const apartment of state.Apartment) if (testBuildingIds.has(str(apartment.buildingId))
    || (abIds.has(str(apartment.buildingId)) && oldExtraCodes.has(apartment.code)
      && new Date(apartment.createdAt) >= new Date('2026-11-08T00:00:00Z'))) mark('Apartment', apartment, 'Căn thêm riêng cho bộ demo cũ');
  for (const user of state.User) if (!protectedUserIds.has(str(user._id)) && (markers.test(user.fullName)
    || /@sapms\.test$/i.test(user.email ?? '') || /^090(?:90992\d\d|92222\d\d|93333\d\d)$/.test(user.phone)
    || user.email === 'test.owner@example.com')) mark('User', user, 'Tài khoản cư dân test có dấu hiệu xác định');
  // Người tạo mới chỉ để thao tác trong một tòa test, không có quyền/hồ sơ ở nơi khác.
  for (const user of state.User) {
    if (user.role !== 'RESIDENT' || protectedUserIds.has(str(user._id)) || targets.User.has(str(user._id))) continue;
    const residences = state.Resident.filter((x) => str(x.userId) === str(user._id));
    const contracts = state.Contract.filter((x) => [str(x.ownerId), str(x.tenantId)].includes(str(user._id)));
    if (residences.length && [...residences, ...contracts].every((x) => targets.Apartment.has(str(x.apartmentId)))
      && new Date(user.createdAt) >= new Date('2026-11-08T00:00:00Z')) mark('User', user, 'Tài khoản tạo mới chỉ có hồ sơ trong căn test');
  }
  const explicitModels = ['Contract', 'Resident', 'Vehicle', 'ParkingCard', 'ParkingSession', 'Invoice', 'GuestLog', 'Notification', 'AuditLog'];
  for (const name of explicitModels) for (const doc of state[name]) {
    if (!scopeProtected(doc) && markers.test(textOf(doc)) && !textOf(doc).includes(TAG)) mark(name, doc, 'Bản ghi có nhãn test/demo cũ');
  }
  for (const doc of state.ParkingSession) if (/^(?:RV-|KH-92\d\d$|KH-A507-|KH1$|KH-01$)/.test(doc.cardNumber)) {
    mark('ParkingSession', doc, 'Mã thẻ của các lượt quẹt demo đã xác định trong đợt trước');
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, docs] of Object.entries(state)) {
      if (['User', 'Building', 'Apartment'].includes(name) || singletonModels.has(name)) continue;
      for (const doc of docs) {
        if (targets[name].has(str(doc._id)) || scopeProtected(doc)) continue;
        const ownedRefs = name === 'Resident'
          ? references({ apartmentId: doc.apartmentId, userId: doc.userId, contractId: doc.contractId, declaredByResidenceId: doc.declaredByResidenceId })
          : references(doc);
        if (intersects(ownedRefs, removed)) changed = mark(name, doc, 'Phụ thuộc bản ghi test đã chọn') || changed;
      }
    }
  }
  // Không xóa một khoản thu dùng chung với hóa đơn phải giữ.
  for (const { doc } of targets.Payment.values()) {
    const invoiceIds = new Set([doc.invoiceId, ...(doc.allocations ?? []).map((x) => x.invoiceId)].filter(Boolean).map(str));
    const retained = [...invoiceIds].filter((id) => !targets.Invoice.has(id));
    assert.equal(retained.length, 0, `Khoản thu ${doc._id} chứa hóa đơn không phải test; cần đối chiếu riêng`);
  }
  // Các số dư/quỹ tổng hợp không được kéo vào cascade.
  for (const name of ['MaintenanceFund', 'SystemConfig', 'BuildingProfile', 'CollectionSetting', 'RolePermission']) {
    assert.equal(targets[name].size, 0);
  }
  for (const name of singletonModels) for (const doc of state[name] ?? []) {
    assert.ok(!intersects(references(doc), removed), `Dữ liệu dùng chung ${name} có tham chiếu test; cần đối chiếu trước khi xóa`);
  }
  const apartmentRepairs = state.Apartment.filter((x) => !targets.Apartment.has(str(x._id)) && !scopeProtected(x)
    && state.Resident.some((r) => str(r.apartmentId) === str(x._id) && targets.Resident.has(str(r._id))));
  const kept = (name) => state[name].filter((x) => !targets[name].has(str(x._id)));
  const freeApartments = kept('Apartment').filter((a) => abIds.has(str(a.buildingId))
    && !kept('Contract').some((x) => str(x.apartmentId) === str(a._id) && x.status === 'ACTIVE')
    && !kept('Resident').some((x) => str(x.apartmentId) === str(a._id) && x.isActive)
    && !kept('Invoice').some((x) => str(x.apartmentId) === str(a._id))
    && !kept('ParkingSession').some((x) => str(x.apartmentId) === str(a._id) && !x.exitedAt))
    .sort((a, b) => a.code.localeCompare(b.code));
  const report = {
    deletedBuildings: [...targets.Building.values()].map(({ doc }) => doc.code),
    deletedApartmentCodes: [...targets.Apartment.values()].map(({ doc }) => doc.code),
    deletedResidents: [...targets.User.values()].map(({ doc }) => ({ phone: doc.phone, name: doc.fullName })),
    deleteCounts: Object.fromEntries(Object.entries(targets).filter(([, docs]) => docs.size).map(([name, docs]) => [name, docs.size])),
    deleteIds: Object.fromEntries(Object.entries(targets).filter(([, docs]) => docs.size).map(([name, docs]) => [name, [...docs.keys()]])),
    repairApartmentCodes: apartmentRepairs.map((x) => x.code),
    freeApartmentCodes: freeApartments.map((x) => x.code),
    protected: { buildings: ['A', 'B', 'T3'], staffAccounts: state.User.filter((x) => x.role !== 'RESIDENT').length, t3Apartments: protectedApartmentIds.size },
  };
  return { targets, report, removed, apartmentRepairs, freeApartments, protectedUserIds };
}

async function applyCleanup(state, plan) {
  await writeFile(new URL('backup-before.ejson.gz', directory), gzipSync(EJSON.stringify({ date: new Date(), note: 'Không gồm cron_runs; collection này không bị thay đổi.', collections: state })));
  await withTransaction(async (session) => {
    for (const [name, docs] of Object.entries(plan.targets)) if (docs.size) {
      const ids = [...docs.values()].map(({ doc }) => doc._id);
      // Bảo trì có backup theo yêu cầu xóa dữ liệu test, không mở API xóa audit cho ứng dụng.
      const result = await M[name].collection.deleteMany({ _id: { $in: ids } }, { session });
      assert.equal(result.deletedCount, ids.length, `Số bản ghi ${name} vừa thay đổi; hủy dọn`);
    }
    for (const apartment of plan.apartmentRepairs) {
      const remains = await M.Resident.exists({ apartmentId: apartment._id, isActive: true }).session(session);
      const contract = await M.Contract.exists({ apartmentId: apartment._id, status: 'ACTIVE' }).session(session);
      if (!remains && !contract) await M.Apartment.updateOne({ _id: apartment._id }, {
        $set: { status: 'VACANT', occupancyStatus: apartment.handoverDate ? 'VACANT' : 'NOT_HANDED_OVER' },
      }, { session });
    }
    for (const resident of state.Resident) if (!plan.targets.Resident.has(str(resident._id)) && plan.removed.has(str(resident.parkingCardId))) {
      await M.Resident.updateOne({ _id: resident._id }, { $set: { parkingCardId: null } }, { session });
    }
  });
}

async function createData(manifest, save) {
  manifest.status = 'CREATING';
  await save();
  const [manager, receptionist, security, accountant] = await Promise.all([
    M.User.findOne({ role: 'MANAGER', isActive: true }).select('+passwordHash'),
    M.User.findOne({ role: 'STAFF', roleTitle: 'RECEPTIONIST', isActive: true }).select('+passwordHash'),
    M.User.findOne({ role: 'STAFF', roleTitle: 'SECURITY', isActive: true }).select('+passwordHash'),
    M.User.findOne({ role: 'ACCOUNTANT', isActive: true }).select('+passwordHash'),
  ]);
  assert.ok(manager && receptionist && security && accountant, 'Thiếu vai trò cần thiết');
  const ma = actorOf(manager); const ra = actorOf(receptionist); const sa = actorOf(security);
  const baseline = periodStart(shiftPeriod(vnPeriod(), -3));
  const baselineYmd = toVnYmd(baseline);
  const hash = await bcrypt.hash(PASSWORD, 10);
  manifest.staff = [];
  for (const user of [manager, receptionist, security, accountant]) manifest.staff.push({
    phone: user.phone, name: user.fullName, role: user.role, roleTitle: user.roleTitle,
    password: user.passwordHash && await bcrypt.compare(PASSWORD, user.passwordHash) ? PASSWORD : null,
  });
  const makeUser = async (phone, name, { pending = false, locked = false, birthday = '1988-06-15' } = {}) => {
    let user = await M.User.findOne({ phone });
    if (user) { assert.equal(user.fullName, name, `SĐT ${phone} thuộc người khác`); return user; }
    user = await M.User.create({ phone, fullName: name, role: 'RESIDENT', isActive: !locked,
      dateOfBirth: birthday, createdAt: baseline, ...(pending ? {} : { passwordHash: hash, activatedAt: baseline,
        consents: [{ action: 'ACCEPTED', policyVersion: CONSENT_POLICY_VERSION, createdAt: baseline }] }) });
    return user;
  };
  const prepUnit = async (unit, { handed = true, repair = false } = {}) => {
    // Chỉ các căn trống đã qua bước đối chiếu mới được chuẩn bị lại trạng thái mẫu; không sửa mã/tầng/diện tích.
    const update = { $set: { status: 'VACANT', occupancyStatus: repair ? 'UNDER_REPAIR' : handed ? 'VACANT' : 'NOT_HANDED_OVER' } };
    if (handed) update.$set.handoverDate = baseline;
    else update.$unset = { handoverDate: '' };
    if (!await M.Contract.exists({ apartmentId: unit.id, ownershipDocumentNumber: new RegExp(`^${TAG}`) })) {
      await M.Apartment.updateOne({ _id: unit.id }, update);
    }
  };
  const saleFor = async (unit, user, source, { grant = true, occupied = false, future = false } = {}) => {
    let contract = await M.Contract.findOne({ apartmentId: unit.id, ownershipDocumentNumber: source });
    if (!contract) ({ contract } = await createContract(ma, { apartmentId: unit.id, type: 'SALE',
      owner: { userId: str(user._id), phone: user.phone }, ownershipDocumentType: 'DEVELOPER_SALE_CONTRACT',
      ownershipDocumentNumber: source, startDate: future ? toVnYmd(new Date(startOfVnDay().getTime() + 30 * DAY_MS)) : baselineYmd,
    }, null, TAG));
    if (grant && !await M.Resident.exists({ apartmentId: unit.id, userId: user._id, relationType: 'OWNER', isActive: true })) {
      await issueOwnerAccount(unit.id, { contractId: str(contract._id), phone: user.phone }, ma, TAG);
    }
    if (occupied && (await M.Apartment.findById(unit.id).lean()).occupancyStatus !== 'OWNER_OCCUPIED') await confirmMoveIn(unit.id, ra, TAG);
    return contract;
  };
  const familyFor = async (unit, user, family) => {
    for (const [fullName, dateOfBirth] of family) if (!await M.Resident.exists({ apartmentId: unit.id, fullName, isActive: true })) {
      await declareFamilyMember(actorOf(user), { apartmentId: unit.id, fullName, dateOfBirth }, TAG);
    }
  };
  const cardFor = async (unit, user, number, handover) => {
    const resident = await M.Resident.findOne({ apartmentId: unit.id, userId: user._id, isActive: true });
    assert.ok(resident);
    let card = await M.ParkingCard.findOne({ cardNumber: number });
    if (!card) card = await cards.issueResidentCard({ residentId: str(resident._id), cardNumber: number }, ma, TAG);
    if (handover && !card.handedOverAt) await cards.handOverResidentCard(str(card._id), ra, TAG);
    return card;
  };
  for (const set of manifest.sets) {
    if (set.prepared) { console.log(`Bộ ${set.key} đã chuẩn bị; giữ nguyên, không tạo lại.`); continue; }
    console.log(`Đang chuẩn bị bộ ${set.number}: ${Object.values(set.units).map((x) => x.code).join(', ')}`);
    const users = {};
    for (const person of set.people) {
      users[person.key] = await makeUser(person.phone, person.name, { pending: person.key === '08' });
      person.id = str(users[person.key]._id);
      person.password = person.key === '08' ? null : PASSWORD;
    }
    for (const [kind, unit] of Object.entries(set.units)) await prepUnit(unit, { handed: !['account', 'catalog'].includes(kind) });
    await saleFor(set.units.family, users['01'], `${TAG}-${set.key}-FAMILY`, { occupied: true });
    await saleFor(set.units.tenancy, users['02'], `${TAG}-${set.key}-TENANCY`);
    await saleFor(set.units.rentedTransfer, users['04'], `${TAG}-${set.key}-RENTED`);
    await saleFor(set.units.vacantTransfer, users['07'], `${TAG}-${set.key}-VACANT`);
    await saleFor(set.units.account, users['08'], `${TAG}-${set.key}-ACCOUNT`, { grant: false });
    if (!await M.Resident.exists({ apartmentId: set.units.rentedTransfer.id, userId: users['05']._id, relationType: 'TENANT', isActive: true })) {
      await startTenancy(actorOf(users['04']), set.units.rentedTransfer.id, {
        userId: str(users['05']._id), phone: users['05'].phone, tenantPaysFees: false,
      }, TAG);
      await M.Resident.updateOne({ apartmentId: set.units.rentedTransfer.id, userId: users['05']._id, relationType: 'TENANT', isActive: true }, { $set: { moveInDate: new Date(baseline.getTime() + 30 * DAY_MS) } });
    }
    await familyFor(set.units.family, users['01'], set.familyMembers);
    await familyFor(set.units.rentedTransfer, users['05'], set.tenantMembers);
    const plannedVehicles = [
      ['family', '01', 'CAR', `30A-${set.number}10.01`, 'PENDING', 'Toyota', 'Trắng'],
      ['family', '01', 'MOTORBIKE', `29B1-${set.number}10.02`, 'PENDING', 'Honda', 'Đen'],
      ['family', '01', 'MOTORBIKE', `29B1-${set.number}10.03`, 'REJECTED', 'Yamaha', 'Đỏ'],
      ['family', '01', 'MOTORBIKE', `29B1-${set.number}10.04`, 'CANCELLED', 'Honda', 'Xanh'],
      ['family', '01', 'BICYCLE', null, 'PENDING', 'Thống Nhất', 'Xám'],
      ['rentedTransfer', '05', 'CAR', `30A-${set.number}20.01`, 'APPROVED', 'Kia', 'Xám'],
      ['rentedTransfer', '04', 'MOTORBIKE', `29B1-${set.number}20.02`, 'APPROVED', 'Honda', 'Trắng'],
      ['vacantTransfer', '07', 'MOTORBIKE', `29B1-${set.number}30.01`, 'APPROVED', 'Yamaha', 'Đen'],
    ];
    set.vehicles = [];
    for (const [kind, person, type, plate, status, brand, color] of plannedVehicles) {
      const unit = set.units[kind];
      const query = { apartmentId: unit.id, registeredBy: users[person]._id, type, plateNumber: plate ? vehicles.normalizePlate(plate, type) : null };
      let vehicle = await M.Vehicle.findOne(query);
      if (!vehicle) {
        vehicle = await vehicles.register({ apartmentId: unit.id, type, plateNumber: plate, brand, color }, actorOf(users[person]));
        if (status === 'APPROVED') await vehicles.approve(str(vehicle._id), ma, TAG);
        if (status === 'REJECTED') await vehicles.reject(str(vehicle._id), ma, { reason: 'Thông tin giấy đăng ký xe cần đối chiếu bổ sung' });
        if (status === 'CANCELLED') await vehicles.requestCancel(str(vehicle._id), actorOf(users[person]));
      }
      set.vehicles.push({ id: str(vehicle._id), kind, person, type, plate, status });
    }
    set.cards = [];
    for (const [kind, person, number, handover] of [
      ['tenancy', '02', `CD-${set.key}-CHO`, false],
      ['rentedTransfer', '05', `CD-${set.key}-THUE`, true],
      ['rentedTransfer', '04', `CD-${set.key}-CHU`, true],
      ['vacantTransfer', '07', `CD-${set.key}-CU`, true],
    ]) {
      const card = await cardFor(set.units[kind], users[person], number, handover);
      set.cards.push({ id: str(card._id), number, kind, person, handover });
    }
    const familyResidence = await M.Resident.findOne({ apartmentId: set.units.family.id, userId: users['01']._id, isActive: true });
    for (const [suffix, status] of [['THUHOI', 'DISABLED_TO_COLLECT'], ['DATHU', 'RETURNED'], ['MAT', 'LOST']]) {
      const number = `CD-${set.key}-${suffix}`;
      if (!await M.ParkingCard.exists({ cardNumber: number })) await M.ParkingCard.create({
        cardNumber: number, residentId: familyResidence._id, apartmentId: set.units.family.id,
        status, issuedAt: baseline, handedOverAt: baseline,
        ...(status === 'DISABLED_TO_COLLECT' ? {} : { closedAt: new Date(baseline.getTime() + 20 * DAY_MS), closedBy: receptionist._id }),
        note: `${TAG} · hồ sơ thẻ lịch sử để minh họa trạng thái, không phải thẻ hiện hành`,
      });
    }
    const invoiceCode = `${TAG}-${set.key}-CONGNO`;
    if (!await M.Invoice.exists({ code: invoiceCode })) await M.Invoice.create({
      code: invoiceCode, apartmentId: set.units.rentedTransfer.id, buildingId: set.units.rentedTransfer.buildingId,
      payerId: users['04']._id, payerRole: 'OWNER', period: shiftPeriod(vnPeriod(), -1),
      items: [{ feeCategory: 'MANAGEMENT', feeCode: 'REVIEW_TRANSFER', description: 'Khoản phí minh họa để kiểm tra ghi nhận công nợ khi đổi chủ', quantity: 1, unitPrice: 120000, amount: 120000 }],
      totalAmount: 120000, paidAmount: 0, status: 'OVERDUE', issuedAt: periodStart(shiftPeriod(vnPeriod(), -1)),
      dueDate: new Date(startOfVnDay().getTime() - DAY_MS), generatedBy: 'MANUAL',
    });
    set.debtCode = invoiceCode;
    await prepareParking(set, sa);
    set.prepared = true;
    await save();
  }
  manifest.background = [];
  for (let index = 0; index < manifest.backgroundUnits.length; index += 1) {
    const unit = manifest.backgroundUnits[index];
    const future = index === 1; const locked = index === 2;
    const user = await makeUser(`09095009${String(index + 1).padStart(2, '0')}`, ['Nguyễn Hải Đăng', 'Trần Bảo Ngọc', 'Phạm Minh Tâm'][index], { pending: future || locked, locked });
    await prepUnit(unit, { handed: true, repair: future });
    await saleFor(unit, user, `${TAG}-BACKGROUND-${index + 1}`, { grant: !future && !locked, occupied: !future && !locked, future });
    if (!future && !locked) {
      await familyFor(unit, user, [['Lê Thu Hà', '1991-09-18'], ['Nguyễn Hà Anh', '2016-03-04'], ['Nguyễn Gia Khang', '2020-12-10']]);
      await cardFor(unit, user, 'CD-NEN-01', true);
      for (const [type, plate] of [['CAR', '30A-901.01'], ['MOTORBIKE', '29B1-901.02']]) if (!await M.Vehicle.exists({ plateNumber: vehicles.normalizePlate(plate, type) })) {
        const v = await vehicles.register({ apartmentId: unit.id, type, plateNumber: plate, brand: type === 'CAR' ? 'Mazda' : 'Honda', color: 'Trắng' }, actorOf(user));
        await vehicles.approve(str(v._id), ma, TAG);
      }
    }
    manifest.background.push({ ...unit, phone: user.phone, name: user.fullName, purpose: future ? 'Hồ sơ hiệu lực tương lai, căn đang sửa chữa' : locked ? 'Người đứng tên bị khóa, không cấp quyền' : 'Gia đình đang ở, hai xe duyệt và thẻ hoạt động', password: future || locked ? null : PASSWORD });
    await save();
  }
  await validateData(manifest);
  await writeGuide(manifest);
  manifest.status = 'READY'; manifest.completedAt = new Date().toISOString();
  await save();
  console.log('READY', JSON.stringify({ sets: manifest.sets.map((x) => ({ number: x.number, units: Object.fromEntries(Object.entries(x.units).map(([key, value]) => [key, value.code])) })), summary: manifest.validation }, null, 2));
}

async function prepareParking(set, security) {
  const now = new Date(); const dayStart = startOfVnDay(now); const hour = (now - dayStart) / HOUR_MS;
  const band = new Date(dayStart.getTime() + (hour < 6 ? -6 : hour < 18 ? 6 : 18) * HOUR_MS);
  const recent = new Date(Math.max(band.getTime(), now.getTime() - 5 * 60000));
  const open = [
    [`KH-${set.key}-OTO`, 'CAR', `30A-${set.number}40.01`, recent],
    [`KH-${set.key}-XM`, 'MOTORBIKE', `29B1-${set.number}40.02`, recent],
    [`KH-${set.key}-XD`, 'BICYCLE', null, recent],
    [`KH-${set.key}-DAI`, 'CAR', `30A-${set.number}40.09`, new Date(now.getTime() - 3 * DAY_MS)],
  ];
  set.openGuests = [];
  for (const [cardNumber, vehicleType, plateNumber, enteredAt] of open) {
    if (!await M.ParkingSession.exists({ cardNumber })) await admitGuest({ cardNumber, vehicleType, plateNumber }, security, enteredAt);
    set.openGuests.push({ cardNumber, vehicleType, plateNumber, enteredAt });
  }
  const cases = [
    ['OTO-NGAY', 'CAR', 10, 17, 40000], ['OTO-DEM', 'CAR', 19, 23, 40000], ['OTO-18H', 'CAR', 10, 18, 80000],
    ['XM-NGAY', 'MOTORBIKE', 9, 17, 5000], ['XM-DEM', 'MOTORBIKE', 19, 23, 15000],
    ['XD-NGAY', 'BICYCLE', 9, 17, 3000], ['XD-DEM', 'BICYCLE', 19, 23, 8000],
  ];
  set.historyDays = [];
  for (let day = 1; day <= 2; day += 1) {
    const date = new Date(dayStart.getTime() - day * DAY_MS);
    set.historyDays.push(toVnYmd(date));
    for (let index = 0; index < cases.length; index += 1) {
      const [label, vehicleType, inHour, outHour, expectedFee] = cases[index];
      const cardNumber = `LS-${set.key}-${day}-${label}`;
      if (await M.ParkingSession.exists({ cardNumber })) continue;
      const plateNumber = vehicleType === 'BICYCLE' ? null : `30A-${set.number}${day}8.${String(index + 1).padStart(2, '0')}`;
      const input = { cardNumber, vehicleType, plateNumber };
      const enteredAt = new Date(date.getTime() + inHour * HOUR_MS);
      const exitedAt = new Date(date.getTime() + outHour * HOUR_MS);
      assert.equal(calculateGuestFee(vehicleType, enteredAt, exitedAt), expectedFee);
      const session = await admitGuest(input, security, enteredAt);
      await completeGuestExit(str(session._id), { ...input, expectedFee }, security, exitedAt);
    }
  }
  for (let day = 1; day <= 3; day += 1) for (const person of ['04', '05']) {
    const card = set.cards.find((x) => x.person === person);
    const vehicle = set.vehicles.find((x) => x.person === person);
    const enteredAt = new Date(dayStart.getTime() - day * DAY_MS + 8 * HOUR_MS);
    if (await M.ParkingSession.exists({ parkingCardId: card.id, enteredAt })) continue;
    await recordResidentPassage({ cardNumber: card.number, plateNumber: vehicle.plate, direction: 'IN' }, security, enteredAt);
    await recordResidentPassage({ cardNumber: card.number, plateNumber: vehicle.plate, direction: 'OUT' }, security, new Date(enteredAt.getTime() + 2 * HOUR_MS));
  }
}

async function validateData(manifest) {
  const usedApts = new Set(); const usedPhones = new Set();
  let people = 0; let vehicleCount = 0; let guestOpen = 0; let closed = 0;
  for (const set of manifest.sets) {
    for (const [kind, unit] of Object.entries(set.units)) {
      assert.ok(!usedApts.has(unit.id)); usedApts.add(unit.id);
      const apartment = await getApartmentById(unit.id);
      assert.equal(apartment.code, unit.code); assert.equal(apartment.floor, unit.floor); assert.equal(apartment.area, unit.area);
      const count = kind === 'family' ? 4 : kind === 'rentedTransfer' ? 3 : 0;
      assert.equal(apartment.activeResidentsCount, count, `${set.key}/${kind} số người`);
      unit.occupants = count; unit.occupancyStatus = apartment.occupancyStatus;
    }
    for (const person of set.people) {
      assert.ok(!usedPhones.has(person.phone)); usedPhones.add(person.phone);
      const user = await M.User.findOne({ phone: person.phone }).select('+passwordHash');
      if (person.key === '08') { assert.ok(!user.activatedAt); assert.ok(!user.passwordHash); }
      else assert.ok(await bcrypt.compare(PASSWORD, user.passwordHash));
      people += 1;
    }
    assert.equal((await checkApartmentDebt(set.units.rentedTransfer.id)).amount, 120000);
    assert.equal((await checkApartmentDebt(set.units.vacantTransfer.id)).amount, 0);
    for (const vehicle of set.vehicles) assert.equal((await M.Vehicle.findById(vehicle.id)).status, vehicle.status);
    vehicleCount += set.vehicles.length;
    for (const card of set.cards) {
      const doc = await M.ParkingCard.findById(card.id);
      assert.equal(doc.status, 'ACTIVE'); assert.equal(Boolean(doc.handedOverAt), card.handover);
    }
    assert.equal(await M.ParkingCard.countDocuments({ cardNumber: set.reserved.residentCard }), 0);
    assert.equal(await M.Contract.countDocuments({ apartmentId: set.units.catalog.id }), 0);
    for (const guest of set.openGuests) {
      const session = await M.ParkingSession.findOne({ cardNumber: guest.cardNumber, exitedAt: null });
      assert.ok(session); guestOpen += 1;
      if (guest.cardNumber.endsWith('-DAI')) {
        await assert.rejects(() => quoteGuestExit({ cardNumber: guest.cardNumber, plateNumber: guest.plateNumber }), (error) => error.errorCode === 'PARKING_TARIFF_UNDEFINED');
      }
    }
    const history = await M.ParkingSession.find({ $or: [{ cardNumber: new RegExp(`^LS-${set.key}-`) }, { parkingCardId: { $in: set.cards.map((x) => x.id) } }], exitedAt: { $ne: null } }).lean();
    assert.equal(history.length, 20); closed += history.length;
    for (const item of history.filter((x) => x.kind === 'GUEST')) assert.equal(item.feeAmount, calculateGuestFee(item.vehicleType, item.enteredAt, item.exitedAt));
  }
  for (const original of manifest.protectedStaff) {
    const user = await M.User.collection.findOne({ phone: original.phone });
    assert.ok(user);
    assert.equal(digest(user.passwordHash), original.passwordDigest, 'Không thay mật khẩu nhân viên');
    assert.equal(user.isActive, original.isActive);
    assert.equal(user.role, original.role);
    assert.equal(user.fullName, original.fullName);
  }
  for (const [name, list] of Object.entries(manifest.protectedDocuments)) for (const item of list) {
    const doc = await M[name].collection.findOne({ _id: new M.User.base.Types.ObjectId(item.id) });
    assert.ok(doc, `Mất dữ liệu được giữ: ${name}/${item.id}`);
    assert.equal(protectedDigest(doc), item.digest, `Dữ liệu được giữ bị thay đổi: ${name}/${item.id}`);
  }
  assert.equal(await M.Building.countDocuments(), 3);
  assert.equal(await M.Apartment.countDocuments(), 45);
  const newRefs = await checkDanglingReferences();
  const oldErrors = new Set(manifest.danglingBefore);
  const introduced = newRefs.filter((x) => !oldErrors.has(x));
  assert.equal(introduced.length, 0, `Có liên kết mồ côi mới: ${introduced.slice(0, 8)}`);
  manifest.validation = { checkedAt: new Date().toISOString(), sets: 5, distinctApartments: usedApts.size, sampleAccounts: people,
    sampleVehicles: vehicleCount, sampleGuestOpen: guestOpen, sampleClosedHistory: closed, buildings: 3, apartments: 45,
    preservedStaff: manifest.protectedStaff.length, introducedDanglingReferences: introduced.length,
    totalCurrentResidents: await M.Resident.countDocuments({ isActive: true }), totalVehicles: await M.Vehicle.countDocuments(), totalCards: await M.ParkingCard.countDocuments(),
  };
}

async function checkDanglingReferences() {
  const existing = {};
  for (const [name, Model] of Object.entries(M)) existing[name] = new Set((await Model.find().select('_id').lean()).map((x) => str(x._id)));
  const issues = [];
  for (const [name, Model] of Object.entries(M)) {
    if (name === 'CronRun') continue;
    const paths = [];
    Model.schema.eachPath((path, type) => { if (type.options?.ref && existing[type.options.ref]) paths.push([path, type.options.ref]); });
    if (!paths.length) continue;
    const rows = await Model.collection.find({}).toArray();
    for (const row of rows) for (const [path, target] of paths) {
      const value = path.split('.').reduce((obj, key) => obj?.[key], row);
      for (const id of (Array.isArray(value) ? value : [value]).filter(Boolean)) if (!existing[target].has(str(id))) issues.push(`${name}/${row._id}/${path}/${id}`);
    }
  }
  return issues.sort();
}

async function writeGuide(manifest) {
  await writeFile(new URL('HUONG_DAN_DEMO_5_BO_NGUOI2.txt', directory), makeGuide(manifest), 'utf8');
}

function makeGuide(manifest) {
  const unitNames = { family: 'Gia đình, xe, thẻ', tenancy: 'Bắt đầu/kết thúc thuê', rentedTransfer: 'Đổi chủ đang cho thuê và có nợ', vacantTransfer: 'Đổi chủ căn trống', account: 'Cấp quyền/kích hoạt', catalog: 'Bàn giao, ghi hồ sơ từ đầu' };
  const header = `HƯỚNG DẪN DEMO 5 BỘ ĐỘC LẬP — TOÀN BỘ 9 UC NGƯỜI 2 TRONG SAPMS
Ngày chuẩn bị: ${toVnYmd(new Date())}

1. BẮT ĐẦU
- Chạy backend và frontend của project chính nếu chưa chạy.
- Nội bộ (BQL, lễ tân, bảo vệ, kế toán): http://localhost:5173/staff/login
- Cư dân: http://localhost:5173/login
- Mỗi lần đổi vai trò: Đăng xuất tài khoản trước rồi mở đúng cổng.
- Mật khẩu cư dân mới đã kích hoạt: ${PASSWORD}. Số kết thúc 08 chờ kích hoạt, chưa có mật khẩu. Các số 10/11 dự phòng chưa được tạo trước.
- Nhân viên giữ nguyên tài khoản và mật khẩu cũ; script không đặt lại mật khẩu.
- Tên và các khoản tiền trong bộ mới là dữ liệu giả lập phục vụ trình diễn, được lưu thật vào DB phát triển; không phải thông tin người thật hoặc khoản thu thực.

Tài khoản nội bộ:
${manifest.staff.map((x) => `- ${x.name}: ${x.phone}; mật khẩu ${x.password ?? 'hiện tại của bạn (script không đổi)'}`).join('\n')}

2. CHỌN BỘ
${manifest.sets.map((x) => `- Bộ ${x.key}: ${x.purpose}; các căn ${Object.values(x.units).map((u) => u.code).join(', ')}.`).join('\n')}

Khuyên dùng bộ 01/02 để tập; giữ bộ 04 cho buổi trình bày, bộ 03/05 dự phòng. Không thao tác lẫn tài khoản/mã thẻ giữa các bộ. Một bộ đã đổi chủ/kích hoạt/kết thúc thuê thì trạng thái đó được lưu, không tự trở về ban đầu.

3. DỌN DỮ LIỆU VÀ PHẠM VI GIỮ
- Đã xác định và dọn các bộ test cũ của Người 2: tài khoản gắn nhãn hoặc nguồn demo, hồ sơ/xe/thẻ/phiên gửi/phí/thu tiền liên quan; các tòa U13, RV13 và các căn thêm riêng cho demo cũ.
- Giữ danh mục gốc tòa A/B, 40 căn; giữ tòa T3 và 5 căn cùng dữ liệu riêng của Người 3; giữ dữ liệu còn lại và 10 tài khoản nội bộ.
- Một số dữ liệu cũ không thuộc nhóm đã xác định vẫn được giữ theo yêu cầu. Khi review, tìm đúng mã căn/biển/thẻ trong bộ, không cho rằng mọi bản ghi trong DB đều được tạo mới ở đợt này.
- Có backup trước khi thay đổi, kế hoạch dọn và manifest kỹ thuật trong cùng thư mục hướng dẫn. Không commit/push những file backup này.
- Script server/scripts/rebuildNguoi2Demo.js chạy lại khi đã READY sẽ giữ nguyên dữ liệu, không reset cả 5 bộ. Không xóa manifest để cố chạy lại.

4. THỨ TỰ DEMO TRONG MỖI BỘ
UC13 → UC22 → UC66 cấp/bàn giao → UC16 → UC54 → UC66 cấp lại/thu hồi → UC15 → UC17 → UC20 → UC21.

Các phần dưới ghi riêng từng bộ, có thể mở đúng phần và làm từ đầu đến cuối.
`;
  const sections = manifest.sets.map((set) => {
    const u = set.units; const key = set.key; const n = set.number; const r = set.reserved;
    const p = Object.fromEntries(set.people.map((person) => [person.key, person]));
    return `
======================================================================
BỘ ${key} — ${set.purpose.toUpperCase()}
======================================================================

A. DỮ LIỆU VÀ TÀI KHOẢN CỦA BỘ ${key}
${Object.entries(u).map(([kind, unit]) => `- ${unit.code}: ${unitNames[kind]}, tầng ${unit.floor}, ${unit.area} m²; ban đầu ${unit.occupants ?? 0} người đang ở.`).join('\n')}

${set.people.map((person) => `- ${person.phone}: ${person.name} — ${person.purpose}; ${person.key === '08' ? 'chưa có mật khẩu, chờ cấp quyền/kích hoạt' : `đã kích hoạt, mật khẩu ${PASSWORD}`}.`).join('\n')}
- ${r.newOwnerPhone}: số dự phòng cho chủ mới ghi nhận tại ${u.catalog.code}, chưa có tài khoản ban đầu.
- ${r.newTenantPhone}: số dự phòng cho khách thuê mới, chưa có tài khoản ban đầu.
- Thẻ gia đình tự cấp khi demo: ${r.residentCard}; thẻ cấp lại: ${r.replacementCard}.
- Thẻ khách mới tự phát khi demo: ${r.guestCard}; biển ${r.guestPlate}.

B. UC13 — TÒA NHÀ VÀ CĂN HỘ

B1. Xem căn có sẵn và ghi bàn giao
1. Đăng nhập BQL ${manifest.staff.find((x) => x.role === 'MANAGER').phone} tại cổng nội bộ.
2. Tòa nhà & Căn hộ → Danh sách căn hộ → lọc tòa/tầng hoặc tìm mã ${u.catalog.code}.
3. Bấm Chi tiết → Sửa thông tin. Danh sách không có nút Sửa riêng.
4. Nhập ngày bàn giao thực tế là ngày review, không chọn tương lai. Lưu, mở lại để đối chiếu.
5. Căn vẫn 0 người; bàn giao không tự cấp quyền hoặc xác nhận đang ở.

B2. Thiết lập mới đầy đủ theo hồ sơ minh họa
1. Danh sách tòa nhà → Thiết lập tòa nhà; mã ${r.towerCode}, tên Tòa minh họa ${key}.
2. Địa chỉ Khu Công Nghệ Cao Hòa Lạc, CT03, Hòa Lạc, Hà Nội, Việt Nam; Tổng số tầng 3; tài liệu DS-CAN-${key} — hồ sơ minh họa.
3. Tiếp tục; tầng 1 số căn 2: ${r.towerCode}101 diện tích 60, ${r.towerCode}102 diện tích 75,5 m².
4. Thêm tầng có căn hộ, chọn tầng 3, số căn 1: ${r.towerCode}301 diện tích 85 m². Không khai nhóm tầng 2.
5. Xem trước: 3 tầng toàn tòa, 2 tầng có căn hộ, 3 căn; tick đối chiếu → Xác nhận danh mục.
6. Đây là tòa bạn tự tạo khi demo, chưa được seed sẵn. Nếu mã đã tồn tại do đã chạy bộ này, không tạo lại mã trùng.
7. Thử thiếu tài liệu/trùng căn/sai số dòng/diện tích 0: bị chặn. Hủy trước xác nhận: không lưu dở.
8. Nếu nút thêm tầng bị khóa sau tầng 1, quay lại kiểm tra Tổng số tầng; mặc định là 1, phải đổi thành 3.

B3. Điều chỉnh và xóa có điều kiện
1. Dùng căn ${r.towerCode}101 mới tạo → Điều chỉnh; đổi 60 thành 61,5 m², giữ mã/tầng, nhập lý do và tài liệu, áp dụng từ tháng sau.
2. Kiểm tra lịch sử và lịch diện tích; không đổi các thông báo phí đã lập.
3. Chỉ thử xóa ${r.towerCode}301 chưa liên kết; nhập lý do/tài liệu. Căn ${u.family.code} đã có hồ sơ phải bị chặn xóa và khóa đổi mã.

C. UC22 — CẤP QUYỀN CHỦ SỞ HỮU, KÍCH HOẠT

C1. Hồ sơ đã có, cấp quyền
1. BQL → Hồ sơ sở hữu căn hộ → tìm ${u.account.code}; kiểm tra người đứng tên ${p['08'].name}, điện thoại ${p['08'].phone}.
2. Tòa nhà & Căn hộ → bấm mã ${u.account.code} để mở trang đầy đủ → Cấp tài khoản chủ sở hữu.
3. Điện thoại ${p['08'].phone}; để trống email; tick đã đối chiếu giấy tờ → Cấp tài khoản.
4. Thử số khác hoặc chưa tick đối chiếu: bị chặn. Cấp xong hiện Chờ kích hoạt, căn vẫn 0 người.

C2. Quầy lễ tân và tự kích hoạt
1. Đăng xuất BQL. Đăng nhập lễ tân ${manifest.staff.find((x) => x.roleTitle === 'RECEPTIONIST').phone}.
2. Cấp mã kích hoạt → nhập ${p['08'].phone} → Tra cứu → đối chiếu tên/căn → tick CCCD → Cấp mã.
3. Copy mã XXXX-XXXX ngay. Mã quầy 8 ký tự chữ/số, hạn 48 giờ; không phải OTP email 6 số. Cấp lại làm mã cũ mất hiệu lực.
4. Đăng xuất lễ tân; mở http://localhost:5173/activate → Tôi đã có mã in tại quầy.
5. Nhập ${p['08'].phone}, mã vừa cấp, mật khẩu và xác nhận ${PASSWORD} → Tiếp tục → Đồng ý và kích hoạt.
6. Đăng nhập cư dân ${p['08'].phone}/${PASSWORD} → Căn hộ của tôi thấy ${u.account.code}; chưa xác nhận vào ở thì vẫn 0 người.

C3. Ghi nhận hồ sơ từ đầu tại căn còn trống
1. BQL → Hồ sơ sở hữu căn hộ → Ghi nhận chủ sở hữu → căn ${u.catalog.code}.
2. Nhập số ${r.newOwnerPhone}, tên ${r.newOwnerName}, không email, ngày hiệu lực hôm nay; chọn Hợp đồng mua bán với chủ đầu tư; tham chiếu HS-${key}-MOI.
3. Lưu → trang chi tiết căn → Cấp tài khoản chủ sở hữu → đúng số, tick đối chiếu → cấp.
4. Lễ tân cấp mã cho ${r.newOwnerPhone}; chủ tự kích hoạt và đặt mật khẩu theo C2.
5. Nếu muốn test một tài khoản nhiều căn, dùng một căn mới ở tòa ${r.towerCode} vừa tạo, ghi hồ sơ cho ${p['01'].phone}, tick Đúng người này, cấp thêm quyền; người này dùng mật khẩu cũ và chọn được nhiều căn.
6. Xác nhận vào ở là bước riêng: phải có ngày bàn giao và quyền chủ; lễ tân mở trang chi tiết đầy đủ → Xác nhận vào ở khi đúng tình huống. Làm bước này thì số người tăng, không còn mốc ban đầu.

D. UC66 — CẤP VÀ BÀN GIAO THẺ TRƯỚC DUYỆT XE
1. BQL → Thẻ cư dân → Cấp thẻ cư dân → căn ${u.family.code}, người ${p['01'].name}, mã ${r.residentCard}.
2. Thẻ chờ bàn giao; chưa quẹt cổng được.
3. Lễ tân → Thẻ cư dân → tìm ${r.residentCard} → Bàn giao thẻ → xác nhận đã bàn giao.
4. Ban đầu quyền Thang máy, 0 xe được duyệt của chính người này. Xe lịch sử cũ không có người đăng ký, nếu còn trong danh sách căn, không tự mang quyền sang tài khoản mới.
5. Thẻ ${'CD-' + key + '-CHO'} của chủ căn ${u.tenancy.code} đã có sẵn trạng thái chờ bàn giao để đối chiếu, không giao nhầm thành thẻ của khách thuê.

E. UC16 — ĐĂNG KÝ, DUYỆT, TỪ CHỐI, HỦY XE
1. Đăng nhập cư dân ${p['01'].phone}/${PASSWORD}, chọn ${u.family.code} → Xe của tôi → Đăng ký xe máy ${r.manualPlate}, Honda, màu Đen; thử nhập dạng không dấu gạch/chấm cũng nhận cùng định danh.
2. Xe chờ duyệt; chọn Rút yêu cầu và xác nhận để thành Đã hủy.
3. Đăng nhập BQL → Yêu cầu gửi xe → Chờ duyệt; tìm ô tô 30A-${n}10.01, người ${p['01'].name}, căn ${u.family.code} → Duyệt → Xác nhận duyệt.
4. Mở Thẻ cư dân: cùng mã ${r.residentCard} có quyền gửi 1 ô tô. Không cấp thẻ xe riêng.
5. Từ chối xe máy 29B1-${n}10.02 với lý do; để trống lý do trước để thử chặn. Cư dân xem được lý do.
6. Xe 29B1-${n}10.03 đã từ chối và .04 đã hủy có sẵn; xe đạp không biển đang chờ duyệt là nhánh tùy chọn. Duyệt thêm xe đạp thì số xe trên thẻ tăng tương ứng.
7. Thử đăng ký lại 30A${n}1001 khi xe .01 đang tồn tại: bị chặn trùng; biển abc hoặc thiếu biển ô tô/xe máy: bị chặn.
8. Test hủy xe đã duyệt bằng một xe khác: đăng ký 29B1-${n}10.06, BQL duyệt, cư dân Yêu cầu hủy vé; lễ tân vào Yêu cầu hủy → Xác nhận hủy. Không hủy ô tô .01 trước bài cổng.
9. Nếu xe còn trong bãi, phải ghi nhận Xe ra trước khi xác nhận hủy vé.

F. UC54 — CƯ DÂN VÀ KHÁCH RA VÀO
1. Bảo vệ ${manifest.staff.find((x) => x.roleTitle === 'SECURITY').phone} → Quản lí bãi xe → Xe cư dân.
2. Xe vào; mã ${r.residentCard}, biển 30A-${n}10.01 → Kiểm tra và ghi nhận: thành công.
3. Ghi Xe vào lần nữa: bị chặn đã trong bãi. Đổi Xe ra, ghi nhận để đóng lượt; ra lần hai: bị chặn.
4. Thẻ ${r.residentCard} + biển 30A-${n}20.01 của khách thuê ở căn khác: bị chặn không khớp.
5. Xe khách → Xe vào → mã ${r.guestCard}, biển ${r.guestPlate} → Phát thẻ tạm → Ô tô → Xác nhận phát thẻ.
6. Xe ra → cùng mã/biển → Kiểm tra và tính phí. Cùng một khung ngày hoặc đêm, ô tô là 40.000đ. Xác nhận đã thu tiền và nhận lại thẻ để đóng lượt.
7. Thử sai biển, phát trùng thẻ đang gửi, thu lại lượt đã đóng: phải chặn.
8. Đã có thẻ KH-${key}-OTO, KH-${key}-XM, KH-${key}-XD đang gửi; xe đạp để trống biển. Giá phụ thuộc giờ thật, không cố dùng lượt cũ qua nhiều ngày để demo một lượt thu trong khung.
9. KH-${key}-DAI, biển 30A-${n}40.09: lượt nhiều ngày để thử thông báo chưa có biểu phí, không được tự thu rồi đóng.
10. Lịch sử → lọc ${set.historyDays.join(' hoặc ')}. Mã LS-${key}-1/2-... có 14 lượt khách; ô tô ngày 40.000, đêm 40.000, 10h→18h 80.000; xe máy ngày 5.000/đêm 15.000; xe đạp ngày 3.000/đêm 8.000. Còn 6 lượt cư dân đã đóng để xem lịch sử.
11. BQL xem tra cứu/lịch sử nhưng không thao tác phát thẻ và ghi lượt như bảo vệ. Không có Gate Pass.

G. UC66 — CẤP LẠI, THU HỒI, MẤT THẺ
1. Khi ô tô .01 đã ra: BQL tìm ${r.residentCard} → Cấp lại thẻ → mã ${r.replacementCard}.
2. Mã cũ thành Cần thu hồi, mã mới chờ bàn giao. Lễ tân bàn giao mã mới, xác nhận Đã thu hồi mã cũ khi nhận lại.
3. Bảo vệ thử mã cũ với .01: bị chặn; mã mới với .01: vào được, rồi ghi ra.
4. Lễ tân tìm CD-${key}-THUHOI, ghi Mất thẻ để demo trạng thái mất. CD-${key}-DATHU và CD-${key}-MAT là lịch sử đã có.

H. UC15 — THÀNH VIÊN GIA ĐÌNH
1. Cư dân ${p['01'].phone}/${PASSWORD} → Căn hộ của tôi → ${u.family.code}; ban đầu 4 người, gồm chủ và 3 thành viên.
2. Khai báo thành viên ở cùng → ${r.manualMember}, ngày sinh 15/09/2015 → Lưu.
3. Danh sách thành 5 người ngay, không chờ BQL duyệt. Tải lại vẫn thấy người mới.
4. BQL → Thông tin cư trú → tòa/tầng chứa ${u.family.code} → mở rộng dòng: thấy đúng 5 người.
5. Tên trống/ngày sinh tương lai bị chặn; Hủy form không tăng người. Không thêm lại cùng người khi chạy lại bài.

I. UC17 — KHÁCH THUÊ
1. Chủ ${p['02'].phone}/${PASSWORD} → Căn hộ của tôi → ${u.tenancy.code} → Quản lý cho thuê → Bắt đầu cho thuê.
2. Số khách ${p['03'].phone}, chọn đúng ${p['03'].name}, tick Đúng người này; người nộp phí Khách thuê → Lưu.
3. Khách ${p['03'].phone}/${PASSWORD} đăng nhập, thấy ${u.tenancy.code}; 1 người đang ở. Chủ không được cộng là đang ở.
4. Khách khai báo ${r.tenantManualMember}, sinh 20/08/1999 → danh sách 2 người.
5. BQL kiểm tra UC21: căn Đang cho thuê, 2 người.
6. Chủ ${p['02'].phone} → Kết thúc cho thuê → xác nhận đã rời: căn về trống, 0 người, khách và người khai báo không còn quyền đang ở.
7. Nếu đã cấp thẻ/xe riêng cho khách, kiểm tra thu hồi quyền. Tài khoản khách không bị xóa toàn hệ thống; khoản nợ đã phát sinh vẫn gắn người nộp phí ban đầu.
8. Tùy chọn sau khi kết thúc: bắt đầu lượt mới bằng ${r.newTenantPhone}, tên ${r.newTenantName}, không email → khách mới chờ kích hoạt; lễ tân cấp mã, khách tự kích hoạt. Chủ kết thúc lượt sau khi test xong nếu muốn căn trở lại trống.
9. Không tạo hợp đồng thuê điện tử, không tự động gia hạn hợp đồng giấy; không bắt đầu hai lượt thuê hoạt động cùng căn.

J. UC20 — ĐỔI CHỦ

J1. Căn trống không nợ
1. BQL mở trang đầy đủ ${u.vacantTransfer.code} → Cập nhật chủ sở hữu.
2. Chủ cũ ${p['07'].name}; chủ mới ${p['09'].phone} — ${p['09'].name}; tick đúng người.
3. Giấy tờ xác nhận chuyển nhượng, tham chiếu CN-${key}-TRONG; tick đối chiếu/bàn giao có hiệu lực → Xác nhận đổi chủ.
4. Chủ mới đăng nhập ${p['09'].phone}/${PASSWORD}, có căn; chủ cũ không còn quyền tại căn. Căn vẫn 0 người, không tự xác nhận vào ở.
5. Thẻ CD-${key}-CU bị vô hiệu/chờ thu hồi; xe chủ cũ 29B1-${n}30.01 bị thu hồi quyền theo căn.

J2. Căn đang cho thuê và có nợ
1. BQL mở ${u.rentedTransfer.code}; chủ cũ ${p['04'].name}, khách ${p['05'].name}, đang có 3 người (khách và 2 thành viên).
2. Cập nhật chủ sở hữu: cảnh báo nợ 120.000đ → Yêu cầu kế toán.
3. Đăng nhập kế toán ${manifest.staff.find((x) => x.role === 'ACCOUNTANT').phone}; Sổ công nợ → căn ${u.rentedTransfer.code}. Có thể mở http://localhost:5173/app/debts/apartments/${u.rentedTransfer.id} sau đăng nhập.
4. Kiểm tra hóa đơn ${set.debtCode}, 120.000đ của ${p['04'].name} → Đã ghi nhận công nợ. Đây không phải trả tiền, nợ không về 0.
5. BQL mở lại/làm mới đổi chủ; số mới ${p['06'].phone}, đúng ${p['06'].name}; tham chiếu CN-${key}-DANGTHUE; tick đối chiếu → xác nhận.
6. Chủ mới ${p['06'].phone}/${PASSWORD} thấy lượt thuê đang có; khách ${p['05'].phone}/${PASSWORD} vẫn ở căn, vẫn có 2 thành viên; tổng vẫn 3 người.
7. Thẻ khách CD-${key}-THUE và ô tô 30A-${n}20.01 vẫn hiệu lực; thẻ chủ cũ CD-${key}-CHU và xe 29B1-${n}20.02 bị thu hồi quyền.
8. Bảo vệ thử thẻ/xe khách vào rồi ra: được; thẻ/xe chủ cũ: bị chặn. Không để xe của người bị thu hồi đang trong bãi trước đổi chủ.
9. Kế toán kiểm tra nợ vẫn 120.000đ của chủ cũ, không tự chuyển thành nợ chủ mới. Nhánh chờ kế toán 2 ngày có trong code/test tự động; bài này sử dụng ghi nhận ngay, không đổi giờ máy.

K. UC21 — THÔNG TIN CƯ TRÚ VÀ EXCEL
1. BQL → Thông tin cư trú → chọn tòa/tầng, mở căn ${u.family.code}: 4 người ban đầu, 5 sau bước H.
2. ${u.rentedTransfer.code}: 3 người cả trước/sau đổi chủ, không cộng chủ sở hữu.
3. ${u.tenancy.code}: 0 ban đầu → 1 khi bắt đầu thuê → 2 sau khai báo → 0 sau kết thúc.
4. ${u.vacantTransfer.code}: 0 cả sau đổi chủ. ${u.account.code}/${u.catalog.code}: 0 nếu mới cấp quyền/kích hoạt, chưa xác nhận vào ở.
5. Chọn tòa/tầng → Xem trước (hình mắt) → kiểm tra dữ liệu → Xuất Excel tòa đang chọn → mở file Downloads đối chiếu.
6. Tất cả tòa nhà + Tất cả tầng → Xem trước → Xuất Excel toàn bộ tòa; mỗi tòa có sheet riêng. Có cả T3 được giữ và tòa ${r.towerCode} nếu bạn đã tạo.
7. Lễ tân/bảo vệ không có quyền màn UC21 của BQL; URL trực tiếp cũng phải chặn.
8. Đây là danh sách phục vụ phối hợp rà soát cư trú; người dân tự làm đăng ký tạm trú/thường trú với công an/VNeID.

L. KHI MUỐN TẬP LẠI
- Không cố lặp thao tác đổi chủ/kích hoạt với cùng dữ liệu đã tiêu thụ. Chuyển sang bộ khác còn nguyên.
- Một số nhánh hủy/thêm thành viên có thể lặp bằng thông tin mới, nhưng tổng số người/xe sẽ khác mốc ban đầu; tự đối chiếu bước đã làm.
- Không chạy seed tổng hoặc xóa DB để đưa một bộ về ban đầu.
`;
  }).join('\n');
  const footer = `
======================================================================
DỮ LIỆU NỀN VÀ NHÁNH BỔ SUNG
======================================================================
${manifest.background.map((x) => `- Căn ${x.code}: ${x.name}, ${x.phone}; ${x.purpose}; ${x.password ? `mật khẩu ${x.password}` : 'chưa có mật khẩu'}.`).join('\n')}

- Căn hồ sơ tương lai: thử cấp quyền trước ngày hiệu lực, backend phải chặn. Giao diện hiện có thể vẫn hiện nút cấp, chưa đồng bộ hoàn toàn điều kiện ngày.
- Căn người đứng tên bị khóa: không được cấp quyền/mã để bỏ qua khóa.
- Các lượt xe khách đã mở sẽ tiếp tục chạy thời gian thật; sau nhiều ngày có thể rơi vào khoảng chưa có biểu phí. Dùng mã KH-xx-MOI để demo lượt mới, dùng lịch sử cố định để giải thích các mức ngày/đêm.
- Phí ngoài quy tắc đã chốt bị chặn, không khẳng định đã tính đủ mọi lượt qua đêm/nhiều ngày.
- Cần tiếp tục hoàn thiện thu hồi quyền khi kết thúc thuê/đổi chủ mà xe vẫn đang trong bãi. Đóng lượt xe trước trong bài chính; không coi tình huống này đã giải quyết đầy đủ.
- Không kiểm tra email nhận thực tế trong bộ này; không tự gửi thư đến các email cũ. Luồng tại quầy có thể demo không cần email.
- Camera, thang máy và thanh chắn là mô phỏng trên web.
- Bộ mới được kiểm tra dữ liệu/quan hệ/quyền đọc mà không kích hoạt, đổi chủ hoặc kết thúc thuê thay người demo. Các kết quả test tự động và phần kiểm tra thực tế phải phân biệt với việc đã bấm toàn bộ màn hình.

Trạng thái lúc chuẩn bị:
- 5 bộ độc lập trên ${manifest.validation.distinctApartments} căn; ${manifest.validation.sampleAccounts} tài khoản cư dân riêng cho 5 bộ.
- ${manifest.validation.sampleVehicles} xe riêng của 5 bộ; ${manifest.validation.sampleGuestOpen} lượt xe khách đang gửi; ${manifest.validation.sampleClosedHistory} lượt lịch sử đã đóng.
- Toàn DB sau chuẩn bị: ${manifest.validation.buildings} tòa, ${manifest.validation.apartments} căn, ${manifest.validation.totalCurrentResidents} hồ sơ cư dân đang hoạt động, ${manifest.validation.totalVehicles} xe và ${manifest.validation.totalCards} thẻ.
- Giữ nguyên ${manifest.validation.preservedStaff} tài khoản nội bộ; không phát sinh tham chiếu mồ côi mới trong các quan hệ model đã đối chiếu.
- Các con số trên là mốc ban đầu, sẽ thay đổi khi bạn tự tạo tòa, khai báo người, cấp quyền hoặc hủy/đăng ký xe.
`;
  return '\uFEFF' + header + sections + footer;
}

async function main() {
  await connectDB();
  await mkdir(directory, { recursive: true });
  const manifest = await loadFile(manifestUrl);
  if (manifest?.status === 'READY') {
    if (process.argv.includes('--validate')) { await validateData(manifest); await writeGuide(manifest); console.log('VALIDATED', JSON.stringify(manifest.validation)); }
    else console.log('Giữ nguyên 5 bộ đã tạo, không dọn/reset lại.');
    return;
  }
  if (manifest?.status === 'CLEANED' || manifest?.status === 'CREATING') {
    if (!APPLY) { console.log('Đã dọn; chờ tiếp tục tạo dữ liệu.', manifest.status); return; }
    await createData(manifest, async () => writeFile(manifestUrl, JSON.stringify(manifest, null, 2), 'utf8'));
    return;
  }
  const state = await snapshot();
  const plan = planCleanup(state);
  await writeFile(new URL('cleanup-plan.json', directory), JSON.stringify(plan.report, null, 2), 'utf8');
  console.log('PLAN', JSON.stringify({ deleteCounts: plan.report.deleteCounts, deletedBuildings: plan.report.deletedBuildings,
    deletedApartmentCodes: plan.report.deletedApartmentCodes, freeApartmentCodes: plan.report.freeApartmentCodes, protected: plan.report.protected }, null, 2));
  assert.ok(plan.freeApartments.length >= 30, `Cần 30 căn độc lập, hiện có ${plan.freeApartments.length}; không tự thêm căn`);
  if (!APPLY) return;
  const names = [
    ['Nguyễn Minh Khôi', 'Trần Thu Hà', 'Lê Quốc Anh', 'Phạm Hoàng Nam', 'Đỗ Ngọc Lan', 'Vũ Thanh Tùng', 'Ngô Thu Trang', 'Hoàng Thanh Phúc', 'Bùi Minh Đức'],
    ['Trần Quang Huy', 'Nguyễn Thị Hạnh', 'Phạm Duy Khánh', 'Lê Xuân Bách', 'Vũ Thảo My', 'Đặng Quốc Bảo', 'Đỗ Hồng Nhung', 'Hồ Minh Châu', 'Phan Anh Tuấn'],
    ['Lê Minh Sơn', 'Phạm Thu Thủy', 'Nguyễn Đức Long', 'Trần Văn Hải', 'Đặng Ngọc Mai', 'Bùi Quang Vinh', 'Võ Thanh Trúc', 'Ngô Hữu Phước', 'Hoàng Gia Bách'],
    ['Vũ Quốc Hưng', 'Đỗ Thanh Hằng', 'Trần Gia Huy', 'Nguyễn Mạnh Cường', 'Phan Thùy Linh', 'Lê Hoàng Phúc', 'Đặng Thu Quỳnh', 'Bùi Đức Thắng', 'Phạm Anh Khoa'],
    ['Đặng Minh Hoàng', 'Lê Thu Giang', 'Võ Quốc Việt', 'Nguyễn Trung Kiên', 'Trần Ngọc Ánh', 'Hồ Thanh Tú', 'Phạm Hải Yến', 'Vũ Đức Minh', 'Ngô Quang Dũng'],
  ];
  const familyNames = [
    ['Trần Ngọc Anh', 'Nguyễn Gia Bảo', 'Nguyễn Khánh Linh', 'Lê Thu Ngân', 'Lê Minh Khang'],
    ['Phạm Thu An', 'Trần Bảo Châu', 'Trần Minh Khoa', 'Nguyễn Bích Ngọc', 'Nguyễn Gia Hân'],
    ['Nguyễn Thu Hương', 'Lê Minh Anh', 'Lê Gia Huy', 'Phạm Diệu Linh', 'Phạm Quang Minh'],
    ['Trần Thanh Mai', 'Vũ Khánh An', 'Vũ Minh Đức', 'Nguyễn Ngọc Hân', 'Nguyễn Đức Anh'],
    ['Lê Ngọc Quỳnh', 'Đặng Gia Linh', 'Đặng Minh Khang', 'Trần Thu Phương', 'Trần Quang Khải'],
  ];
  const newManifest = {
    tag: TAG, status: 'PLANNED', createdAt: new Date().toISOString(), cleanup: plan.report,
    protectedStaff: state.User.filter((x) => x.role !== 'RESIDENT').map((x) => ({ phone: x.phone, fullName: x.fullName, isActive: x.isActive, role: x.role, passwordDigest: digest(x.passwordHash) })),
    protectedDocuments: {}, danglingBefore: await checkDanglingReferences(), sets: [],
  };
  const protectedT3 = new Set(state.Apartment.filter((a) => str(a.buildingId) === str(state.Building.find((b) => b.code === 'T3')._id)).map((x) => str(x._id)));
  for (const [name, docs] of Object.entries(state)) {
    const rows = docs.filter((doc) => singletonModels.has(name) || (name === 'Building' && doc.code === 'T3')
      || protectedT3.has(str(doc.apartmentId)) || (name === 'Apartment' && protectedT3.has(str(doc._id)))
      || (name === 'User' && /@nguoi3\.test$/i.test(doc.email ?? '')));
    if (rows.length) newManifest.protectedDocuments[name] = rows.map((doc) => ({ id: str(doc._id), digest: protectedDigest(doc) }));
  }
  const roles = ['Chủ căn gia đình', 'Chủ căn chuẩn bị cho thuê', 'Khách thuê dự kiến', 'Chủ cũ căn đang thuê', 'Khách thuê hiện tại', 'Chủ mới căn đang thuê', 'Chủ cũ căn trống', 'Chủ chờ cấp quyền và kích hoạt', 'Chủ mới căn trống'];
  const kinds = ['family', 'tenancy', 'rentedTransfer', 'vacantTransfer', 'account', 'catalog'];
  const mapUnit = (a) => ({ id: str(a._id), code: a.code, buildingId: str(a.buildingId), floor: a.floor, area: a.area });
  for (let index = 0; index < 5; index += 1) {
    const number = index + 1; const key = String(number).padStart(2, '0');
    const people = names[index].map((name, person) => ({ key: String(person + 1).padStart(2, '0'), name, purpose: roles[person], phone: `0909500${number}${String(person + 1).padStart(2, '0')}` }));
    for (const person of people) assert.ok(!state.User.some((user) => user.phone === person.phone && !plan.targets.User.has(str(user._id))), `SĐT ${person.phone} đang có người dùng khác`);
    newManifest.sets.push({ number, key, purpose: modeLabels[index],
      units: Object.fromEntries(kinds.map((kind, at) => [kind, mapUnit(plan.freeApartments[index * 6 + at])])), people,
      familyMembers: [[familyNames[index][0], '1991-03-10'], [familyNames[index][1], '2014-08-20'], [familyNames[index][2], '2019-11-05']],
      tenantMembers: [[familyNames[index][3], '1993-09-12'], [familyNames[index][4], '2018-06-01']],
      reserved: { residentCard: `CD-${key}-GD`, replacementCard: `CD-${key}-GD2`, manualPlate: `29B1-${number}10.05`,
        guestCard: `KH-${key}-MOI`, guestPlate: `30A-${number}40.05`, newOwnerPhone: `0909500${number}10`, newTenantPhone: `0909500${number}11`,
        manualMember: ['Nguyễn An Nhiên', 'Trần Tuệ Minh', 'Lê Bảo Nguyên', 'Vũ Khánh Vy', 'Đặng Thiên An'][index],
        tenantManualMember: ['Lê Hoài An', 'Phạm Gia Linh', 'Nguyễn Thanh Vy', 'Trần Minh An', 'Võ Bảo Châu'][index],
        newOwnerName: ['Đặng Thu Hương', 'Vũ Nhật Linh', 'Trần Hoài Nam', 'Nguyễn Bảo Trâm', 'Lê Thanh Tâm'][index],
        newTenantName: ['Phạm Thu Thủy', 'Nguyễn Thu Trang', 'Trần Ngọc Hạ', 'Võ Thanh Tùng', 'Lê Minh Nguyệt'][index],
        towerCode: `DT${key}` },
    });
  }
  newManifest.backgroundUnits = plan.freeApartments.slice(30).map(mapUnit);
  assert.equal(newManifest.backgroundUnits.length, 3, 'Đối chiếu lại số căn nền trước khi ghi');
  await writeFile(manifestUrl, JSON.stringify(newManifest, null, 2), 'utf8');
  await applyCleanup(state, plan);
  newManifest.status = 'CLEANED';
  const save = async () => writeFile(manifestUrl, JSON.stringify(newManifest, null, 2), 'utf8');
  await save();
  await createData(newManifest, save);
}

try { await main(); }
catch (error) { console.error(error.stack); process.exitCode = 1; }
finally { await disconnectDB(); }

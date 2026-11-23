// Tạo trạng thái minh họa UC22 trong database đang cấu hình. Không reset hoặc ghi đè dữ liệu.
// Chạy trước để xem kế hoạch: node scripts/seedUc22Demo.js
// Ghi dữ liệu: node scripts/seedUc22Demo.js --apply
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { CONSENT_POLICY_VERSION } from '../src/constants/enums.js';
import { Apartment, Building, Contract, Resident, User } from '../src/models/index.js';
import { createContract, issueOwnerAccount } from '../src/modules/contracts/contracts.service.js';
import { linkedRecords } from '../src/modules/buildings/inventory.service.js';
import { getApartmentById } from '../src/modules/apartments/apartments.service.js';
import { DAY_MS, startOfVnDay, toVnYmd } from '../src/utils/time.js';

const TAG = 'UC22-DEMO-20261114';
const PASSWORD = 'Sapms@123';
const apply = process.argv.includes('--apply');
const cases = [
  { id: '01', building: 'U13', code: 'U13102', phone: '0909222201', fullName: 'Nguyễn Minh Khôi [UC22]', prepare: 'empty',
    description: 'Ghi nhận chủ sở hữu mới từ đầu, cấp quyền và tự kích hoạt tại quầy' },
  { id: '02', building: 'U13', code: 'U13301', phone: '0909222202', fullName: 'Trần Thu Hà [UC22]', prepare: 'pending',
    description: 'Hồ sơ đã ghi nhận, chưa cấp quyền; chặn cấp mã trước UC22' },
  { id: '03A', building: 'A', code: 'A105', phone: '0909222203', fullName: 'Lê Quốc Anh [UC22]', prepare: 'granted', activated: true,
    description: 'Tài khoản đã kích hoạt, đã có quyền căn đầu tiên, căn vẫn trống' },
  { id: '03B', building: 'U13', code: 'U13302', phone: '0909222203', fullName: 'Lê Quốc Anh [UC22]', prepare: 'pending', activated: true,
    description: 'Liên kết thêm căn cho tài khoản có sẵn, giữ nguyên mật khẩu' },
  { id: '04', building: 'A', code: 'A108', phone: '0909222204', fullName: 'Phạm Ngọc Lan [UC22]', prepare: 'granted',
    description: 'Đã cấp quyền nhưng chưa kích hoạt; nhận mã mới tại quầy' },
  { id: '05', building: 'B', code: 'B401', phone: '0909222205', fullName: 'Hoàng Đức Nam [UC22]', prepare: 'pending', future: true,
    description: 'Hồ sơ chưa đến ngày hiệu lực, chưa được cấp quyền' },
  { id: '06', building: 'A', code: 'A401', phone: '0909222206', fullName: 'Đỗ Thanh Mai [UC22]', prepare: 'pending', locked: true,
    description: 'Người đứng tên có tài khoản bị khóa, không được cấp quyền hoặc mã' },
  { id: '07', building: 'B', code: 'B101', phone: '0909222207', fullName: 'Vũ Minh Tâm [UC22]', prepare: 'empty',
    description: 'Căn dành cho nhánh email: người kiểm thử tự nhập hộp thư có thể nhận mã' },
];

async function main() {
  await connectDB();
  const manager = await User.findOne({ role: 'MANAGER', isActive: true }).select('+passwordHash');
  const receptionist = await User.findOne({ role: 'STAFF', roleTitle: 'RECEPTIONIST', isActive: true }).select('+passwordHash');
  if (!manager || !receptionist) throw new Error('Cần tài khoản Trưởng BQL và Lễ tân đang hoạt động.');
  const actor = { id: String(manager._id), role: manager.role, roleTitle: manager.roleTitle };
  const countsBefore = { buildings: await Building.countDocuments(), apartments: await Apartment.countDocuments() };
  const prepared = [];

  // Đối chiếu toàn bộ trước khi ghi. Chỉ nhận căn trống hoặc dữ liệu cùng bộ minh họa.
  for (const item of cases) {
    const building = await Building.findOne({ code: item.building });
    if (!building) throw new Error(`Không tìm thấy tòa ${item.building}. Không tự tạo tòa thay thế.`);
    const apartment = await Apartment.findOne({ buildingId: building._id, code: item.code });
    if (!apartment) throw new Error(`Không tìm thấy căn ${item.code}. Không tự thêm căn ngoài danh mục.`);
    const documentNumber = `${TAG}-${item.id}`;
    const user = await User.findOne({ phone: item.phone });
    if (user && (user.role !== 'RESIDENT' || user.fullName !== item.fullName)) {
      throw new Error(`SĐT ${item.phone} đã thuộc dữ liệu khác. Không ghi đè.`);
    }
    const ownContract = await Contract.findOne({ apartmentId: apartment._id, ownershipDocumentNumber: documentNumber, type: 'SALE' });
    if (ownContract && (!user || String(ownContract.ownerId) !== String(user._id))) {
      throw new Error(`Hồ sơ ${documentNumber} không khớp người đứng tên dự kiến.`);
    }
    if (!ownContract) {
      const links = await linkedRecords('Apartment', apartment._id);
      if (links.length) throw new Error(`Căn ${item.code} đã có dữ liệu liên quan (${links.join(', ')}). Không sử dụng.`);
    }
    prepared.push({ ...item, documentNumber, apartmentId: String(apartment._id), buildingId: String(building._id),
      floor: apartment.floor, before: { status: apartment.status, occupancyStatus: apartment.occupancyStatus,
        handoverDate: apartment.handoverDate ?? null }, existingContractId: ownContract ? String(ownContract._id) : null });
  }

  console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'PLAN', tag: TAG,
    cases: prepared.map(({ id, building, code, phone, prepare, description }) => ({ id, building, code, phone, prepare, description })) }, null, 2));
  if (!apply) return;

  const today = startOfVnDay();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const result = [];
  for (const item of prepared) {
    let user = await User.findOne({ phone: item.phone });
    let contract = item.existingContractId ? await Contract.findById(item.existingContractId) : null;
    if (item.prepare !== 'empty' && !contract) {
      if (!user) {
        user = await User.create({ fullName: item.fullName, phone: item.phone, role: 'RESIDENT',
          isActive: !item.locked,
          ...(item.activated ? { passwordHash, activatedAt: new Date(), consents: [
            { action: 'ACCEPTED', policyVersion: CONSENT_POLICY_VERSION, createdAt: new Date() },
          ] } : {}),
        });
      }
      const startDate = item.future ? new Date(today.getTime() + 7 * DAY_MS) : today;
      const created = await createContract(actor, { apartmentId: item.apartmentId, type: 'SALE',
        owner: { userId: String(user._id), phone: user.phone, idNumber: `00000022${item.id.replace(/\D/g, '').padStart(4, '0')}` },
        ownershipDocumentType: 'DEVELOPER_SALE_CONTRACT', ownershipDocumentNumber: item.documentNumber,
        startDate: toVnYmd(startDate),
      }, null, 'UC22-DEMO-SEED');
      contract = created.contract;
      if (item.prepare === 'granted') {
        assert.equal(Boolean(user.email), false, 'Bộ dữ liệu này không tự gửi email.');
        await issueOwnerAccount(item.apartmentId, { contractId: String(contract._id), phone: user.phone }, actor, 'UC22-DEMO-SEED');
      }
    }
    // Không reset trường hợp đã được người dùng test qua: đọc lại trạng thái hiện có.
    user = await User.findOne({ phone: item.phone });
    contract = contract ? await Contract.findById(contract._id) : null;
    const linked = user ? await Resident.exists({ userId: user._id, apartmentId: item.apartmentId, relationType: 'OWNER', isActive: true }) : null;
    const apartment = await getApartmentById(item.apartmentId);
    assert.equal(apartment.handoverDate?.toISOString() ?? null,
      item.before.handoverDate?.toISOString() ?? null, 'Seed UC22 không thay đổi ngày bàn giao.');
    result.push({ ...item, userId: user ? String(user._id) : null, contractId: contract ? String(contract._id) : null,
      contractStartDate: contract ? toVnYmd(contract.startDate) : null,
      accountExists: Boolean(user), activated: Boolean(user?.activatedAt), locked: user?.isActive === false,
      ownerLinked: Boolean(linked), ownerAccountPending: contract?.ownerAccountPending ?? null,
      occupancyStatus: apartment.occupancyStatus, currentOccupants: apartment.activeResidentsCount,
      residentPassword: user?.activatedAt && item.activated ? PASSWORD : null,
      activation: user?.activatedAt ? 'Đã kích hoạt' : 'Tự lấy mã tại quầy và đặt mật khẩu khi test',
    });
  }
  assert.equal(await Building.countDocuments(), countsBefore.buildings, 'Không tạo thêm tòa.');
  assert.equal(await Apartment.countDocuments(), countsBefore.apartments, 'Không tạo thêm căn.');
  const staff = [];
  for (const user of [manager, receptionist]) {
    staff.push({ name: user.fullName, phone: user.phone, role: user.role, roleTitle: user.roleTitle,
      password: user.passwordHash && await bcrypt.compare(PASSWORD, user.passwordHash) ? PASSWORD : 'Dùng mật khẩu hiện tại; seed không đổi mật khẩu' });
  }
  const manifest = { tag: TAG, createdAt: new Date().toISOString(), note: 'Dữ liệu minh họa lưu tại database đang dùng. Không phải hồ sơ cư dân thật.',
    database: 'SAPMS (cấu hình hiện tại)', noBuildingOrApartmentCreated: true, noEmailSent: true,
    noActivationCodePreIssued: true, staff, cases: result };
  const destination = new URL('../../../baocaotiendocode/UC22_DATA_TEST_2026-11-14.json', import.meta.url);
  await mkdir(new URL('./', destination), { recursive: true });
  await writeFile(destination, JSON.stringify(manifest, null, 2), 'utf8');
  console.log('UC22_DATA_READY', JSON.stringify(result.map(({ id, code, phone, ownerLinked, activated, locked, contractStartDate, currentOccupants }) =>
    ({ id, code, phone, ownerLinked, activated, locked, contractStartDate, currentOccupants })), null, 2));
  console.log('MANIFEST', destination.pathname);
}

try { await main(); }
catch (error) { console.error('[UC22 demo]', error.message); process.exitCode = 1; }
finally { await disconnectDB(); }

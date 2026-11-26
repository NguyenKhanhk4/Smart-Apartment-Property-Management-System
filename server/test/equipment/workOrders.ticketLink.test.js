// Nối phản ánh của cư dân sang phiếu bảo trì (TICKET_LINKED)
import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Asset, Notification, Ticket, WorkOrder } from '../../src/models/index.js';
import { shiftChecklist } from '../../src/modules/workOrders/workOrders.inspection.js';
import { createFromTicket, syncTicketOnEnd } from '../../src/modules/workOrders/workOrders.ticketLink.js';
import { startOfVnDay } from '../../src/utils/time.js';
import { clearTestDB, closeTestDB, connectTestDB } from '../helpers/db.js';
import { asUser, createBuilding, createHousehold, createManager, createTechnician, createTicket } from '../helpers/fixtures.js';

before(connectTestDB);
after(closeTestDB);
afterEach(clearTestDB);

let seq = 0;
async function setup(ticketExtra = {}) {
  const { user, apartment } = await createHousehold();
  const manager = await createManager();
  const building = await createBuilding();
  seq += 1;
  const asset = await Asset.create({
    buildingId: building._id, name: `Thang máy ${seq}`, category: 'ELEVATOR', code: `TB-L${seq}`,
    cycleValue: 30, cycleUnit: 'DAY', nextMaintenanceDate: startOfVnDay(),
    checklist: [{ label: 'Tiếng ồn cabin', required: true }],
  });
  const ticket = await createTicket({ apartment, createdBy: user, type: 'COMPLAINT', ...ticketExtra });
  return { user, manager, mUser: asUser(manager), asset, ticket };
}

describe('createFromTicket', () => {
  it('tạo phiếu TICKET_LINKED, phản ánh sang Đang xử lý, gắn thiết bị, ghi lịch sử và báo cư dân', async () => {
    const { user, mUser, asset, ticket } = await setup();
    const wo = await createFromTicket(mUser, ticket._id, { assetId: String(asset._id), note: 'Kiểm tra giúp' });

    assert.equal(wo.type, 'TICKET_LINKED');
    assert.equal(wo.status, 'PENDING');
    assert.equal(String(wo.ticketId), String(ticket._id));
    assert.equal(wo.checklist.length, 1);

    const saved = await Ticket.findById(ticket._id).lean();
    assert.equal(saved.status, 'IN_PROGRESS');
    assert.ok(saved.respondedAt);
    assert.equal(String(saved.linkedAssetId), String(asset._id));
    assert.equal(saved.history.at(-1).action, 'MAINTENANCE_LINKED');
    assert.equal(await Notification.countDocuments({ userId: user._id, refId: ticket._id }), 1);
  });

  it('phân công luôn khi có assignedTo', async () => {
    const { mUser, asset, ticket } = await setup();
    const tech = await createTechnician();
    const wo = await createFromTicket(mUser, ticket._id, { assetId: String(asset._id), assignedTo: String(tech._id) });
    assert.equal(String((await WorkOrder.findById(wo._id).lean()).assignedTo), String(tech._id));
  });

  it('mỗi phản ánh chỉ 1 phiếu bảo trì đang mở', async () => {
    const { mUser, asset, ticket } = await setup();
    await createFromTicket(mUser, ticket._id, { assetId: String(asset._id) });
    await assert.rejects(createFromTicket(mUser, ticket._id, { assetId: String(asset._id) }), /đã có phiếu bảo trì/);
    assert.equal(await WorkOrder.countDocuments({ ticketId: ticket._id }), 1);
  });

  it('chặn sự cố trong căn hộ (đi luồng báo giá riêng)', async () => {
    const { mUser, asset, ticket } = await setup({ type: 'INCIDENT', scope: 'IN_APARTMENT' });
    await assert.rejects(createFromTicket(mUser, ticket._id, { assetId: String(asset._id) }), /Sự cố trong căn hộ/);
  });

  it('sự cố khu vực chung tạo được phiếu bảo trì; xong thì báo KTV đang xử lý để báo kết quả', async () => {
    const tech = await createTechnician();
    const { manager, mUser, asset, ticket } = await setup({ type: 'INCIDENT', scope: 'COMMON_AREA', status: 'ASSIGNED' });
    await Ticket.updateOne({ _id: ticket._id }, { assignedTo: tech._id });
    const wo = await createFromTicket(mUser, ticket._id, { assetId: String(asset._id) });
    assert.equal(wo.type, 'TICKET_LINKED');
    assert.equal((await Ticket.findById(ticket._id).lean()).status, 'ASSIGNED');

    await syncTicketOnEnd({ ticketId: wo.ticketId, status: 'DONE' });
    assert.equal(await Notification.countDocuments({ userId: tech._id, refId: ticket._id }), 1);
    assert.equal(await Notification.countDocuments({ userId: manager._id, refId: ticket._id }), 0);
  });

  it('chặn phản ánh đã đóng', async () => {
    const { mUser, asset, ticket } = await setup({ status: 'CLOSED' });
    await assert.rejects(createFromTicket(mUser, ticket._id, { assetId: String(asset._id) }), /đã đóng/);
  });

  it('chặn thiết bị ngừng sử dụng', async () => {
    const { mUser, asset, ticket } = await setup();
    await Asset.updateOne({ _id: asset._id }, { isActive: false });
    await assert.rejects(createFromTicket(mUser, ticket._id, { assetId: String(asset._id) }), /ngừng sử dụng/);
    assert.equal(await WorkOrder.countDocuments({ ticketId: ticket._id }), 0);
  });

  it('KTV đang xử lý phản ánh tự tạo phiếu bảo trì và nhận luôn; KTV khác bị chặn; phản ánh giữ trạng thái', async () => {
    const tech = await createTechnician();
    const stranger = await createTechnician();
    const { asset, ticket } = await setup({ status: 'ASSIGNED' });
    await Ticket.updateOne({ _id: ticket._id }, { assignedTo: tech._id });

    await assert.rejects(createFromTicket(asUser(stranger), ticket._id, { assetId: String(asset._id) }), /đang xử lý phản ánh này/);
    const wo = await createFromTicket(asUser(tech), ticket._id, { assetId: String(asset._id) });
    assert.equal(String((await WorkOrder.findById(wo._id).lean()).assignedTo), String(tech._id));
    assert.equal((await Ticket.findById(ticket._id).lean()).status, 'ASSIGNED');
  });

  it('phiếu theo phản ánh hiện trong Checklist ca của KTV', async () => {
    const { mUser, asset, ticket } = await setup();
    const tech = await createTechnician();
    const wo = await createFromTicket(mUser, ticket._id, { assetId: String(asset._id) });
    const { items } = await shiftChecklist(asUser(tech));
    assert.ok(items.some((i) => String(i._id) === String(wo._id)));
  });
});

describe('syncTicketOnEnd', () => {
  it('phiếu hoàn thành → ghi lịch sử phản ánh, báo Trưởng BQL và cư dân; phản ánh vẫn do Trưởng BQL đóng', async () => {
    const { user, manager, mUser, asset, ticket } = await setup();
    const wo = await createFromTicket(mUser, ticket._id, { assetId: String(asset._id) });
    await syncTicketOnEnd({ ticketId: wo.ticketId, status: 'DONE' });

    const saved = await Ticket.findById(ticket._id).lean();
    assert.equal(saved.status, 'IN_PROGRESS');
    assert.equal(saved.history.at(-1).action, 'MAINTENANCE_DONE');
    assert.equal(await Notification.countDocuments({ userId: manager._id, refId: ticket._id }), 1);
    assert.equal(await Notification.countDocuments({ userId: user._id, refId: ticket._id }), 2);
  });

  it('phiếu không gắn phản ánh → không làm gì, không lỗi', async () => {
    await syncTicketOnEnd({ ticketId: null, status: 'DONE' });
    await syncTicketOnEnd(null);
  });
});

import { Table } from 'antd';

const labels = { code: 'Mã', name: 'Tên tòa', address: 'Địa chỉ', totalFloors: 'Tổng số tầng',
  floor: 'Tầng', managementArea: 'Diện tích tính phí quản lý', occupancyStatus: 'Trạng thái sử dụng',
  handoverDate: 'Ngày bàn giao', technicalShaft: 'Vị trí hộp kỹ thuật' };
const show = (value) => {
  if (value === undefined || value === null || value === '') return 'Chưa ghi nhận';
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  if (typeof value === 'object') return Array.isArray(value) ? `${value.length} mục` : 'Thông tin hồ sơ';
  return String(value);
};

export default function InventoryHistoryDetail({ metadata }) {
  const changes = Object.entries(metadata?.changes ?? {}).map(([field, value]) => ({
    field: labels[field] ?? 'Thông tin căn hộ', from: show(value.from), to: show(value.to),
    effectivePeriod: value.effectivePeriod || '—',
  }));
  const apartments = metadata?.addedApartments ?? metadata?.apartments ?? [];
  const floors = metadata?.to?.floors ?? metadata?.floors ?? [];
  return <div className="space-y-3">
    {metadata?.code && <p><strong>Mã đối tượng:</strong> {metadata.code}</p>}
    {changes.length > 0 && <Table size="small" rowKey="field" pagination={false} dataSource={changes} columns={[
      { title: 'Thông tin thay đổi', dataIndex: 'field' }, { title: 'Trước', dataIndex: 'from' },
      { title: 'Sau', dataIndex: 'to' }, { title: 'Kỳ áp dụng', dataIndex: 'effectivePeriod' },
    ]} />}
    {floors.length > 0 && <Table size="small" rowKey="floor" pagination={false} dataSource={floors} columns={[
      { title: 'Tầng', dataIndex: 'floor' }, { title: 'Số căn theo hồ sơ', dataIndex: 'expectedCount' },
    ]} />}
    {apartments.length > 0 && <Table size="small" rowKey="code" pagination={{ pageSize: 10 }} dataSource={apartments} columns={[
      { title: 'Căn được thiết lập / bổ sung', dataIndex: 'code' }, { title: 'Tầng', dataIndex: 'floor' },
      { title: 'Diện tích tính phí quản lý (m²)', dataIndex: 'managementArea' },
    ]} />}
    {!changes.length && !floors.length && !apartments.length && <p>Lý do và tài liệu đối chiếu được ghi tại dòng lịch sử.</p>}
  </div>;
}

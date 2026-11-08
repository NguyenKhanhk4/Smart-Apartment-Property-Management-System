import { useState } from 'react';
import { Alert, App, Button, Card, Modal, Select, Space, Spin, Statistic, Table, Tabs, Tag } from 'antd';
import { EyeOutlined, FileExcelOutlined, ReloadOutlined } from '@ant-design/icons';
import { residentsApi } from '../../api/moduleA.api';
import PageHeader from '../../components/PageHeader';
import { useApi } from '../../hooks/useApi';
import { formatDate } from '../../utils/format';
import ApartmentOccupancyTag from '../buildings/ApartmentOccupancyTag';

const relationLabels = {
  OWNER: 'Chủ sở hữu đang ở',
  TENANT: 'Khách thuê',
  FAMILY_MEMBER: 'Thành viên ở cùng',
};

const residentColumns = [
  { title: 'Họ và tên', dataIndex: 'fullName' },
  { title: 'Ngày sinh', dataIndex: 'dateOfBirth', render: (value) => value ? formatDate(value) : '—' },
  { title: 'CCCD (che)', dataIndex: 'idNumber', render: (value) => value || '—' },
  {
    title: 'Vai trò tại căn',
    render: (_, resident) => (
      <Space wrap>
        {relationLabels[resident.relationType]}
        {resident.isHead && <Tag color="gold">Chủ hộ hiện tại</Tag>}
      </Space>
    ),
  },
];

function OccupancyExcelPreview({ filters, onClose }) {
  const { data, loading, error } = useApi(
    () => residentsApi.previewOccupancyExcel(filters),
    [filters.buildingId, filters.floor],
  );

  const columns = data?.columns.map(({ header, key, width }) => ({
    title: header,
    dataIndex: key,
    key,
    width: width * 8,
  }));

  return (
    <Modal title="Xem trước file Excel" open width={1100} onCancel={onClose}
      footer={<Button onClick={onClose}>Đóng</Button>}>
      <Spin spinning={loading}>
        <div className="min-h-32">
          {error && <Alert type="error" showIcon title={error.message} />}
          {!error && data && (
            <Tabs items={data.sheets.map((sheet) => ({
              key: sheet.name,
              label: sheet.name,
              children: (
                <div className="rounded-md border border-gray-200 dark:border-gray-700">
                  <div className="border-b border-gray-200 px-4 py-2 font-semibold dark:border-gray-700">{sheet.title}</div>
                  <div className="border-b border-gray-200 px-4 py-2 dark:border-gray-700">{sheet.summary}</div>
                  <Table
                    bordered size="small" rowKey="number" columns={columns} dataSource={sheet.rows}
                    pagination={false} scroll={{ x: 'max-content', y: 360 }}
                    locale={{ emptyText: 'Không có người đang ở trong phạm vi đã chọn' }}
                  />
                </div>
              ),
            }))} />
          )}
        </div>
      </Spin>
    </Modal>
  );
}

export default function ResidentOccupancyPage() {
  const { message } = App.useApp();
  const { data: buildings = [], loading, error, reload } = useApi(residentsApi.listOccupancy, []);
  const [buildingId, setBuildingId] = useState('');
  const [floor, setFloor] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [expandedRows, setExpandedRows] = useState([]);
  const [exporting, setExporting] = useState(false);

  const visibleBuildings = buildingId ? buildings.filter((building) => building._id === buildingId) : buildings;
  const apartments = visibleBuildings.flatMap((building) => building.apartments.map((apartment) => ({
    ...apartment, buildingName: building.name, buildingAddress: building.address,
  })));
  const floors = [...new Set(apartments.map((apartment) => apartment.floor)
    .filter((value) => Number.isInteger(value) && value >= 1))].sort((a, b) => a - b);
  const rows = floor === '' ? apartments : apartments.filter((apartment) => apartment.floor === floor);
  const residents = rows.reduce((count, apartment) => count + apartment.residents.length, 0);
  const reportFilters = { buildingId: buildingId || undefined, floor: floor === '' ? undefined : floor };
  const reportDisabled = loading || Boolean(error) || visibleBuildings.length === 0 || (floor !== '' && rows.length === 0);

  async function exportExcel() {
    setExporting(true);
    try {
      await residentsApi.exportOccupancy(reportFilters);
      message.success('Đã xuất danh sách người đang ở');
    } catch (err) {
      message.error(err.message || 'Xuất Excel thất bại');
    } finally {
      setExporting(false);
    }
  }

  const columns = [
    {
      title: 'Tòa nhà',
      render: (_, row) => (
        <div>
          <b>{row.buildingName}</b>
          {row.buildingAddress && <div className="text-xs text-gray-500">{row.buildingAddress}</div>}
        </div>
      ),
    },
    { title: 'Tầng', dataIndex: 'floor', render: (value) => value ?? '—' },
    { title: 'Căn hộ', dataIndex: 'code' },
    {
      title: 'Trạng thái căn',
      dataIndex: 'occupancyStatus',
      render: (status) => <ApartmentOccupancyTag status={status} />,
    },
    { title: 'Số người đang ở', render: (_, row) => row.residents.length },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Thông tin cư trú"
        subtitle="Danh sách người đang ở theo tòa nhà và căn hộ để Ban quản lý phối hợp rà soát cư trú"
        extra={
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={reload}>Làm mới</Button>
            <Button icon={<EyeOutlined />} disabled={reportDisabled} onClick={() => setPreviewOpen(true)}>
              Xem trước
            </Button>
            <Button type="primary" icon={<FileExcelOutlined />} loading={exporting}
              disabled={reportDisabled} onClick={exportExcel}>
              {buildingId ? 'Xuất Excel tòa đang chọn' : 'Xuất Excel toàn bộ tòa'}
            </Button>
          </Space>
        }
      />

      <Card size="small">
        <Space size="large" wrap>
          <Select
            aria-label="Tòa nhà" value={buildingId} style={{ minWidth: 190 }}
            onChange={(id) => {
              setBuildingId(id);
              setFloor('');
              setExpandedRows([]);
            }}
            options={[{ value: '', label: 'Tất cả tòa nhà' },
              ...buildings.map((building) => ({ value: building._id, label: building.name }))]}
          />
          <Select
            aria-label="Tầng" value={floor} style={{ minWidth: 175 }}
            onChange={(value) => {
              setFloor(value);
              setExpandedRows([]);
            }}
            options={[{ value: '', label: 'Tất cả tầng' },
              ...floors.map((value) => ({ value, label: 'Tầng ' + value }))]}
          />
          <Statistic title="Số căn trong danh sách" value={rows.length} />
          <Statistic title="Số người đang ở" value={residents} />
        </Space>
      </Card>

      <Card size="small">
        <Table
          rowKey="_id" loading={loading} columns={columns} dataSource={rows} scroll={{ x: 660 }}
          pagination={{ pageSize: 20 }}
          expandable={{
            expandedRowKeys: expandedRows,
            onExpandedRowsChange: setExpandedRows,
            rowExpandable: (row) => row.residents.length > 0,
            expandedRowRender: (row) => (
              <Table size="small" rowKey="_id" pagination={false} columns={residentColumns} dataSource={row.residents} />
            ),
          }}
        />
      </Card>
      {previewOpen && <OccupancyExcelPreview filters={reportFilters} onClose={() => setPreviewOpen(false)} />}
    </div>
  );
}

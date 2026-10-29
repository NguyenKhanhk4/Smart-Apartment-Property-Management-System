import { useState } from 'react';
import {
  Button,
  Card,
  Col,
  DatePicker,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  message,
} from 'antd';
import {
  FileExcelOutlined,
  LoginOutlined,
  LogoutOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { residentsApi } from '../../api/moduleA.api';
import EnumTag from '../../components/EnumTag';
import PageHeader from '../../components/PageHeader';
import { RELATION_TYPES } from '../../constants/enums';
import { useApi } from '../../hooks/useApi';
import { formatDate } from '../../utils/format';

export default function OccupantChangesPage() {
  const [dateRange, setDateRange] = useState([
    dayjs().subtract(30, 'day'),
    dayjs(),
  ]);
  const [exporting, setExporting] = useState(false);

  const fromStr = dateRange?.[0] ? dateRange[0].format('YYYY-MM-DD') : undefined;
  const toStr = dateRange?.[1] ? dateRange[1].format('YYYY-MM-DD') : undefined;

  const {
    data: changes = [],
    loading,
    reload,
  } = useApi(
    () => residentsApi.listChanges({ from: fromStr, to: toStr }),
    [fromStr, toStr],
  );

  const rows = Array.isArray(changes) ? changes : changes?.items || [];
  const moveInCount = rows.filter((r) => r.changeType === 'MOVE_IN').length;
  const moveOutCount = rows.filter((r) => r.changeType === 'MOVE_OUT').length;

  const handleExport = async () => {
    setExporting(true);
    try {
      const filename = await residentsApi.exportChanges({ from: fromStr, to: toStr });
      message.success(`Đã xuất báo cáo biến động nhân khẩu: ${filename}`);
    } catch (err) {
      message.error(err?.message || 'Xuất Excel thất bại');
    } finally {
      setExporting(false);
    }
  };

  const columns = [
    {
      title: 'Họ tên',
      dataIndex: 'fullName',
      key: 'fullName',
      render: (v) => <span className="font-semibold">{v}</span>,
    },
    {
      title: 'Ngày sinh',
      dataIndex: 'dateOfBirth',
      key: 'dateOfBirth',
      render: (v) => formatDate(v) || '—',
    },
    {
      title: 'CCCD (che)',
      dataIndex: 'idNumber',
      key: 'idNumber',
      render: (v) => (v ? <code className="text-xs">{v}</code> : '—'),
    },
    {
      title: 'Căn hộ',
      key: 'apartment',
      render: (_, r) => (
        <span>
          <b>{r.apartmentCode}</b> {r.buildingName ? `(${r.buildingName})` : ''}
        </span>
      ),
    },
    {
      title: 'Quan hệ',
      dataIndex: 'relationType',
      key: 'relationType',
      render: (v) => <EnumTag map={RELATION_TYPES} value={v} />,
    },
    {
      title: 'Loại biến động',
      dataIndex: 'changeType',
      key: 'changeType',
      render: (v) =>
        v === 'MOVE_IN' ? (
          <Tag color="success" icon={<LoginOutlined />}>
            Vào ở
          </Tag>
        ) : (
          <Tag color="volcano" icon={<LogoutOutlined />}>
            Chuyển đi
          </Tag>
        ),
    },
    {
      title: 'Ngày biến động',
      dataIndex: 'date',
      key: 'date',
      render: (v) => formatDate(v),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Biến động nhân khẩu (UC21)"
        subtitle="Xem trước và xuất Excel danh sách cư dân vào ở / chuyển đi theo khoảng thời gian"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => reload()}>
              Làm mới
            </Button>
            <Button
              type="primary"
              icon={<FileExcelOutlined />}
              loading={exporting}
              onClick={handleExport}
            >
              Xuất Excel
            </Button>
          </Space>
        }
      />

      <Card size="small">
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} md={12}>
            <Space wrap>
              <span className="text-sm font-medium">Khoảng ngày:</span>
              <DatePicker.RangePicker
                value={dateRange}
                onChange={(vals) => setDateRange(vals)}
                format="DD/MM/YYYY"
                allowClear={false}
              />
              <Button icon={<SearchOutlined />} onClick={() => reload()}>
                Xem trước
              </Button>
            </Space>
          </Col>
          <Col xs={8} md={4}>
            <Statistic title="Tổng biến động" value={rows.length} />
          </Col>
          <Col xs={8} md={4}>
            <Statistic
              title="Vào ở"
              value={moveInCount}
              styles={{ content: { color: '#10b981' } }}
            />
          </Col>
          <Col xs={8} md={4}>
            <Statistic
              title="Chuyển đi"
              value={moveOutCount}
              styles={{ content: { color: '#ef4444' } }}
            />
          </Col>
        </Row>
      </Card>

      <Card size="small">
        <Table
          rowKey="_id"
          loading={loading}
          columns={columns}
          dataSource={rows}
          pagination={{ pageSize: 20 }}
          scroll={{ x: 800 }}
        />
      </Card>
    </div>
  );
}

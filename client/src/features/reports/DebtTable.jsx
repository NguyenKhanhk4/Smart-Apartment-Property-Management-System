import { Flex, Table, Tag, Typography } from 'antd';
import { reportApi } from '../../api/moduleE.api';
import { useApi } from '../../hooks/useApi';
import { formatDate, formatMoney } from '../../utils/format';
import { ExportButton } from './components';

// Danh sách căn hộ có hóa đơn quá hạn (nguồn xuất báo cáo "debts" — UC-E13)
export default function DebtTable({ buildingId }) {
  const { data, loading } = useApi(() => reportApi.debts({ buildingId }), [buildingId]);
  return (
    <Flex vertical gap={8}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Typography.Text>
          <b>{data?.totalApartments ?? 0}</b> căn quá hạn · tổng nợ <b>{formatMoney(data?.totalOutstanding)}</b> ·{' '}
          <Typography.Text type="danger">{data?.unassigned ?? 0} căn chưa giao người đòi nợ</Typography.Text>
        </Typography.Text>
        <ExportButton type="debts" params={{ buildingId }} />
      </Flex>
      <Table
        rowKey="apartmentId"
        size="small"
        loading={loading}
        dataSource={data?.items}
        scroll={{ x: 760 }}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: 'Căn hộ', dataIndex: 'apartmentCode', width: 90 },
          { title: 'Tòa', dataIndex: 'buildingName', width: 90 },
          { title: 'Các kỳ nợ', dataIndex: 'periods', render: (v) => v.map((p) => <Tag key={p}>{p}</Tag>) },
          { title: 'Số tiền', dataIndex: 'outstanding', align: 'right', render: formatMoney },
          { title: 'Hạn sớm nhất', dataIndex: 'oldestDueDate', render: formatDate },
          { title: 'Quá hạn', dataIndex: 'daysOverdue', align: 'right', render: (v) => `${v} ngày` },
          { title: 'Phụ trách', dataIndex: 'assignedTo', render: (v) => v ?? <Tag color="red">Chưa giao</Tag> },
        ]}
      />
    </Flex>
  );
}

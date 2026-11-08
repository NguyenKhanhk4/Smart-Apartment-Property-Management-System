import { useState } from 'react';
import { Alert, App, Button, Card, Checkbox, Flex, Segmented, Skeleton, Table, Tooltip, Typography } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { permissionApi } from '../../api/moduleA.api';
import PageHeader from '../../components/PageHeader';
import { useApi } from '../../hooks/useApi';
import { notifyPermissionsChanged } from '../../utils/permissionEvents';
import { ACTIONS, ACTION_LABELS, CORE_MESSAGE, changedCount, grantedOf, groupFeatures, keyOf, toggle } from './permissionMatrix';

// UC04 – Phân quyền theo vai trò (Trưởng BQL). BR-S07, BR-X2 (vai trò Trưởng BQL chỉ đọc), BR-X3 (quyền lõi)
export default function PermissionMatrixPage() {
  const { message, modal } = App.useApp();
  const [roleKey, setRoleKey] = useState('RECEPTIONIST');
  const roles = useApi(() => permissionApi.roles(), []);
  const matrix = useApi(() => permissionApi.matrix(roleKey), [roleKey]);

  // Bản đang sửa gắn với đúng ma trận đã tải; tải lại / đổi vai trò thì tự về bản đã lưu
  const [draft, setDraft] = useState({ source: null, keys: new Set() });
  // Chỉ dùng ma trận đúng vai trò đang chọn: vừa đổi vai trò mà chưa tải xong thì không hiện / không lưu bản cũ
  const current = matrix.data?.roleKey === roleKey ? matrix.data : null;
  const saved = grantedOf(current);
  const editing = draft.source === current ? draft.keys : saved;
  const changes = changedCount(saved, editing);
  const readOnly = Boolean(current?.readOnly);
  const [saving, setSaving] = useState(false);

  const pickRole = (next) => {
    if (!changes) return setRoleKey(next);
    return modal.confirm({
      title: 'Bỏ các thay đổi chưa lưu?',
      content: `Có ${changes} ô đã đổi nhưng chưa lưu cho vai trò ${current?.label}.`,
      okText: 'Bỏ thay đổi',
      cancelText: 'Ở lại',
      onOk: () => setRoleKey(next),
    });
  };

  const save = () =>
    modal.confirm({
      // MSG-G08
      title: `Bạn có chắc muốn lưu phân quyền cho vai trò ${current.label}?`,
      content: `${changes} ô thay đổi. Người dùng thuộc vai trò này sẽ áp dụng quyền mới từ lần thao tác kế tiếp.`,
      okText: 'Lưu',
      cancelText: 'Hủy',
      onOk: async () => {
        setSaving(true);
        try {
          const res = await permissionApi.save(roleKey, [...editing]);
          message.success(res.message ?? 'Đã cập nhật phân quyền.'); // MSG-S15
          notifyPermissionsChanged();
          matrix.reload();
        } catch (err) {
          message.error(err.message);
        } finally {
          setSaving(false);
        }
      },
    });

  const cell = (feature, action) => {
    const info = feature.actions[action];
    if (!info?.available) {
      return (
        <Tooltip title="Vai trò này không có thao tác này">
          <Typography.Text type="secondary">—</Typography.Text>
        </Tooltip>
      );
    }
    const key = keyOf(feature.code, action);
    const label = `${ACTION_LABELS[action]} ${feature.label}`;
    if (info.core || readOnly) {
      // Bước 3a: ô lõi luôn bật, bấm vào thì báo MSG-S14
      return (
        <Tooltip title={readOnly ? 'Quyền của Trưởng BQL cố định (BR-X2)' : CORE_MESSAGE}>
          <span
            role="button"
            tabIndex={0}
            onClick={() => !readOnly && message.info(CORE_MESSAGE)}
            onKeyDown={(e) => e.key === 'Enter' && !readOnly && message.info(CORE_MESSAGE)}
          >
            <Checkbox checked disabled aria-label={label} />
            {info.core && <LockOutlined style={{ marginLeft: 4, fontSize: 11, color: 'var(--ant-color-text-tertiary)' }} />}
          </span>
        </Tooltip>
      );
    }
    return (
      <Checkbox
        aria-label={label}
        checked={editing.has(key)}
        onChange={() => setDraft({ source: current, keys: toggle(editing, feature, action) })}
      />
    );
  };

  const columns = [
    { title: 'Chức năng', dataIndex: 'label', fixed: 'left', width: 220 },
    ...ACTIONS.map((action) => ({
      title: ACTION_LABELS[action],
      key: action,
      align: 'center',
      width: 80,
      render: (_, feature) => cell(feature, action),
    })),
  ];

  return (
    <Flex vertical gap={16}>
      <PageHeader
        title="Phân quyền theo vai trò"
        subtitle="Bật hoặc tắt quyền Xem / Tạo / Sửa / Xóa / Duyệt trên từng chức năng cho mỗi vai trò."
        breadcrumb={[{ label: 'Trang chủ', path: '/app/home' }, { label: 'Phân quyền' }]}
      />

      <Card size="small">
        <Segmented
          block
          value={roleKey}
          onChange={pickRole}
          options={(roles.data ?? []).map((r) => ({ value: r.key, label: r.label }))}
          style={{ overflowX: 'auto' }}
        />
      </Card>

      {readOnly ? (
        <Alert type="info" showIcon title="Quyền của Trưởng BQL cố định từ lúc cài đặt, không chỉnh sửa được (BR-X2)." />
      ) : (
        <Alert
          type="info"
          showIcon
          title="Chỉ tắt được quyền trong phạm vi chức năng của vai trò. Ô có khóa là quyền lõi, luôn bật (BR-X3)."
          description="Ô “—” là thao tác vai trò này không có. Thay đổi áp dụng từ lần thao tác kế tiếp của người dùng."
        />
      )}

      {matrix.error && (
        <Alert type="error" showIcon title={matrix.error.message} action={<Button onClick={matrix.reload}>Thử lại</Button>} />
      )}

      {!current ? (
        !matrix.error && <Card><Skeleton active /></Card>
      ) : (
        groupFeatures(current.features).map(({ group, items }) => (
          <Card key={group} size="small" title={group}>
            <Table rowKey="code" size="small" pagination={false} dataSource={items} columns={columns} scroll={{ x: 640 }} />
          </Card>
        ))
      )}

      {!readOnly && current && (
        <Card size="small" style={{ position: 'sticky', bottom: 0, zIndex: 10, boxShadow: '0 -4px 12px rgba(0,0,0,0.08)' }}>
          <Flex justify="space-between" align="center" wrap gap={8}>
            <Typography.Text type={changes ? 'warning' : 'secondary'}>
              {changes ? `${changes} ô đã thay đổi, chưa lưu` : 'Chưa có thay đổi'}
            </Typography.Text>
            <Flex gap={8}>
              {/* Bước 4a: Hủy thì không lưu gì */}
              <Button disabled={!changes || saving} onClick={() => setDraft({ source: null, keys: new Set() })}>
                Hủy
              </Button>
              <Button type="primary" disabled={!changes} loading={saving} onClick={save}>
                Lưu
              </Button>
            </Flex>
          </Flex>
        </Card>
      )}
    </Flex>
  );
}

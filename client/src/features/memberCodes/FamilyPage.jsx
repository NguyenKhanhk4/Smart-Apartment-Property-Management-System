import { useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { App, Avatar, Button, Card, DatePicker, Empty, Flex, Modal, Result, Segmented, Spin, Switch, Tag, Typography } from 'antd';
import { ArrowLeftOutlined, EditOutlined, IdcardOutlined, PlusOutlined, UserOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { memberCodeApi } from '../../api/moduleD.api';
import { residentsApi } from '../../api/moduleA.api';
import EnumTag from '../../components/EnumTag';
import { AGE_GROUPS, RELATION_TYPES } from '../../constants/enums';
import { useApi } from '../../hooks/useApi';
import { useResident } from '../../hooks/useResident';
import { vtName } from '../../motion/viewTransition';
import { formatDate, parseVnDate } from '../../utils/format';
import FamilyMemberModal from '../residents/FamilyMemberModal';
import MemberCard from './MemberCard';

const ageText = (member) => (member.age === null ? 'Chưa có ngày sinh' : `${member.age} tuổi`);

// UC15 — người đang ở và thông tin khai báo; giữ mã và quyền tiện ích UC-D11 theo tài khoản.
export default function FamilyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = App.useApp();
  const { apartmentId: headerApartmentId, reloadResidency } = useResident();
  const [search, setSearch] = useSearchParams();
  const { data: mine = [], loading: loadingMine, reload: reloadApartments } = useApi(residentsApi.myApartments, []);
  const headOf = mine.filter((apartment) => apartment.canDeclareFamily);
  const apartmentId = search.get('apartmentId')
    ?? headOf.find((apartment) => apartment.apartmentId === headerApartmentId)?.apartmentId
    ?? headOf[0]?.apartmentId;
  const isHeadHere = headOf.some((apartment) => apartment.apartmentId === apartmentId);
  const currentApartment = headOf.find((apartment) => apartment.apartmentId === apartmentId);
  const { data: records = [], loading: loadingMembers, reload: reloadMembers } = useApi(
    () => residentsApi.listByApartment(apartmentId), [apartmentId], { enabled: isHeadHere },
  );
  const occupants = records.filter((member) => member.occupancyRole)
    .sort((a, b) => Number(b.occupancyRole === 'HEAD') - Number(a.occupancyRole === 'HEAD'));
  const { data, loading, reload } = useApi(() => memberCodeApi.household(apartmentId), [apartmentId], { enabled: isHeadHere });
  const [showing, setShowing] = useState(null);
  const [busy, setBusy] = useState(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const closeForm = () => { setAdding(false); setEditing(null); };
  const goBack = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate('/r/my-apartment', { replace: true });
  };
  const saved = async () => {
    closeForm();
    await Promise.all([reloadMembers(), reload(), reloadApartments(), reloadResidency()]);
  };

  const update = async (member, body) => {
    setBusy(member.userId);
    try {
      await memberCodeApi.updateMember(member.userId, body, apartmentId);
      message.success('Đã cập nhật');
      await Promise.all([reload(), reloadMembers()]);
    } catch (error) {
      message.error(error.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Flex vertical gap={12}>
      <Flex align="center" gap={8}>
        <Button type="text" icon={<ArrowLeftOutlined />} aria-label="Quay lại" onClick={goBack} />
        <Typography.Title level={3} style={{ margin: 0, ...vtName('my-code-title') }}>
          Thông tin thành viên gia đình
        </Typography.Title>
      </Flex>
      {headOf.length > 1 && (
        <Segmented block value={apartmentId}
          onChange={(id) => { closeForm(); setShowing(null); setSearch({ apartmentId: id }, { replace: true }); }}
          options={headOf.map((apartment) => ({ value: apartment.apartmentId, label: `Căn ${apartment.code}` }))} />
      )}
      <Spin spinning={loadingMine || loading || loadingMembers}>
        {!loadingMine && !isHeadHere ? (
          <Result status="403" title="Chỉ chủ hộ đang ở mới quản lý gia đình"
            subTitle="Chủ hộ hoặc khách thuê đang ở quản lý thông tin thành viên tại căn hộ của mình."
            extra={<Button onClick={goBack}>Quay lại</Button>} />
        ) : (
          <Flex vertical gap={8}>
            <Flex justify="space-between" align="center" gap={12} wrap>
              <Typography.Title level={4} style={{ margin: 0 }}>
                Người đang ở · Căn {currentApartment?.code} ({occupants.length})
              </Typography.Title>
              {isHeadHere && <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>Thêm thành viên gia đình</Button>}
            </Flex>
            {!loadingMembers && !occupants.length && <Empty description="Chưa có người đang ở" />}
            {occupants.map((member) => (
              <Card key={member._id} size="small">
                <Flex align="center" gap={12} wrap>
                  <Avatar src={member.avatarUrl} icon={<UserOutlined />} />
                  <Flex vertical style={{ flex: 1, minWidth: 160 }}>
                    <Typography.Text strong>{member.fullName}</Typography.Text>
                    <Typography.Text type="secondary">Ngày sinh: {formatDate(member.dateOfBirth) || 'Chưa ghi nhận'}</Typography.Text>
                  </Flex>
                  {member.occupancyRole === 'HEAD' ? <Tag color="gold">Chủ hộ</Tag> : <Tag>Thành viên gia đình</Tag>}
                  {!member.userId && member.occupancyRole === 'MEMBER' && <Button icon={<EditOutlined />}
                    onClick={() => setEditing(member)}>Chỉnh sửa thông tin</Button>}
                </Flex>
              </Card>
            ))}
            {data?.members.length > 0 && <>
              <Typography.Title level={4}>Mã và quyền sử dụng tiện ích</Typography.Title>
              <Typography.Paragraph type="secondary">
                Phần này áp dụng cho người có tài khoản và mã cư dân. Thành viên khai báo không có tài khoản vẫn nằm trong danh sách người đang ở phía trên.
              </Typography.Paragraph>
            </>}
            {data?.members.map((member) => (
              <Card key={member.userId} size="small">
                <Flex vertical gap={10}>
                  <Flex gap={12} align="center">
                    <Avatar size={48} src={member.avatarUrl} icon={<UserOutlined />} />
                    <Flex vertical style={{ minWidth: 0, flex: 1 }}>
                      <Typography.Text strong ellipsis>{member.fullName}</Typography.Text>
                      <Flex gap={4} wrap align="center">
                        {member.isHead ? <Tag color="gold">Chủ hộ</Tag> : <EnumTag map={RELATION_TYPES} value={member.relationType} />}
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{ageText(member)}</Typography.Text>
                        <EnumTag map={AGE_GROUPS} value={member.ageGroup} />
                      </Flex>
                    </Flex>
                    <Typography.Text strong style={{ fontFamily: 'monospace' }}>{member.code}</Typography.Text>
                  </Flex>
                  <Flex justify="space-between" align="center" gap={8} wrap>
                    <Typography.Text>Ngày sinh</Typography.Text>
                    <DatePicker allowClear format="DD/MM/YYYY" placeholder="DD/MM/YYYY" inputReadOnly
                      disabled={busy === member.userId} value={parseVnDate(member.dateOfBirth)}
                      disabledDate={(date) => date.isAfter(dayjs(), 'day') || date.isBefore(dayjs('1900-01-01'), 'day')}
                      onChange={(date) => update(member, { dateOfBirth: date ? date.format('YYYY-MM-DD') : null })} />
                  </Flex>
                  <Flex justify="space-between" align="center" gap={8}>
                    <Flex vertical>
                      <Typography.Text>Được phát sinh phí tiện ích</Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {member.isHead ? 'Chủ hộ luôn được' : 'Phí cộng vào hóa đơn của căn hộ'}
                      </Typography.Text>
                    </Flex>
                    <Switch checked={member.canIncurCharges} disabled={member.isHead || busy === member.userId}
                      onChange={(checked) => update(member, { canIncurCharges: checked })} />
                  </Flex>
                  <Button icon={<IdcardOutlined />} onClick={() => setShowing(member)}>Hiện thẻ</Button>
                </Flex>
              </Card>
            ))}
          </Flex>
        )}
      </Spin>
      {(adding || editing) && <FamilyMemberModal key={`${apartmentId}-${editing?._id ?? 'new'}`}
        apartmentId={apartmentId} apartmentCode={currentApartment?.code} member={editing}
        onCancel={closeForm} onSaved={saved} />}
      <Modal open={Boolean(showing)} onCancel={() => setShowing(null)} footer={null} destroyOnHidden title="Thẻ thành viên" width="min(420px, 94vw)">
        {showing && <MemberCard person={{ ...showing, apartment: data?.apartment }} />}
      </Modal>
    </Flex>
  );
}

import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Alert, App, Avatar, Button, Card, DatePicker, Empty, Flex, Modal, Result, Segmented, Spin, Switch, Tag, Typography } from 'antd';
import { ArrowLeftOutlined, IdcardOutlined, UserOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { memberCodeApi } from '../../api/moduleD.api';
import EnumTag from '../../components/EnumTag';
import { AGE_GROUPS, RELATION_TYPES } from '../../constants/enums';
import { useApi } from '../../hooks/useApi';
import { vtName } from '../../motion/viewTransition';
import MemberCard from './MemberCard';

const ageText = (m) => (m.age === null ? 'Chưa có ngày sinh' : `${m.age} tuổi`);

// UC-D11 — "Gia đình" (chỉ chủ hộ): ngày sinh, quyền phát sinh phí (BR-O26), hiện thẻ cho thành viên (trẻ em không có điện thoại)
export default function FamilyPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [search, setSearch] = useSearchParams();
  const { data: mine = [], loading: loadingMine } = useApi(() => memberCodeApi.mine(), []);
  const headOf = mine.filter((c) => c.isHead);
  const apartmentId = search.get('apartmentId') ?? headOf[0]?.apartment._id;
  const isHeadHere = headOf.some((c) => c.apartment._id === apartmentId);

  const { data, loading, reload } = useApi(() => memberCodeApi.household(apartmentId), [apartmentId], { enabled: isHeadHere });
  const [showing, setShowing] = useState(null); // thành viên đang hiện thẻ
  const [busy, setBusy] = useState(null);

  const update = async (m, body) => {
    setBusy(m.userId);
    try {
      await memberCodeApi.updateMember(m.userId, body, apartmentId);
      message.success('Đã cập nhật');
      await reload();
    } catch (e) {
      message.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Flex vertical gap={12}>
      <Flex align="center" gap={8}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          aria-label="Quay lại"
          onClick={() => navigate('/r/my-code', { viewTransition: true })}
        />
        <Typography.Title level={4} style={{ margin: 0, ...vtName('my-code-title') }}>
          Gia đình
        </Typography.Title>
      </Flex>

      {headOf.length > 1 && (
        <Segmented
          block
          value={apartmentId}
          onChange={(id) => setSearch({ apartmentId: id })}
          options={headOf.map((c) => ({ value: c.apartment._id, label: `Căn ${c.apartment.code}` }))}
        />
      )}

      <Spin spinning={loadingMine || loading}>
        {!loadingMine && !isHeadHere ? (
          <Result
            status="403"
            title="Chỉ chủ hộ mới quản lý gia đình"
            subTitle="Nhờ chủ hộ thực hiện, hoặc liên hệ Lễ tân để được hỗ trợ."
            extra={<Button onClick={() => navigate('/r/my-code', { viewTransition: true })}>Về Mã của tôi</Button>}
          />
        ) : (
          <Flex vertical gap={8}>
            <Alert
              type="info"
              showIcon
              message="Thêm hoặc xóa thành viên do Lễ tân thực hiện tại quầy."
              description="Ngày sinh dùng để tính giá vé: trẻ nhỏ được miễn phí, trẻ em có giá riêng. Chưa có ngày sinh được tính như người lớn; Lễ tân có thể đối chiếu lại với giấy tờ."
            />
            {data && !data.members.length && <Empty description="Chưa có thành viên" />}
            {data?.members.map((m) => (
              <Card key={m.userId} size="small">
                <Flex vertical gap={10}>
                  <Flex gap={12} align="center">
                    <Avatar size={48} src={m.avatarUrl} icon={<UserOutlined />} />
                    <Flex vertical style={{ minWidth: 0, flex: 1 }}>
                      <Typography.Text strong ellipsis>
                        {m.fullName}
                      </Typography.Text>
                      <Flex gap={4} wrap align="center">
                        {m.isHead ? <Tag color="gold">Chủ hộ</Tag> : <EnumTag map={RELATION_TYPES} value={m.relationType} />}
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {ageText(m)}
                        </Typography.Text>
                        <EnumTag map={AGE_GROUPS} value={m.ageGroup} />
                      </Flex>
                    </Flex>
                    <Typography.Text strong style={{ fontFamily: 'monospace' }}>
                      {m.code}
                    </Typography.Text>
                  </Flex>

                  <Flex justify="space-between" align="center" gap={8} wrap>
                    <Typography.Text>Ngày sinh</Typography.Text>
                    <DatePicker
                      allowClear
                      format="DD/MM/YYYY"
                      placeholder="DD/MM/YYYY"
                      inputReadOnly
                      disabled={busy === m.userId}
                      value={m.dateOfBirth ? dayjs(m.dateOfBirth).utcOffset(7 * 60) : null} // ngày sinh lưu 00:00 giờ VN
                      disabledDate={(d) => d.isAfter(dayjs(), 'day')}
                      onChange={(d) => update(m, { dateOfBirth: d ? d.format('YYYY-MM-DD') : null })}
                    />
                  </Flex>

                  <Flex justify="space-between" align="center" gap={8}>
                    <Flex vertical>
                      <Typography.Text>Được phát sinh phí tiện ích</Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {m.isHead ? 'Chủ hộ luôn được' : 'Phí cộng vào hóa đơn của căn hộ'}
                      </Typography.Text>
                    </Flex>
                    <Switch
                      checked={m.canIncurCharges}
                      disabled={m.isHead || busy === m.userId}
                      onChange={(checked) => update(m, { canIncurCharges: checked })}
                    />
                  </Flex>

                  <Button icon={<IdcardOutlined />} onClick={() => setShowing(m)}>
                    Hiện thẻ
                  </Button>
                </Flex>
              </Card>
            ))}
          </Flex>
        )}
      </Spin>

      <Modal open={Boolean(showing)} onCancel={() => setShowing(null)} footer={null} destroyOnHidden title="Thẻ thành viên" width={420}>
        {showing && (
          <MemberCard person={{ ...showing, apartment: data?.apartment }} />
        )}
      </Modal>
    </Flex>
  );
}

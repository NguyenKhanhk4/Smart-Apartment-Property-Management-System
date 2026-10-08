import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Alert, App, Avatar, Button, Card, Empty, Flex, Popconfirm, Segmented, Select, Spin, Tag, Typography } from 'antd';
import { ArrowLeftOutlined, UserOutlined } from '@ant-design/icons';
import { amenityPassApi, memberCodeApi } from '../../api/moduleD.api';
import EnumTag from '../../components/EnumTag';
import { AGE_GROUPS, AMENITY_ACCESS_MODES, AMENITY_PASS_STATUS } from '../../constants/enums';
import { useApi } from '../../hooks/useApi';
import { vtName } from '../../motion/viewTransition';
import { formatMoney } from '../../utils/format';

const monthLabel = (m) => `${m.slice(5)}/${m.slice(0, 4)}`; // 2026-10 → 10/2026

// UC-D09 — "Gói tháng": chủ hộ mua gói cho mình hoặc thành viên, xem gói của cả hộ, hủy gói tháng sau.
// Thành viên thường chỉ xem gói của mình.
export default function MyPassesPage() {
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const [search, setSearch] = useSearchParams();
  const { data: mine = [], loading: loadingMine } = useApi(() => memberCodeApi.mine(), []);
  const apartmentId = search.get('apartmentId') ?? mine[0]?.apartment._id;
  const me = mine.find((c) => c.apartment._id === apartmentId);
  const isHead = Boolean(me?.isHead);

  const [monthPick, setMonthPick] = useState(null); // null = tháng này (server mặc định)
  const [memberPick, setMemberPick] = useState(null);
  const options = useApi(() => amenityPassApi.options({ apartmentId, month: monthPick ?? undefined }), [apartmentId, monthPick], {
    enabled: isHead,
  });
  const list = useApi(() => amenityPassApi.mine({ apartmentId }), [apartmentId], { enabled: Boolean(me) });

  const info = options.data;
  const memberId = memberPick ?? me?.userId;
  const member = info?.members.find((m) => m.userId === memberId);
  const rows = (info?.amenities ?? []).map((a) => ({ amenity: a, option: info.options.find((o) => o.userId === memberId && o.amenityId === String(a._id)) }));

  const reloadAll = () => Promise.all([options.reload(), list.reload()]);

  const buy = ({ amenity, option }) => {
    modal.confirm({
      title: 'Xác nhận mua gói tháng',
      okText: 'Mua gói',
      cancelText: 'Hủy',
      content: (
        <Flex vertical gap={4}>
          <span>
            Gói <b>{amenity.name}</b> tháng <b>{monthLabel(info.month)}</b> cho <b>{member.fullName}</b>
          </span>
          <span>
            Giá: <b>{formatMoney(option.fee)}</b> ({AGE_GROUPS[option.ageGroup]?.label.toLowerCase()})
          </span>
          <Typography.Text type="secondary">
            Hiệu lực ngay, tính trọn tháng. Phí được cộng vào hóa đơn đầu tháng sau.
          </Typography.Text>
        </Flex>
      ),
      onOk: async () => {
        try {
          await amenityPassApi.purchase({ apartmentId, userId: memberId, amenityId: String(amenity._id), month: info.month });
          message.success('Đã mua gói tháng');
          await reloadAll();
        } catch (e) {
          message.error(e.message);
        }
      },
    });
  };

  const cancel = async (pass) => {
    try {
      await amenityPassApi.cancel(pass._id);
      message.success('Đã hủy gói tháng');
      await reloadAll();
    } catch (e) {
      message.error(e.message);
    }
  };

  return (
    <Flex vertical gap={12}>
      <Flex align="center" gap={8}>
        <Button type="text" icon={<ArrowLeftOutlined />} aria-label="Quay lại" onClick={() => navigate('/r/my-code', { viewTransition: true })} />
        <Typography.Title level={4} style={{ margin: 0, ...vtName('my-code-title') }}>
          Gói tháng
        </Typography.Title>
      </Flex>

      {mine.length > 1 && (
        <Segmented
          block
          value={apartmentId}
          onChange={(id) => {
            setSearch({ apartmentId: id });
            setMemberPick(null);
            setMonthPick(null);
          }}
          options={mine.map((c) => ({ value: c.apartment._id, label: `Căn ${c.apartment.code}` }))}
        />
      )}

      <Spin spinning={loadingMine}>
        {!loadingMine && !me && (
          <Empty description="Tài khoản chưa có quyền sử dụng tiện ích trong căn hộ nào. Liên hệ Lễ tân để được hỗ trợ." />
        )}

        {isHead && info && (
          <Card size="small" title="Mua gói tháng" loading={options.loading && !info}>
            <Flex vertical gap={12}>
              {info.overdue && (
                <Alert
                  type="warning"
                  showIcon
                  message="Căn hộ đang có hóa đơn quá hạn"
                  description="Bạn chưa thể mua gói tháng cho tới khi thanh toán hóa đơn quá hạn."
                />
              )}
              <Select
                value={memberId}
                onChange={setMemberPick}
                options={info.members.map((m) => ({
                  value: m.userId,
                  label: (
                    <Flex align="center" gap={8}>
                      <Avatar size={20} src={m.avatarUrl} icon={<UserOutlined />} />
                      {m.fullName}
                      {m.userId === me.userId && ' (tôi)'}
                    </Flex>
                  ),
                }))}
              />
              <Segmented
                block
                value={info.month}
                onChange={setMonthPick}
                options={[
                  { value: info.months[0], label: `Tháng này (${monthLabel(info.months[0])})` },
                  { value: info.months[1], label: `Tháng sau (${monthLabel(info.months[1])})` },
                ]}
              />
              {!rows.length && <Empty description="Hiện chưa có tiện ích nào bán gói tháng" />}
              {rows.map(({ amenity, option }) => (
                <Flex key={amenity._id} justify="space-between" align="center" gap={8}>
                  <Flex vertical style={{ minWidth: 0 }}>
                    <Typography.Text strong ellipsis>
                      {amenity.name}
                    </Typography.Text>
                    <Flex gap={4} align="center" wrap>
                      <EnumTag map={AMENITY_ACCESS_MODES} value={amenity.accessMode} />
                      {option?.status === 'NOT_REQUIRED' ? (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          Trẻ nhỏ được miễn phí, không cần gói
                        </Typography.Text>
                      ) : (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {formatMoney(option?.fee)} / tháng · {AGE_GROUPS[option?.ageGroup]?.label}
                        </Typography.Text>
                      )}
                    </Flex>
                  </Flex>
                  {option?.status === 'OWNED' && <Tag color="green">Đã có gói</Tag>}
                  {option?.status === 'AVAILABLE' && (
                    <Button type="primary" disabled={info.overdue} onClick={() => buy({ amenity, option })}>
                      Mua gói
                    </Button>
                  )}
                </Flex>
              ))}
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Gói tính trọn tháng dù mua giữa tháng, hiệu lực ngay và không tự gia hạn. Giá theo nhóm tuổi tại ngày 1 của tháng.
              </Typography.Text>
            </Flex>
          </Card>
        )}

        {me && (
          <Flex vertical gap={8} style={{ marginTop: isHead ? 12 : 0 }}>
            <Typography.Text strong>{isHead ? 'Gói của cả hộ' : 'Gói của tôi'}</Typography.Text>
            {!isHead && <Typography.Text type="secondary">Chủ hộ mua gói tháng cho bạn trong mục Gói tháng.</Typography.Text>}
            <Spin spinning={list.loading}>
              {list.data && !list.data.length && <Empty description="Chưa có gói tháng nào" />}
              {list.data?.map((p) => (
                <Card key={p._id} size="small" style={{ marginBottom: 8 }}>
                  <Flex justify="space-between" align="center" gap={8}>
                    <Flex gap={10} align="center" style={{ minWidth: 0 }}>
                      <Avatar src={p.member?.avatarUrl} icon={<UserOutlined />} />
                      <Flex vertical style={{ minWidth: 0 }}>
                        <Typography.Text strong ellipsis>
                          {p.amenity?.name}
                        </Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {p.member?.fullName}{p.memberCode ? ` (${p.memberCode})` : ''} · tháng {monthLabel(p.month)} · {formatMoney(p.fee)}
                        </Typography.Text>
                        <Flex gap={4} wrap>
                          <EnumTag map={AMENITY_PASS_STATUS} value={p.status} />
                          {p.isCurrent && p.status === 'ACTIVE' && <Tag color="blue">Đang dùng</Tag>}
                          {p.invoiceId && <Tag>Đã vào hóa đơn</Tag>}
                        </Flex>
                      </Flex>
                    </Flex>
                    {p.canCancel && (
                      <Popconfirm
                        title="Hủy gói tháng sau?"
                        description="Gói chưa bắt đầu nên được hủy miễn phí."
                        okText="Hủy gói"
                        cancelText="Giữ lại"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => cancel(p)}
                      >
                        <Button danger size="small">
                          Hủy
                        </Button>
                      </Popconfirm>
                    )}
                  </Flex>
                </Card>
              ))}
            </Spin>
          </Flex>
        )}
      </Spin>
    </Flex>
  );
}

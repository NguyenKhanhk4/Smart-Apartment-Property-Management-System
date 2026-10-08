import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert, Button, Empty, Flex, Segmented, Spin, Typography } from 'antd';
import { TagsOutlined, TeamOutlined } from '@ant-design/icons';
import { memberCodeApi } from '../../api/moduleD.api';
import { useApi } from '../../hooks/useApi';
import { vtName } from '../../motion/viewTransition';
import MemberCard from './MemberCard';

// UC-D11 — "Mã của tôi": thẻ thành viên (ảnh + mã chữ). Ở nhiều căn thì chọn căn.
export default function MyCodePage() {
  const navigate = useNavigate();
  const { data: cards = [], loading } = useApi(() => memberCodeApi.mine(), []);
  const [picked, setPicked] = useState(null);
  const card = useMemo(() => cards.find((c) => c.apartment._id === picked) ?? cards[0], [cards, picked]);
  const apartmentId = card?.apartment._id;

  return (
    <Flex vertical gap={12}>
      <Typography.Title level={4} style={{ margin: 0, ...vtName('my-code-title') }}>
        Mã của tôi
      </Typography.Title>

      {cards.length > 1 && (
        <Segmented
          block
          value={apartmentId}
          onChange={setPicked}
          options={cards.map((c) => ({ value: c.apartment._id, label: `Căn ${c.apartment.code}` }))}
        />
      )}

      <Spin spinning={loading}>
        {card ? (
          <Flex vertical gap={12}>
            <MemberCard key={`${apartmentId}-${card.code}`} person={card} />
            {!card.isHead && (
              <Alert
                type="info"
                showIcon
                message={card.canIncurCharges ? 'Bạn được phát sinh phí tiện ích' : 'Bạn chưa được phát sinh phí tiện ích'}
                description={
                  card.canIncurCharges
                    ? 'Phí tiện ích bạn sử dụng sẽ cộng vào hóa đơn của căn hộ.'
                    : 'Bạn vẫn dùng được tiện ích miễn phí và gói của mình. Muốn dùng tiện ích có phí, nhờ chủ hộ bật quyền trong mục Gia đình.'
                }
              />
            )}
            <Button
              block
              icon={<TagsOutlined />}
              onClick={() => navigate(`/r/my-code/passes?apartmentId=${apartmentId}`, { viewTransition: true })}
            >
              {card.isHead ? 'Gói tháng tiện ích' : 'Gói tháng của tôi'}
            </Button>
            {card.isHead && (
              <Button
                block
                icon={<TeamOutlined />}
                onClick={() => navigate(`/r/my-code/family?apartmentId=${apartmentId}`, { viewTransition: true })}
              >
                Quản lý gia đình
              </Button>
            )}
          </Flex>
        ) : (
          !loading && (
            <Empty
              description={
                <>
                  Tài khoản chưa có quyền sử dụng tiện ích trong căn hộ nào.
                  <br />
                  Nếu căn của bạn đang cho thuê, người thuê là người dùng tiện ích. Liên hệ Lễ tân để được hỗ trợ.
                </>
              }
            />
          )
        )}
      </Spin>
    </Flex>
  );
}

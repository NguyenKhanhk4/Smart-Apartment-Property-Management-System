import { Link } from 'react-router';
import { Alert, Empty, Segmented, Spin } from 'antd';
import { InfoCircleOutlined, RightOutlined } from '@ant-design/icons';
import { useResident } from '../../hooks/useResident';
import ResidentCard from './ResidentCard';

// UC-D11 — "Mã của tôi": thẻ cư dân (ảnh + mã chữ) để đọc cho lễ tân / bảo vệ. Ở nhiều căn thì chọn căn.
// Gói tháng nằm ở Tiện ích › Gói tháng; quản lý gia đình ở Căn hộ của tôi.
export default function MyCodePage() {
  const { cards, card, apartmentId, setApartmentId, loading } = useResident();

  return (
    <div className="max-w-[440px] mx-auto flex flex-col gap-4">
      <h1 className="hidden md:block m-0 text-[28px] font-semibold">Mã của tôi</h1>

      {cards.length > 1 && (
        <Segmented
          block
          value={apartmentId}
          onChange={setApartmentId}
          options={cards.map((c) => ({ value: c.apartment._id, label: `Căn ${c.apartment.code}` }))}
        />
      )}

      <Spin spinning={loading}>
        {card ? (
          <div className="flex flex-col gap-4">
            <ResidentCard key={`${apartmentId}-${card.code}`} person={card} />

            <div className="flex gap-3 px-4 py-3.5 bg-r-info-bg text-r-info-fg rounded-[14px] text-[13px] leading-normal">
              <InfoCircleOutlined style={{ fontSize: 20, marginTop: 1 }} />
              <span>Đọc mã này cho lễ tân hoặc bảo vệ khi vào tiện ích. Nhân viên sẽ đối chiếu ảnh đại diện với người đến.</span>
            </div>

            {!card.isHead && (
              <Alert
                type="info"
                showIcon
                title={card.canIncurCharges ? 'Bạn được phát sinh phí tiện ích' : 'Bạn chưa được phát sinh phí tiện ích'}
                description={
                  card.canIncurCharges
                    ? 'Phí tiện ích bạn sử dụng sẽ cộng vào hóa đơn của căn hộ.'
                    : 'Bạn vẫn dùng được tiện ích miễn phí và gói của mình. Muốn dùng tiện ích có phí, nhờ chủ hộ bật quyền trong mục Căn hộ và gia đình.'
                }
              />
            )}

            <Link
              to="/r/profile"
              viewTransition
              className="flex items-center justify-between px-4 py-3.5 bg-white border border-r-border rounded-[14px] text-r-text! text-[15px] no-underline"
            >
              <span>Cập nhật ảnh đại diện</span>
              <RightOutlined style={{ fontSize: 14, color: '#8A8F99' }} />
            </Link>
          </div>
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
    </div>
  );
}

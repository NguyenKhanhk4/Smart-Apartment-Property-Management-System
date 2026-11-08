import { Flex, Modal, Typography } from 'antd';
import { QRCodeSVG } from 'qrcode.react';
import { formatDate } from '../../utils/format';

// Vé QR đặt tiện ích (Người 4): cư dân đưa mã cho Lễ tân / Bảo vệ quét để check-in
export default function BookingTicketModal({ booking, onClose }) {
  return (
    <Modal title="Vé đặt tiện ích" open={Boolean(booking)} onCancel={onClose} footer={null} destroyOnHidden width={360} centered>
      {booking && (
        <Flex vertical align="center" gap={12}>
          <div className="rounded-xl bg-white p-3">
            <QRCodeSVG value={booking.qrToken} size={232} level="M" marginSize={1} />
          </div>
          <Typography.Text strong className="text-base">
            {booking.amenity?.name ?? 'Tiện ích'}
          </Typography.Text>
          <Typography.Text>
            {formatDate(booking.startAt ?? booking.date)} · {booking.slotStart}–{booking.slotEnd}
          </Typography.Text>
          <Typography.Text type="secondary" className="text-center text-[13px]">
            Đưa mã này cho Lễ tân hoặc Bảo vệ quét khi đến (từ 15 phút trước giờ bắt đầu). Tăng độ sáng màn hình nếu quét chậm.
          </Typography.Text>
        </Flex>
      )}
    </Modal>
  );
}

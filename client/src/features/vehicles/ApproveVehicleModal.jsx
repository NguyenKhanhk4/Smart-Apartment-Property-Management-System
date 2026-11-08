import { Modal } from 'antd';
import { vehicleApi } from '../../api/moduleA.api';
import { useAction } from '../../hooks/useApi';

export default function ApproveVehicleModal({ vehicle, open, onClose, onDone }) {
  const [approve, approving] = useAction(() => vehicleApi.approve(vehicle._id), {
    success: 'Đã duyệt đăng ký xe',
    onDone: () => {
      onClose();
      onDone?.();
    },
  });

  return (
    <Modal
      title={`Duyệt phương tiện: ${vehicle?.plateNumber || vehicle?.type || ''}`}
      open={open}
      onCancel={onClose}
      onOk={() => approve().catch(() => {})}
      confirmLoading={approving}
      okText="Xác nhận duyệt"
      cancelText="Hủy"
    >
      <p>Xe được bổ sung quyền gửi xe trên thẻ cư dân của người đăng ký.</p>
    </Modal>
  );
}

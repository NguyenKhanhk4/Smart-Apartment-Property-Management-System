import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Flex, Modal, Spin, Typography } from 'antd';
import { CameraOutlined, SwapOutlined } from '@ant-design/icons';

const CAMERA_ERRORS = {
  NotAllowedError: 'Bạn chưa cho phép trình duyệt dùng camera. Bấm biểu tượng ổ khóa trên thanh địa chỉ để cấp quyền rồi thử lại.',
  NotFoundError: 'Không tìm thấy camera trên thiết bị này. Hãy dùng "Tải ảnh từ máy".',
  NotReadableError: 'Camera đang được ứng dụng khác sử dụng.',
};
const UNSUPPORTED = 'Trình duyệt không hỗ trợ mở camera (cần HTTPS hoặc localhost). Hãy dùng "Tải ảnh từ máy".';

// Thân modal — chỉ mount khi modal mở (destroyOnHidden) nên mỗi lần mở là trạng thái mới, camera tắt khi đóng
function CameraView({ onClose, onCapture, remaining }) {
  const videoRef = useRef(null);
  const [facingMode, setFacingMode] = useState('environment');
  const [state, setState] = useState(() =>
    navigator.mediaDevices?.getUserMedia ? { loading: true, error: null } : { loading: false, error: UNSUPPORTED },
  );
  // Camera trước / webcam: xem trước dạng gương (giơ tay phải thấy ở bên phải) như ứng dụng camera thông thường
  const [mirrored, setMirrored] = useState(false);
  const [flash, setFlash] = useState(false);
  const [taken, setTaken] = useState(0);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) return undefined;
    let stream = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        stream = s;
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        if (videoRef.current) videoRef.current.srcObject = s;
        // Webcam laptop thường không khai báo facingMode → coi như camera trước
        setMirrored(s.getVideoTracks()[0]?.getSettings().facingMode !== 'environment');
        setState({ loading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: CAMERA_ERRORS[err.name] ?? `Không mở được camera: ${err.message}` });
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [facingMode]);

  const switchCamera = () => {
    setState({ loading: true, error: null });
    setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'));
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    // Ảnh lưu giống hệt khung xem trước (camera trước cũng lật gương) để người chụp thấy đúng như đã ngắm
    const ctx = canvas.getContext('2d');
    if (mirrored) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture(new File([blob], `anh-chup-${Date.now()}.jpg`, { type: 'image/jpeg' }));
        setTaken((n) => n + 1);
        setFlash(true);
        setTimeout(() => setFlash(false), 150);
        if (remaining <= 1) onClose(); // vừa chụp ảnh cuối cùng được phép
      },
      'image/jpeg',
      0.85,
    );
  };

  return (
    <Flex vertical gap={12}>
      {state.error ? (
        <Alert type="warning" showIcon message={state.error} />
      ) : (
        <Spin spinning={state.loading}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: '100%',
              maxHeight: '60vh',
              background: 'black',
              borderRadius: 8,
              opacity: flash ? 0.3 : 1,
              transform: mirrored ? 'scaleX(-1)' : undefined,
              transition: 'opacity 150ms',
            }}
          />
        </Spin>
      )}
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Typography.Text type="secondary">
          {taken > 0 ? `Đã chụp ${taken} ảnh · ` : ''}còn chụp được {remaining} ảnh
        </Typography.Text>
        <Flex gap={8}>
          <Button icon={<SwapOutlined />} disabled={!!state.error} onClick={switchCamera}>
            Đổi camera
          </Button>
          <Button onClick={onClose}>Xong</Button>
          <Button
            type="primary"
            icon={<CameraOutlined />}
            disabled={state.loading || !!state.error || remaining <= 0}
            onClick={capture}
          >
            Chụp
          </Button>
        </Flex>
      </Flex>
    </Flex>
  );
}

/**
 * Chụp ảnh trực tiếp bằng camera (webcam máy tính / camera sau điện thoại) qua getUserMedia.
 * Mỗi lần bấm "Chụp" tạo 1 File jpg và gọi onCapture(file); modal giữ mở để chụp tiếp tới khi hết `remaining`.
 * Trình duyệt chỉ cho mở camera trên HTTPS hoặc localhost.
 */
export default function CameraCaptureModal({ open, onClose, onCapture, remaining }) {
  return (
    <Modal title="Chụp ảnh kết quả" open={open} onCancel={onClose} footer={null} width={720} destroyOnHidden>
      <CameraView onClose={onClose} onCapture={onCapture} remaining={remaining} />
    </Modal>
  );
}

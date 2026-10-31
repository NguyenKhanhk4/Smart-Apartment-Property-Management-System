import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Button, Flex, Input, Modal, Spin, Typography } from 'antd';
import jsQR from 'jsqr';

const CAMERA_ERRORS = {
  NotAllowedError: 'Bạn chưa cho phép trình duyệt dùng camera. Bấm biểu tượng ổ khóa trên thanh địa chỉ để cấp quyền rồi thử lại.',
  NotFoundError: 'Không tìm thấy camera trên thiết bị này. Hãy nhập mã bên dưới.',
  NotReadableError: 'Camera đang được ứng dụng khác sử dụng.',
};
const UNSUPPORTED = 'Trình duyệt không mở được camera (cần HTTPS hoặc localhost). Hãy nhập mã bên dưới.';
const SCAN_EVERY_MS = 250;

// Thân modal — chỉ mount khi mở (destroyOnHidden) nên camera tắt ngay khi đóng
function Scanner({ onResult, busy }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const doneRef = useRef(false);
  // Giữ hàm mới nhất trong ref để effect camera chỉ chạy 1 lần (không tắt / bật camera mỗi lần render)
  const onResultRef = useRef(onResult);
  useLayoutEffect(() => {
    onResultRef.current = onResult;
  });
  const [state, setState] = useState(() =>
    navigator.mediaDevices?.getUserMedia ? { loading: true, error: null } : { loading: false, error: UNSUPPORTED },
  );
  const [manual, setManual] = useState('');

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) return undefined;
    let stream = null;
    let timer = null;
    let cancelled = false;

    const scan = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2 || doneRef.current) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
      if (code?.data) {
        doneRef.current = true;
        onResultRef.current(code.data);
      }
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        stream = s;
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        if (videoRef.current) videoRef.current.srcObject = s;
        setState({ loading: false, error: null });
        timer = setInterval(scan, SCAN_EVERY_MS);
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: CAMERA_ERRORS[err.name] ?? `Không mở được camera: ${err.message}` });
      });
    return () => {
      cancelled = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Kết quả lỗi (mã sai, ngoài giờ...) → cho quét tiếp
  useEffect(() => {
    if (!busy) doneRef.current = false;
  }, [busy]);

  return (
    <Flex vertical gap={12}>
      {state.error ? (
        <Alert type="warning" showIcon title={state.error} />
      ) : (
        <Spin spinning={state.loading || busy}>
          <div className="relative w-full overflow-hidden rounded-lg bg-black aspect-square">
            <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
            <div className="pointer-events-none absolute inset-[18%] rounded-xl border-2 border-white/80" />
          </div>
        </Spin>
      )}
      <canvas ref={canvasRef} hidden />
      <Typography.Text type="secondary">Đưa mã QR trên điện thoại cư dân vào khung. Không quét được thì nhập mã:</Typography.Text>
      <Flex gap={8}>
        <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="BK1...." onPressEnter={() => manual.trim() && onResult(manual.trim())} />
        <Button type="primary" disabled={!manual.trim()} loading={busy} onClick={() => onResult(manual.trim())}>
          Xác nhận
        </Button>
      </Flex>
    </Flex>
  );
}

/** Modal quét mã QR bằng camera sau của điện thoại (jsQR, chạy cả iOS Safari). `onResult(text)` có thể trả Promise */
export default function QrScanModal({ open, title = 'Quét mã QR', onClose, onResult }) {
  const [busy, setBusy] = useState(false);
  const handle = async (text) => {
    setBusy(true);
    try {
      await onResult(text);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={title} open={open} onCancel={onClose} footer={null} destroyOnHidden width={420}>
      <Scanner onResult={handle} busy={busy} />
    </Modal>
  );
}

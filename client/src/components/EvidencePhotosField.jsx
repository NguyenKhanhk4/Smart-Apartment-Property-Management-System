import { useLayoutEffect, useRef, useState } from 'react';
import { App, Button, Flex, Form, Upload } from 'antd';
import { CameraOutlined, UploadOutlined } from '@ant-design/icons';
import CameraCaptureModal from './CameraCaptureModal';

const MAX_SIZE = 5 * 1024 * 1024;
const MAX_COUNT = 5;

let seq = 0;
const toItem = (file) => ({
  uid: `evidence-${Date.now()}-${(seq += 1)}`,
  name: file.name,
  status: 'done',
  originFileObj: file,
  thumbUrl: URL.createObjectURL(file),
});

/** Danh sách ảnh + 2 nút tách riêng: "Chụp ảnh" (camera) và "Tải ảnh từ máy" (chọn file). value = fileList antd. */
function PhotoPicker({ value = [], onChange }) {
  const { message } = App.useApp();
  const [cameraOpen, setCameraOpen] = useState(false);
  // Chọn nhiều file 1 lần → beforeUpload gọi liên tiếp; giữ bản mới nhất để không mất ảnh
  const latest = useRef(value);
  useLayoutEffect(() => {
    latest.current = value;
  });
  const remaining = MAX_COUNT - value.length;

  const add = (file) => {
    if (latest.current.length >= MAX_COUNT) {
      message.warning(`Tối đa ${MAX_COUNT} ảnh`);
      return;
    }
    latest.current = [...latest.current, toItem(file)];
    onChange?.(latest.current);
  };

  const beforeUpload = (file) => {
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > MAX_SIZE) {
      message.error(`"${file.name}" không hợp lệ — chỉ nhận ảnh jpg/png tối đa 5MB.`);
    } else {
      add(file);
    }
    return Upload.LIST_IGNORE; // tự quản lý danh sách, không để Upload thêm lần nữa
  };

  return (
    <Flex vertical gap={8}>
      {value.length > 0 && (
        <Upload
          listType="picture-card"
          fileList={value}
          openFileDialogOnClick={false}
          showUploadList={{ showPreviewIcon: false }}
          onRemove={(f) => onChange?.(value.filter((x) => x.uid !== f.uid))}
        />
      )}
      <Flex gap={8} wrap>
        <Button icon={<CameraOutlined />} disabled={remaining <= 0} onClick={() => setCameraOpen(true)}>
          Chụp ảnh
        </Button>
        <Upload accept="image/jpeg,image/png" multiple showUploadList={false} beforeUpload={beforeUpload} disabled={remaining <= 0}>
          <Button icon={<UploadOutlined />} disabled={remaining <= 0}>
            Tải ảnh từ máy
          </Button>
        </Upload>
      </Flex>
      <CameraCaptureModal open={cameraOpen} remaining={remaining} onClose={() => setCameraOpen(false)} onCapture={add} />
    </Flex>
  );
}

/**
 * Ô "Ảnh kết quả" trong Form: chụp bằng camera hoặc tải ảnh có sẵn, jpg/png ≤ 5MB, tối đa 5 ảnh.
 * Giá trị field là fileList của antd; gửi lên server bằng toFiles(values.images) ở utils/upload.js.
 * @example <EvidencePhotosField name="images" label="Ảnh kết quả" />
 */
export default function EvidencePhotosField({ name = 'images', label = 'Ảnh kết quả', required = true, extra }) {
  return (
    <Form.Item
      name={name}
      label={label}
      rules={required ? [{ required: true, type: 'array', min: 1, message: 'Chụp hoặc tải lên ít nhất 1 ảnh kết quả' }] : []}
      extra={extra ?? `jpg/png, tối đa 5MB mỗi ảnh, tối đa ${MAX_COUNT} ảnh.`}
    >
      <PhotoPicker />
    </Form.Item>
  );
}

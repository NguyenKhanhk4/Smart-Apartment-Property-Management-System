import { useCallback } from 'react';
import { App, Upload } from 'antd';
import { checkImageFile } from '../utils/imageUpload';

/**
 * UC63: beforeUpload dùng chung cho ô chọn ảnh (antd Upload, chế độ gửi cùng form).
 * File không phải ảnh / quá lớn → báo lỗi có tên file và không thêm vào danh sách. Ảnh hợp lệ giữ lại để gửi cùng form;
 * lúc gửi, axiosClient tự chuyển sang JPEG và thu nhỏ (utils/imageUpload.js).
 * @example const checkPhoto = useImageCheck(); <Upload accept={IMAGE_ACCEPT} beforeUpload={checkPhoto} ... />
 */
export function useImageCheck() {
  const { message } = App.useApp();
  return useCallback(
    (file) => {
      const error = checkImageFile(file);
      if (error) {
        message.error(error);
        return Upload.LIST_IGNORE;
      }
      return false;
    },
    [message],
  );
}

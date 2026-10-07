import { Flex, Image } from 'antd';

/** Dãy ảnh bằng chứng, bấm để phóng to / lướt qua lại */
export default function EvidencePhotos({ urls = [], size = 96 }) {
  if (!urls?.length) return null;
  return (
    <Image.PreviewGroup>
      <Flex gap={8} wrap>
        {urls.map((url) => (
          <Image key={url} src={url} width={size} height={size} style={{ objectFit: 'cover', borderRadius: 8 }} />
        ))}
      </Flex>
    </Image.PreviewGroup>
  );
}

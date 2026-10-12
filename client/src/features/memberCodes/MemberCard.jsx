import { Avatar, Card, Flex, Tag, Typography } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import EnumTag from '../../components/EnumTag';
import { AGE_GROUPS, RELATION_TYPES } from '../../constants/enums';

/**
 * Thẻ thành viên: ảnh đại diện, tên, mã chữ to để đọc cho Lễ tân / Bảo vệ.
 *   person: { fullName, avatarUrl, code, relationType, isHead, ageGroup?, apartment? }
 */
export default function MemberCard({ person }) {
  return (
    <Card>
      <Flex vertical align="center" gap={12} style={{ textAlign: 'center' }}>
        <Avatar size={96} src={person.avatarUrl} icon={<UserOutlined />} />
        <Flex vertical gap={4} align="center">
          <Typography.Title level={4} style={{ margin: 0 }}>
            {person.fullName}
          </Typography.Title>
          <Flex gap={4} wrap justify="center">
            {person.isHead ? <Tag color="gold">Chủ hộ</Tag> : <EnumTag map={RELATION_TYPES} value={person.relationType} />}
            {person.ageGroup && person.ageGroup !== 'ADULT' && <EnumTag map={AGE_GROUPS} value={person.ageGroup} />}
          </Flex>
          {person.apartment && (
            <Typography.Text type="secondary">
              Căn {person.apartment.code} · {person.apartment.building?.name}
            </Typography.Text>
          )}
        </Flex>

        <Typography.Text strong copyable style={{ fontSize: 36, letterSpacing: 2, fontFamily: 'monospace' }}>
          {person.code}
        </Typography.Text>

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Đọc mã này cho Lễ tân / Bảo vệ khi vào tiện ích. Nhân viên sẽ đối chiếu ảnh đại diện với người đến.
        </Typography.Text>
      </Flex>
    </Card>
  );
}

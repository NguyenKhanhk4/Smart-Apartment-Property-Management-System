import { Tag } from 'antd';

// <EnumTag map={TICKET_STATUS} value="NEW" /> — hiển thị nhãn + màu từ constants/enums.js
export default function EnumTag({ map, value }) {
  if (!value) return null;
  const item = map[value];
  return <Tag color={item?.color}>{item?.label ?? value}</Tag>;
}

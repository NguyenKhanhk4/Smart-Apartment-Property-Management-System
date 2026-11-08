import { Alert, Descriptions, Form, Input, InputNumber, Modal, Radio, Space, Timeline, Typography } from 'antd';
import { workOrderApi } from '../../api/equipment.api';
import EnumTag from '../../components/EnumTag';
import EvidencePhotos from '../../components/EvidencePhotos';
import EvidencePhotosField from '../../components/EvidencePhotosField';
import { REPAIR_COST_SOURCES } from '../../constants/enums';
import { useAction } from '../../hooks/useApi';
import { formatDateTime, formatMoney, moneyInputProps } from '../../utils/format';
import { toFiles } from '../../utils/upload';

const assetText = (wo) => (wo.assetId?.code ? `${wo.assetId.code} – ${wo.assetId.name}` : wo.title);

const HISTORY_LABEL = {
  REPORTED: 'Báo cáo hư hỏng',
  APPROVED: 'Duyệt sửa chữa',
  ACCEPTANCE_UPLOADED: 'Tải biên bản nghiệm thu',
  ACCEPTED: 'Nghiệm thu',
  RETURNED: 'Yêu cầu sửa lại',
};

/** Thông tin báo cáo hư hỏng + quyết định + lịch sử các bước (dùng ở modal duyệt, nghiệm thu, xem kết quả) */
export function RepairInfo({ workOrder, showHistory = true }) {
  const r = workOrder.repair;
  if (!r) return null;
  return (
    <>
      <Descriptions column={1} size="small" bordered style={{ marginBottom: 12 }}>
        <Descriptions.Item label="Mô tả hư hỏng"><span style={{ whiteSpace: 'pre-wrap' }}>{r.faultDesc}</span></Descriptions.Item>
        <Descriptions.Item label="Nhà thầu đề xuất">{r.vendorName || '—'}</Descriptions.Item>
        <Descriptions.Item label="Phương án sửa"><span style={{ whiteSpace: 'pre-wrap' }}>{r.vendorProposal}</span></Descriptions.Item>
        <Descriptions.Item label="Chi phí dự kiến">{formatMoney(r.estimatedCost)}</Descriptions.Item>
        <Descriptions.Item label="Ảnh hư hỏng">{r.faultImages?.length ? <EvidencePhotos urls={r.faultImages} /> : '—'}</Descriptions.Item>
        {r.costSource && (
          <Descriptions.Item label="Nguồn chi phí">
            <EnumTag map={REPAIR_COST_SOURCES} value={r.costSource} />
            {r.decisionNote ? ` ${r.decisionNote}` : ''}
          </Descriptions.Item>
        )}
        {r.acceptanceImages?.length > 0 && (
          <Descriptions.Item label="Biên bản nghiệm thu">
            <Space orientation="vertical">
              <EvidencePhotos urls={r.acceptanceImages} />
              {r.acceptanceNote && <Typography.Text>{r.acceptanceNote}</Typography.Text>}
            </Space>
          </Descriptions.Item>
        )}
      </Descriptions>
      {showHistory && r.history?.length > 0 && (
        <Timeline
          items={r.history.map((h) => ({
            color: h.action === 'RETURNED' ? 'red' : h.action === 'ACCEPTED' ? 'green' : 'blue',
            content: (
              <>
                <Typography.Text strong>{HISTORY_LABEL[h.action] ?? h.action}</Typography.Text>
                <Typography.Text type="secondary"> · {formatDateTime(h.at)}</Typography.Text>
                {h.note && <div style={{ whiteSpace: 'pre-wrap' }}>{h.note}</div>}
                {h.action === 'ACCEPTANCE_UPLOADED' && h.images?.length > 0 && <EvidencePhotos urls={h.images} />}
              </>
            ),
          }))}
        />
      )}
    </>
  );
}

const done = (onClose, onDone) => () => {
  onClose();
  onDone?.();
};

// ===== UC09 bước 1–3 (KTV): báo cáo hư hỏng sau khi kiểm tra Có sự cố =====
export function FaultReportModal({ workOrder, open, onClose, onDone }) {
  const [form] = Form.useForm();
  const [save, saving] = useAction(
    (v) => workOrderApi.reportFault(
      workOrder._id,
      { faultDesc: v.faultDesc.trim(), vendorName: v.vendorName?.trim(), vendorProposal: v.vendorProposal.trim(), estimatedCost: v.estimatedCost },
      toFiles(v.images),
    ),
    { success: (res) => res.message, onDone: done(onClose, onDone) },
  );
  return (
    <Modal title="Báo cáo hư hỏng" open={open} onCancel={onClose} onOk={() => form.submit()} okText="Gửi Trưởng BQL" cancelText="Để sau" confirmLoading={saving} destroyOnHidden width={640}>
      <Typography.Paragraph type="secondary">
        {assetText(workOrder)}. Báo cáo gửi Trưởng BQL duyệt sửa chữa; Trưởng BQL tự liên hệ nhà thầu.
      </Typography.Paragraph>
      <Form form={form} layout="vertical" initialValues={{ faultDesc: workOrder.note ?? '' }} onFinish={(v) => save(v).catch(() => {})}>
        <Form.Item name="faultDesc" label="Mô tả hư hỏng" rules={[{ required: true, whitespace: true, min: 10, message: 'Mô tả tối thiểu 10 ký tự' }]}>
          <Input.TextArea rows={3} maxLength={2000} showCount />
        </Form.Item>
        <Form.Item name="vendorName" label="Nhà thầu đề xuất">
          <Input maxLength={150} placeholder="Tên đơn vị sửa chữa (nếu có)" />
        </Form.Item>
        <Form.Item name="vendorProposal" label="Phương án sửa chữa" rules={[{ required: true, whitespace: true, min: 5, message: 'Nhập phương án sửa' }]}>
          <Input.TextArea rows={2} maxLength={2000} showCount placeholder="Thay thế / sửa gì, vật tư cần dùng…" />
        </Form.Item>
        <Form.Item name="estimatedCost" label="Chi phí dự kiến (VNĐ)" rules={[{ required: true, message: 'Nhập chi phí dự kiến' }]}>
          <InputNumber min={1} max={1e12} precision={0} style={{ width: '100%' }} {...moneyInputProps} addonAfter="đ" />
        </Form.Item>
        <EvidencePhotosField name="images" label="Ảnh hư hỏng" />
      </Form>
    </Modal>
  );
}

// ===== UC09 bước 4–6 (KTV): tải biên bản nghiệm thu của nhà thầu =====
export function AcceptanceUploadModal({ workOrder, open, onClose, onDone }) {
  const [form] = Form.useForm();
  const [save, saving] = useAction((v) => workOrderApi.uploadAcceptance(workOrder._id, v.note?.trim(), toFiles(v.images)), {
    success: (res) => res.message,
    onDone: done(onClose, onDone),
  });
  const returned = workOrder.repair?.history?.filter((h) => h.action === 'RETURNED').at(-1);
  return (
    <Modal title="Tải biên bản nghiệm thu" open={open} onCancel={onClose} onOk={() => form.submit()} okText="Gửi nghiệm thu" cancelText="Đóng" confirmLoading={saving} destroyOnHidden width={600}>
      <Typography.Paragraph type="secondary">{assetText(workOrder)}. Chụp hoặc quét biên bản nghiệm thu có chữ ký của nhà thầu.</Typography.Paragraph>
      {returned && <Alert type="warning" showIcon style={{ marginBottom: 12 }} title="Trưởng BQL đã yêu cầu sửa lại" description={returned.note} />}
      <Form form={form} layout="vertical" onFinish={(v) => save(v).catch(() => {})}>
        <EvidencePhotosField name="images" label="Ảnh biên bản nghiệm thu" />
        <Form.Item name="note" label="Ghi chú">
          <Input.TextArea rows={2} maxLength={1000} showCount placeholder="Nhà thầu đã làm gì, tình trạng sau sửa…" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ===== UC10 (tối thiểu): Trưởng BQL duyệt sửa chữa =====
export function RepairApprovalModal({ workOrder, open, onClose, onDone }) {
  const [form] = Form.useForm();
  const [save, saving] = useAction((v) => workOrderApi.approveRepair(workOrder._id, { costSource: v.costSource, note: v.note?.trim() ?? '' }), {
    success: (res) => res.message,
    onDone: done(onClose, onDone),
  });
  return (
    <Modal title={`Duyệt sửa chữa: ${assetText(workOrder)}`} open={open} onCancel={onClose} onOk={() => form.submit()} okText="Duyệt sửa" cancelText="Đóng" confirmLoading={saving} destroyOnHidden width={680}>
      <RepairInfo workOrder={workOrder} showHistory={false} />
      <Form form={form} layout="vertical" initialValues={{ costSource: 'OPERATING' }} onFinish={(v) => save(v).catch(() => {})}>
        <Form.Item name="costSource" label="Nguồn chi phí" extra="Nguồn quỹ bảo trì (cần Ban quản trị duyệt đề xuất chi) và Tạm hoãn sẽ có ở UC10.">
          <Radio.Group options={[{ value: 'OPERATING', label: 'Chi phí vận hành' }, { value: 'FUND', label: 'Quỹ bảo trì (chưa hỗ trợ)', disabled: true }]} />
        </Form.Item>
        <Form.Item name="note" label="Ghi chú cho kỹ thuật viên">
          <Input.TextArea rows={2} maxLength={1000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ===== Q12: Trưởng BQL nghiệm thu hoặc yêu cầu sửa lại =====
export function AcceptanceReviewModal({ workOrder, open, onClose, onDone }) {
  const [form] = Form.useForm();
  const decision = Form.useWatch('decision', form) ?? 'ACCEPT';
  const [save, saving] = useAction(
    (v) => (v.decision === 'ACCEPT' ? workOrderApi.acceptRepair(workOrder._id) : workOrderApi.returnRepair(workOrder._id, v.comment.trim())),
    { success: (res) => res.message, onDone: done(onClose, onDone) },
  );
  return (
    <Modal
      title={`Nghiệm thu sửa chữa: ${assetText(workOrder)}`}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText={decision === 'ACCEPT' ? 'Xác nhận nghiệm thu' : 'Yêu cầu sửa lại'}
      okButtonProps={{ danger: decision !== 'ACCEPT' }}
      cancelText="Đóng"
      confirmLoading={saving}
      destroyOnHidden
      width={720}
    >
      <RepairInfo workOrder={workOrder} />
      <Form form={form} layout="vertical" initialValues={{ decision: 'ACCEPT' }} onFinish={(v) => save(v).catch(() => {})}>
        <Form.Item name="decision" label="Quyết định">
          <Radio.Group optionType="button" buttonStyle="solid" options={[{ value: 'ACCEPT', label: 'Nghiệm thu' }, { value: 'RETURN', label: 'Yêu cầu sửa lại' }]} />
        </Form.Item>
        {decision === 'RETURN' && (
          <Form.Item name="comment" label="Lý do" rules={[{ required: true, whitespace: true, min: 5, message: 'Nhập lý do tối thiểu 5 ký tự' }]}>
            <Input.TextArea rows={3} maxLength={1000} showCount placeholder="Chưa đạt ở điểm nào, cần nhà thầu làm lại gì…" />
          </Form.Item>
        )}
        {decision === 'ACCEPT' && (
          <Alert type="info" showIcon title="Phiếu hoàn thành, thiết bị hoạt động lại; lịch bảo trì tiếp theo dời nếu đã đến hạn." />
        )}
      </Form>
    </Modal>
  );
}

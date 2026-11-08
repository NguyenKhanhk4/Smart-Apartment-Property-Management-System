import dayjs from 'dayjs';
import { Alert, DatePicker, Descriptions, Flex, Form, Input, InputNumber, Modal, Radio, Space, Tag, Timeline, Typography } from 'antd';
import { assetApi, workOrderApi } from '../../api/equipment.api';
import EnumTag from '../../components/EnumTag';
import EvidencePhotos from '../../components/EvidencePhotos';
import EvidencePhotosField from '../../components/EvidencePhotosField';
import { REPAIR_COST_SOURCES } from '../../constants/enums';
import { useAction, useApi } from '../../hooks/useApi';
import { formatDate, formatDateTime, formatMoney, moneyInputProps } from '../../utils/format';
import { toFiles } from '../../utils/upload';
import { historyOutcome } from '../assets/assetFormat';

const assetText = (wo) => (wo.assetId?.code ? `${wo.assetId.code} – ${wo.assetId.name}` : wo.title);

const HISTORY_LABEL = {
  REPORTED: 'Báo cáo hư hỏng',
  APPROVED: 'Duyệt sửa chữa (chi phí vận hành)',
  FUND_REQUESTED: 'Duyệt bằng Quỹ bảo trì, chờ đề xuất chi',
  FUND_APPROVED: 'Ban quản trị duyệt chi quỹ',
  FUND_REJECTED: 'Ban quản trị từ chối chi quỹ',
  FUND_CANCELLED: 'Kế toán rút đề xuất chi quỹ',
  POSTPONED: 'Tạm hoãn',
  REQUESTED: 'Gửi yêu cầu sửa lại',
  FOLLOWUP_CHECK: 'Kiểm tra định kỳ',
  RETIRED: 'Ngừng sử dụng thiết bị',
  ACCEPTANCE_UPLOADED: 'Tải biên bản nghiệm thu',
  ACCEPTED: 'Nghiệm thu',
  RETURNED: 'Yêu cầu sửa lại (nghiệm thu)',
};
const HISTORY_COLOR = { RETURNED: 'red', RETIRED: 'red', FUND_REJECTED: 'red', ACCEPTED: 'green', FUND_APPROVED: 'green', POSTPONED: 'purple', FOLLOWUP_CHECK: 'gray' };
const SHOW_IMAGES = new Set(['ACCEPTANCE_UPLOADED', 'REQUESTED', 'FOLLOWUP_CHECK']);

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
            {r.costSource === 'FUND' && workOrder.status === 'AWAITING_REPAIR_APPROVAL' && (
              <Typography.Text type="secondary"> Chờ Ban quản trị duyệt đề xuất chi</Typography.Text>
            )}
          </Descriptions.Item>
        )}
        {workOrder.status === 'REPAIR_POSTPONED' && (
          <Descriptions.Item label="Tạm hoãn đến">
            {formatDate(r.reviewDate)}
            {r.remindCount > 0 && <Typography.Text type="secondary"> · đã nhắc {r.remindCount} lần</Typography.Text>}
          </Descriptions.Item>
        )}
        {(r.costSource || ['REPAIR_POSTPONED', 'CLOSED'].includes(workOrder.status)) && r.decisionNote && (
          <Descriptions.Item label={r.costSource ? 'Ghi chú duyệt' : 'Lý do'}><span style={{ whiteSpace: 'pre-wrap' }}>{r.decisionNote}</span></Descriptions.Item>
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
            color: HISTORY_COLOR[h.action] ?? 'blue',
            content: (
              <>
                <Typography.Text strong>{HISTORY_LABEL[h.action] ?? h.action}</Typography.Text>
                {h.action === 'POSTPONED' && h.reviewDate && <Typography.Text> đến {formatDate(h.reviewDate)}</Typography.Text>}
                <Typography.Text type="secondary"> · {formatDateTime(h.at)}</Typography.Text>
                {h.note && <div style={{ whiteSpace: 'pre-wrap' }}>{h.note}</div>}
                {h.cost != null && h.action === 'REQUESTED' && <div>Chi phí dự kiến mới: {formatMoney(h.cost)}</div>}
                {SHOW_IMAGES.has(h.action) && h.images?.length > 0 && <EvidencePhotos urls={h.images} />}
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
        <EvidencePhotosField name="images" label="Ảnh hư hỏng" message="Chụp hoặc tải lên ít nhất 1 ảnh hư hỏng" />
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
        <EvidencePhotosField name="images" label="Ảnh biên bản nghiệm thu" message="Chụp hoặc tải lên ít nhất 1 ảnh biên bản nghiệm thu" />
        <Form.Item name="note" label="Ghi chú">
          <Input.TextArea rows={2} maxLength={1000} showCount placeholder="Nhà thầu đã làm gì, tình trạng sau sửa…" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ===== UC10: Trưởng BQL quyết định — duyệt (vận hành / Quỹ), tạm hoãn, ngừng sử dụng =====
const DECISION_OPTIONS = [
  { value: 'APPROVE', label: 'Duyệt sửa' },
  { value: 'POSTPONE', label: 'Tạm hoãn' },
  { value: 'RETIRE', label: 'Ngừng sử dụng' },
];
const OK_TEXT = { APPROVE: 'Duyệt sửa', POSTPONE: 'Tạm hoãn', RETIRE: 'Ngừng sử dụng thiết bị' };
const POSTPONE_PRESETS = [
  { label: '2 tuần', value: 14 },
  { label: '1 tháng', value: 30 },
  { label: '3 tháng', value: 90 },
];

/** 5 lần bảo trì gần nhất của thiết bị (UC10 bước 2: xem lịch sử thiết bị) */
function RecentMaintenance({ assetId }) {
  const history = useApi(() => assetApi.history(assetId, { page: 1, limit: 5 }), [assetId], { enabled: Boolean(assetId) });
  const items = history.data ?? [];
  return (
    <Descriptions column={1} size="small" bordered style={{ marginBottom: 12 }}>
      <Descriptions.Item label="Bảo trì gần đây">
        {history.loading && !items.length ? 'Đang tải…' : items.length ? (
          <Flex vertical gap={2}>
            {items.map((w) => {
              const o = historyOutcome(w);
              return (
                <span key={w._id}>
                  {formatDate(w.completedAt)} <Tag color={o.color}>{o.label}</Tag>
                  <Typography.Text type="secondary">{w.note ? w.note.slice(0, 80) : ''}</Typography.Text>
                </span>
              );
            })}
            {history.pagination?.total > items.length && <Typography.Text type="secondary">… tổng {history.pagination.total} lần</Typography.Text>}
          </Flex>
        ) : 'Chưa có'}
      </Descriptions.Item>
    </Descriptions>
  );
}

/**
 * `only`: chỉ cho 1 quyết định (vd 'RETIRE' cho phiếu đang tạm hoãn). `settings.postponeMaxDays`: giới hạn ngày xem lại.
 */
export function RepairDecisionModal({ workOrder, open, onClose, onDone, only, settings }) {
  const [form] = Form.useForm();
  const maxDays = settings?.postponeMaxDays ?? 90;
  const picked = Form.useWatch('decision', form) ?? only ?? 'APPROVE';
  const costSource = Form.useWatch('costSource', form);
  const [save, saving] = useAction(
    (v) => workOrderApi.repairDecision(workOrder._id, {
      decision: v.decision,
      ...(v.decision === 'APPROVE' && { costSource: v.costSource }),
      comment: v.comment?.trim() ?? '',
      ...(v.decision === 'POSTPONE' && { reviewDate: v.reviewDate.format('YYYY-MM-DD') }),
    }),
    { success: (res) => res.message, onDone: done(onClose, onDone) },
  );
  const today = dayjs().startOf('day');
  const awaitingFund = workOrder.repair?.costSource === 'FUND' && workOrder.status === 'AWAITING_REPAIR_APPROVAL';
  const assetId = workOrder.assetId?._id ?? workOrder.assetId;
  return (
    <Modal
      title={`${only === 'RETIRE' ? 'Ngừng sử dụng' : 'Quyết định sửa chữa'}: ${assetText(workOrder)}`}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText={OK_TEXT[picked]}
      okButtonProps={{ danger: picked === 'RETIRE' }}
      cancelText="Đóng"
      confirmLoading={saving}
      destroyOnHidden
      width={720}
    >
      {awaitingFund && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          title="Đã duyệt bằng Quỹ bảo trì, đang chờ Kế toán lập đề xuất và Ban quản trị biểu quyết"
          description="Khi đề xuất đang chờ biểu quyết thì không quyết định lại được. Nếu Kế toán chưa lập đề xuất, bạn vẫn đổi được quyết định."
        />
      )}
      <RepairInfo workOrder={workOrder} showHistory={false} />
      <RecentMaintenance assetId={assetId} />
      <Form
        form={form}
        layout="vertical"
        initialValues={{ decision: only ?? 'APPROVE', costSource: 'OPERATING' }}
        onFinish={(v) => save(v).catch(markFieldErrors(form))}
      >
        {!only && (
          <Form.Item name="decision" label="Quyết định">
            <Radio.Group optionType="button" buttonStyle="solid" options={DECISION_OPTIONS} />
          </Form.Item>
        )}
        {picked === 'APPROVE' && (
          <Form.Item
            name="costSource"
            label="Nguồn chi phí"
            extra={costSource === 'FUND'
              ? 'Phiếu giữ Chờ duyệt sửa; Kế toán lập đề xuất chi quỹ, Ban quản trị duyệt thì mới sửa. Chưa liên hệ nhà thầu.'
              : 'Phiếu chuyển Đang sửa; bạn liên hệ nhà thầu ngoài hệ thống.'}
          >
            <Radio.Group options={[{ value: 'OPERATING', label: 'Chi phí vận hành' }, { value: 'FUND', label: 'Quỹ bảo trì (cần Ban quản trị duyệt)' }]} />
          </Form.Item>
        )}
        {picked === 'POSTPONE' && (
          <Form.Item
            name="reviewDate"
            label="Ngày xem lại"
            rules={[{ required: true, message: 'Chọn ngày xem lại' }]}
            extra={`Tối đa ${maxDays} ngày. Từ ngày này hệ thống nhắc bạn, lặp lại cho tới khi có người gửi yêu cầu sửa lại hoặc ngừng sử dụng thiết bị. Thiết bị vẫn được kiểm tra định kỳ.`}
          >
            <DatePicker
              format="DD/MM/YYYY"
              style={{ width: 220 }}
              disabledDate={(d) => !d.isAfter(today, 'day') || d.isAfter(today.add(maxDays, 'day'), 'day')}
              presets={POSTPONE_PRESETS.filter((p) => p.value <= maxDays).map((p) => ({ label: p.label, value: today.add(p.value, 'day') }))}
            />
          </Form.Item>
        )}
        {picked === 'RETIRE' && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            title="Phiếu đóng không sửa; thiết bị ngừng theo dõi và không còn lịch kiểm tra. Phiếu kiểm tra đang mở của thiết bị cũng đóng."
          />
        )}
        <Form.Item
          name="comment"
          label={picked === 'APPROVE' ? 'Ghi chú cho kỹ thuật viên' : 'Lý do'}
          rules={picked === 'APPROVE' ? [] : [{ required: true, whitespace: true, min: 5, message: 'Nhập lý do tối thiểu 5 ký tự' }]}
        >
          <Input.TextArea rows={2} maxLength={1000} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** Lỗi theo ô từ server (reviewDate, comment) → báo đỏ đúng ô */
const markFieldErrors = (form) => (err) => {
  const fields = (err?.details ?? []).filter((d) => d.field).map((d) => ({ name: [d.field], errors: [d.message] }));
  if (fields.length) form.setFields(fields);
};

// ===== UC10: gửi yêu cầu sửa lại phiếu đang tạm hoãn (KTV hoặc Trưởng BQL) =====
export function RepairRequestModal({ workOrder, open, onClose, onDone }) {
  const [form] = Form.useForm();
  const [save, saving] = useAction(
    (v) => workOrderApi.repairRequest(workOrder._id, { note: v.note.trim(), estimatedCost: v.estimatedCost }, toFiles(v.images)),
    { success: (res) => res.message, onDone: done(onClose, onDone) },
  );
  const r = workOrder.repair ?? {};
  return (
    <Modal title={`Gửi yêu cầu sửa lại: ${assetText(workOrder)}`} open={open} onCancel={onClose} onOk={() => form.submit()} okText="Gửi Trưởng BQL" cancelText="Đóng" confirmLoading={saving} destroyOnHidden width={640}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        title={`Đang tạm hoãn${r.reviewDate ? ` đến ${formatDate(r.reviewDate)}` : ''}`}
        description={<span style={{ whiteSpace: 'pre-wrap' }}>Lỗi: {r.faultDesc}{r.decisionNote ? `\nLý do hoãn: ${r.decisionNote}` : ''}</span>}
      />
      <Form form={form} layout="vertical" initialValues={{ estimatedCost: r.estimatedCost }} onFinish={(v) => save(v).catch(() => {})}>
        <Form.Item name="note" label="Lý do cần sửa lúc này" rules={[{ required: true, whitespace: true, min: 5, message: 'Nhập lý do tối thiểu 5 ký tự' }]}>
          <Input.TextArea rows={3} maxLength={2000} showCount placeholder="Lỗi nặng hơn, đã có ngân sách, nhà thầu báo giá mới…" />
        </Form.Item>
        <Form.Item name="estimatedCost" label="Chi phí dự kiến (VNĐ)" extra="Sửa nếu báo giá đã thay đổi.">
          <InputNumber min={1} max={1e12} precision={0} style={{ width: '100%' }} {...moneyInputProps} addonAfter="đ" />
        </Form.Item>
        <EvidencePhotosField name="images" label="Ảnh hiện trạng" required={false} />
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

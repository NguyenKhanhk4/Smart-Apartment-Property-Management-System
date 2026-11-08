import { Alert, Flex, Form, Input, InputNumber, Modal, Radio, Tag, Typography } from 'antd';
import { CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import { workOrderApi } from '../../api/equipment.api';
import EvidencePhotosField from '../../components/EvidencePhotosField';
import { useAction } from '../../hooks/useApi';
import { formatDate } from '../../utils/format';
import { toFiles } from '../../utils/upload';
import { failingRequired, isMeasured, itemStatus, rangeText, toPayload } from './inspectionForm';

const STATUS_ICON = {
  ok: <CheckCircleFilled style={{ color: 'var(--ant-color-success)' }} aria-label="Đạt" />,
  fail: <CloseCircleFilled style={{ color: 'var(--ant-color-error)' }} aria-label="Không đạt" />,
};

/** Lỗi theo mục từ server ('results.2', 'images', 'note') → báo đỏ đúng ô của form */
const markFieldErrors = (form, checklist) => (err) => {
  const fields = (err?.details ?? []).map((d) => {
    const m = /^results\.(\d+)$/.exec(d.field ?? '');
    if (m) return { name: ['inputs', Number(m[1]), isMeasured(checklist[Number(m[1])]) ? 'value' : 'ok'], errors: [d.message] };
    return d.field ? { name: [d.field], errors: [d.message] } : null;
  }).filter(Boolean);
  if (fields.length) form.setFields(fields);
};

// UC08 bước 5–7: nhập checklist (bản sao lúc tạo phiếu), chụp ảnh, chọn Đạt / Có sự cố
export default function InspectionModal({ workOrder, open, onClose, onDone }) {
  const [form] = Form.useForm();
  const checklist = workOrder.checklist ?? [];
  const inputs = Form.useWatch('inputs', form) ?? [];
  const result = Form.useWatch('result', form);
  const failing = failingRequired(checklist, inputs);
  const faulty = result === 'FAULTY' || failing.length > 0; // Đạt bị khóa thì chỉ còn Có sự cố

  const [save, saving] = useAction(
    (v) => workOrderApi.submitInspection(
      workOrder._id,
      { result: v.result, note: v.note?.trim() ?? '', results: toPayload(checklist, v.inputs) },
      toFiles(v.images),
    ),
    {
      success: (res) => res.message, // MSG-E04 hoặc "Đã ghi nhận sự cố…"
      // Trả phiếu sau khi nộp: Có sự cố thì nơi gọi mở tiếp form báo hư hỏng (UC09)
      onDone: (res) => {
        onClose();
        onDone?.(res.data);
      },
    },
  );

  const asset = workOrder.assetId;
  return (
    <Modal
      title="Kiểm tra định kỳ"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Nộp kết quả"
      cancelText="Đóng"
      okButtonProps={{ danger: result === 'FAULTY' }}
      confirmLoading={saving}
      destroyOnHidden
      width="min(720px, 94vw)"
    >
      <Typography.Paragraph style={{ marginBottom: 12 }}>
        <Typography.Text strong>{asset?.code} – {asset?.name}</Typography.Text>
        <Typography.Text type="secondary">{asset?.location ? ` · ${asset.location}` : ''}</Typography.Text>
      </Typography.Paragraph>
      {workOrder.knownFault && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title={workOrder.knownFault.status === 'REPAIR_POSTPONED'
            ? `Thiết bị đang tạm hoãn sửa${workOrder.knownFault.reviewDate ? ` đến ${formatDate(workOrder.knownFault.reviewDate)}` : ''}`
            : 'Thiết bị đang có phiếu sửa chữa'}
          description={<>Lỗi đã biết: {workOrder.knownFault.faultDesc}. Kiểm tra bình thường; nếu lỗi vẫn còn, chọn Có sự cố, kết quả được ghi vào phiếu sửa chữa đó.</>}
        />
      )}
      <Form
        form={form}
        layout="vertical"
        initialValues={{ inputs: checklist.map(() => ({})), result: 'PASSED' }}
        onFinish={(v) => save(v).catch(markFieldErrors(form, checklist))}
      >
        {checklist.length ? (
          <Flex vertical gap={8} style={{ marginBottom: 16 }}>
            {checklist.map((item, i) => {
              const status = itemStatus(item, inputs[i]);
              const required = item.required !== false;
              const rule = required ? [{ required: true, message: 'Bắt buộc' }] : [];
              return (
                <Flex
                  key={`${item.label}-${i}`}
                  gap={12}
                  wrap
                  align="center"
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: `1px solid ${status === 'fail' ? 'var(--ant-color-error-border)' : 'var(--ant-color-border-secondary)'}`,
                    background: status === 'fail' ? 'var(--ant-color-error-bg)' : undefined,
                  }}
                >
                  <Flex vertical style={{ flex: '1 1 220px', minWidth: 0 }}>
                    <Typography.Text strong>
                      {i + 1}. {item.label} {required ? <Tag color="blue">Bắt buộc</Tag> : null}
                    </Typography.Text>
                    {isMeasured(item) && (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>Cho phép: {rangeText(item) || 'không giới hạn'}</Typography.Text>
                    )}
                  </Flex>
                  {isMeasured(item) ? (
                    <Form.Item name={['inputs', i, 'value']} rules={rule} style={{ margin: 0 }}>
                      <InputNumber
                        placeholder="Giá trị đo"
                        addonAfter={item.unit || undefined}
                        status={status === 'fail' ? 'error' : undefined}
                        style={{ width: 170 }}
                        aria-label={`Giá trị đo ${item.label}`}
                      />
                    </Form.Item>
                  ) : (
                    <Form.Item name={['inputs', i, 'ok']} rules={rule} style={{ margin: 0 }}>
                      <Radio.Group optionType="button" aria-label={item.label} options={[{ value: true, label: 'Đạt' }, { value: false, label: 'Không đạt' }]} />
                    </Form.Item>
                  )}
                  <span style={{ width: 18 }}>{STATUS_ICON[status]}</span>
                </Flex>
              );
            })}
          </Flex>
        ) : (
          <Alert type="info" showIcon style={{ marginBottom: 16 }} title="Phiếu này tạo trước khi có mẫu checklist: chỉ cần ảnh và kết quả." />
        )}

        <EvidencePhotosField name="images" label="Ảnh kiểm tra" />

        {failing.length > 0 && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            title={`${failing.length} mục bắt buộc không đạt: ${failing.map((i) => checklist[i].label).join(', ')}. Kết quả phải là Có sự cố.`}
          />
        )}
        <Form.Item
          name="result"
          label="Kết quả"
          dependencies={['inputs']}
          rules={[
            { required: true, message: 'Chọn kết quả' },
            () => ({
              validator: (_, v) => (v === 'PASSED' && failing.length ? Promise.reject(new Error('Có mục bắt buộc không đạt, chọn Có sự cố')) : Promise.resolve()),
            }),
          ]}
        >
          <Radio.Group
            optionType="button"
            buttonStyle="solid"
            options={[
              { value: 'PASSED', label: 'Đạt', disabled: failing.length > 0 },
              { value: 'FAULTY', label: 'Có sự cố' },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="note"
          label={faulty ? 'Mô tả sự cố' : 'Ghi chú'}
          rules={faulty ? [{ required: true, whitespace: true, min: 5, message: 'Mô tả sự cố tối thiểu 5 ký tự' }] : []}
          extra={faulty && workOrder.knownFault ? 'Thiết bị đã có phiếu sửa chữa: kết quả ghi vào phiếu đó và báo Trưởng BQL; phiếu kiểm tra này hoàn thành, lịch bảo trì dời như bình thường.' : faulty ? 'Phiếu sẽ chờ báo cáo hư hỏng để Trưởng BQL duyệt sửa chữa; lịch bảo trì chưa được dời.' : 'Đạt: phiếu hoàn thành và lịch bảo trì tiếp theo được tính lại từ hôm nay.'}
        >
          <Input.TextArea rows={3} maxLength={1000} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}

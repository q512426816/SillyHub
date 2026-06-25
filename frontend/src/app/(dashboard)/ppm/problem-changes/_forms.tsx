"use client";

/**
 * 问题变更 (ProblemChange) 表单组件 — 对齐源 dept_project_front problemchange/*.vue。
 *
 * 组件对照关系:
 *   组件                | 源                     | 入口                            | 可编辑字段
 *   --------------------|------------------------|---------------------------------|----------------------------------
 *   ChangeCreateForm    | ChangeForm.vue         | 新建变更(从源问题回填 16 字段) | 全字段(对齐源 16 字段) + changeReason
 *   ChangeEditForm      | ChangeForm.vue(update) | status=1 编辑                   | 可改字段(ProblemChangeUpdate 范围)
 *   ChangeDetailForm    | ChangeDetailForm.vue   | status=2/3 终态详情             | 全字段只读 + 流程履历 Timeline
 *   ChangeAuditForm     | ChangeAuditForm.vue    | status=1 审核                   | isBack + comment (前序全只读 + Timeline)
 *
 * 16 字段(对齐源 ChangeForm.vue):
 *   projectId/moduleId/modelName/proDesc/funcName/proType/isUrgent/
 *   findBy/findTime/proAnswer/workType/dutyUserId/workLoad/
 *   planStartTime/planEndTime/changeReason
 *
 * 设计依据:.sillyspec/changes/2026-06-21-ppm-frontend-alignment/design.md §7
 */
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  DatePicker,
  Descriptions,
  Divider,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Spin,
  Switch,
  Timeline,
  Typography,
  message,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";

import { PpmFileUrls } from "@/components/ppm-file-urls";
import { PpmUserSelect } from "@/components/ppm-user-select";
import { ApiError } from "@/lib/api";
import { errMessage } from "@/lib/errors";
import {
  createProblemChange,
  getProblem,
  getProblemChange,
  listProblemChangeLogs,
  nextProcessProblemChange,
  rejectProcessProblemChange,
  updateProblemChange,
} from "@/lib/ppm";
import type {
  ProblemChange,
  ProblemChangeUpdate,
  ProblemList,
  ProblemProcessLog,
} from "@/lib/ppm";

const { TextArea } = Input;
const { Text } = Typography;

// ── 字典(对齐源 ChangeForm.vue options) ─────────────────────────────────────

const PRO_TYPE_OPTIONS = [
  { label: "系统BUG", value: "bug" },
  { label: "变更", value: "change" },
];

const WORK_TYPE_OPTIONS = [
  { label: "前端工作", value: "前端" },
  { label: "后端工作", value: "后端" },
  { label: "业务工作", value: "业务" },
];

const TYPE_LABEL: Record<string, string> = {
  bug: "系统BUG",
  change: "变更",
};

const WORK_TYPE_LABEL: Record<string, string> = {
  前端: "前端工作",
  后端: "后端工作",
  业务: "业务工作",
};

// ── helpers ──────────────────────────────────────────────────────────────────

/** ISO/字符串/null → dayjs(用于 DatePicker 初始值)。 */
function toDay(v: unknown): Dayjs | undefined {
  if (v == null || v === "") return undefined;
  const d = dayjs(typeof v === "string" || typeof v === "number" || v instanceof Date ? v : NaN);
  return d.isValid() ? d : undefined;
}

/** dayjs → 后端 nullable ISO 串(YYYY-MM-DD);空 → null。 */
function dayStrToApi(v: Dayjs | null | undefined): string | null {
  if (!v) return null;
  return v.format("YYYY-MM-DD");
}

/** ISO/字符串/null → YYYY-MM-DD 显示串(用于 Descriptions 只读字段)。 */
function toDayStr(v: unknown): string {
  const d = toDay(v);
  return d ? d.format("YYYY-MM-DD") : "";
}

function notifyOk(text: string) {
  message.success(text);
}

// ===========================================================================
// 共用:变更信息只读区(对照源 ChangeAuditForm.vue 前序只读字段)
// ===========================================================================

function ChangeDescriptions({ change }: { change: ProblemChange }) {
  return (
    <Descriptions
      title="变更信息"
      column={1}
      bordered
      size="small"
      labelStyle={{ width: 140 }}
    >
      <Descriptions.Item label="项目">
        {change.project_name ?? change.project_id ?? "—"}
      </Descriptions.Item>
      <Descriptions.Item label="模块">
        {change.model_name ?? "—"}
      </Descriptions.Item>
      <Descriptions.Item label="问题描述">
        {change.pro_desc ?? "—"}
      </Descriptions.Item>
      <Descriptions.Item label="功能名称">
        {change.func_name ?? "—"}
      </Descriptions.Item>
      <Descriptions.Item label="问题类型">
        {change.pro_type ? TYPE_LABEL[change.pro_type] ?? change.pro_type : "—"}
      </Descriptions.Item>
      <Descriptions.Item label="是否紧急">
        {change.is_urgent === "1" || change.is_urgent === "是" ? "是" : "否"}
      </Descriptions.Item>
      <Descriptions.Item label="发现人/提出人">
        {change.find_by ?? "—"}
      </Descriptions.Item>
      <Descriptions.Item label="发现日期">
        {toDayStr(change.find_time) || "—"}
      </Descriptions.Item>
      <Descriptions.Item label="问题解答">
        {change.pro_answer ?? "—"}
      </Descriptions.Item>
      <Descriptions.Item label="工作类型">
        {change.work_type
          ? WORK_TYPE_LABEL[change.work_type] ?? change.work_type
          : "—"}
      </Descriptions.Item>
      <Descriptions.Item label="责任人">
        {change.duty_user_name ?? change.duty_user_id ?? "待指派"}
      </Descriptions.Item>
      <Descriptions.Item label="工作量(人/天)">
        {change.work_load ?? "—"}
      </Descriptions.Item>
      <Descriptions.Item label="计划时间">
        {toDayStr(change.plan_start_time) || "?"} ~{" "}
        {toDayStr(change.plan_end_time) || "?"}
      </Descriptions.Item>
      <Descriptions.Item label="备注">
        {change.remarks ?? "—"}
      </Descriptions.Item>
      <Descriptions.Item label="变更原因">
        {change.change_reason ?? "—"}
      </Descriptions.Item>
    </Descriptions>
  );
}

// ===========================================================================
// 流程履历(对照源 el-timeline processList)
// ===========================================================================

function ProcessTimeline({
  logs,
  loading,
}: {
  logs: ProblemProcessLog[];
  loading: boolean;
}) {
  return (
    <>
      <Divider>流程履历</Divider>
      {loading ? (
        <Spin />
      ) : logs.length === 0 ? (
        <Text type="secondary">暂无流程履历</Text>
      ) : (
        <Timeline
          items={logs.map((log) => ({
            children: (
              <div>
                <div>{log.handle_info || log.node_key || "流转"}</div>
                <div
                  style={{ fontSize: 12, color: "rgba(0,0,0,0.45)" }}
                >
                  {log.handle_user_name ?? log.handle_user_id ?? "—"} ·{" "}
                  {log.created_at ? dayjs(log.created_at).format("YYYY-MM-DD HH:mm:ss") : "—"}
                </div>
                {log.comment && (
                  <div style={{ fontSize: 12 }}>
                    备注:{log.comment}
                  </div>
                )}
              </div>
            ),
          }))}
        />
      )}
    </>
  );
}

// ===========================================================================
// 1. ChangeCreateForm — ChangeForm.vue (新建变更,从源问题回填)
// ===========================================================================

export interface ChangeCreateFormProps {
  /** 源问题 ID(变更按钮入口已知);为空则表单内填写。 */
  sourceProblemId?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

interface ChangeCreateValues {
  resource_id: string;
  project_id?: string;
  module_id?: string;
  model_name?: string;
  pro_desc?: string;
  func_name?: string;
  pro_type?: string;
  is_urgent?: boolean;
  find_by?: string;
  find_time?: Dayjs;
  pro_answer?: string;
  work_type?: string;
  duty_user_id?: string;
  work_load?: string;
  plan_start_time?: Dayjs;
  plan_end_time?: Dayjs;
  remarks?: string;
  change_reason?: string;
}

export function ChangeCreateForm({
  sourceProblemId,
  onSuccess,
  onCancel,
}: ChangeCreateFormProps) {
  const [form] = Form.useForm<ChangeCreateValues>();
  const [busy, setBusy] = useState(false);
  const [loadingSource, setLoadingSource] = useState(false);
  // 源问题(projectMember 联动 searchData 需要 project_id)
  const [sourceProblem, setSourceProblem] = useState<ProblemList | null>(null);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);

  // 新建变更时从源问题回填(对照源 ChangeForm.vue open(id) → getList(id))
  useEffect(() => {
    const rid = (sourceProblemId ?? "").trim();
    if (!rid) return;
    let cancelled = false;
    setLoadingSource(true);
    getProblem(rid)
      .then((p) => {
        if (cancelled) return;
        setSourceProblem(p);
        setProjectId(p.project_id ?? undefined);
        // 源 ChangeForm.vue:formData = getList(id);resourceId = id;id = undefined
        form.setFieldsValue({
          resource_id: String(p.id),
          project_id: p.project_id ?? undefined,
          module_id: p.module_id ?? undefined,
          model_name: p.model_name ?? undefined,
          pro_desc: p.pro_desc ?? undefined,
          func_name: p.func_name ?? undefined,
          pro_type: p.pro_type ?? "bug",
          is_urgent: p.is_urgent === "1" || p.is_urgent === "是",
          find_by: p.find_by ?? undefined,
          find_time: toDay(p.find_time),
          pro_answer: p.pro_answer ?? undefined,
          work_type: p.work_type ?? undefined,
          duty_user_id: p.duty_user_id ?? undefined,
          work_load: p.work_load ?? undefined,
          plan_start_time: toDay(p.plan_start_time),
          plan_end_time: toDay(p.plan_end_time),
          remarks: p.remarks ?? undefined,
        });
      })
      .catch(() => {
        // 源问题不存在/无权限 → 仅保留 resource_id 供手填
        if (!cancelled) form.setFieldValue("resource_id", rid);
      })
      .finally(() => {
        if (!cancelled) setLoadingSource(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceProblemId, form]);

  const submit = async () => {
    try {
      const v = await form.validateFields();
      setBusy(true);
      await createProblemChange({
        resource_id: (v.resource_id ?? "").trim(),
        project_id: v.project_id ?? null,
        project_name: sourceProblem?.project_name ?? null,
        model_name: v.model_name ?? null,
        pro_desc: v.pro_desc ?? null,
        func_name: v.func_name ?? null,
        pro_type: v.pro_type ?? "bug",
        is_urgent: v.is_urgent ? "1" : "0",
        find_by: v.find_by ?? null,
        find_time: v.find_time ? dayStrToApi(v.find_time) : null,
        pro_answer: v.pro_answer ?? null,
        work_type: v.work_type ?? null,
        duty_user_id: v.duty_user_id ?? null,
        duty_user_name: null,
        plan_start_time: v.plan_start_time ? dayStrToApi(v.plan_start_time) : null,
        plan_end_time: v.plan_end_time ? dayStrToApi(v.plan_end_time) : null,
        remarks: v.remarks ?? null,
        change_reason: v.change_reason ?? null,
        work_load: v.work_load ?? null,
      });
      notifyOk("已提交变更申请");
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) message.error(errMessage(err, "提交失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Spin spinning={loadingSource} tip="加载源问题…">
      <Form<ChangeCreateValues>
        form={form}
        layout="vertical"
        initialValues={{
          resource_id: sourceProblemId ?? "",
          pro_type: "bug",
          is_urgent: false,
        }}
        onValuesChange={(changed) => {
          if ("project_id" in changed) {
            setProjectId(changed.project_id ?? undefined);
          }
        }}
      >
        <Form.Item
          label="源问题 ID"
          name="resource_id"
          rules={[{ required: true, message: "源问题 ID 必填" }]}
        >
          <Input placeholder="请输入源问题清单 ID" />
        </Form.Item>

        <Form.Item label="项目" name="project_id">
          <Input placeholder="项目 ID(从源问题回填)" />
        </Form.Item>

        <Form.Item label="关联模块 ID" name="module_id">
          <Input placeholder="请输入模块 ID(可选)" />
        </Form.Item>

        <Form.Item label="模块名称" name="model_name">
          <Input placeholder="请输入模块名称" />
        </Form.Item>

        <Form.Item
          label="问题描述"
          name="pro_desc"
          rules={[{ required: true, message: "问题描述必填" }]}
        >
          <Input placeholder="请输入问题描述" />
        </Form.Item>

        <Form.Item
          label="功能名称"
          name="func_name"
          rules={[{ required: true, message: "功能名称必填" }]}
        >
          <Input placeholder="请输入功能名称" />
        </Form.Item>

        <Form.Item
          label="问题类型"
          name="pro_type"
          rules={[{ required: true, message: "问题类型必填" }]}
        >
          <Select options={PRO_TYPE_OPTIONS} placeholder="请选择问题类型" />
        </Form.Item>

        <Form.Item label="是否紧急" name="is_urgent" valuePropName="checked">
          <Switch checkedChildren="是" unCheckedChildren="否" />
        </Form.Item>

        <Form.Item
          label="发现人/提出人"
          name="find_by"
          rules={[{ required: true, message: "发现人/提出人必填" }]}
        >
          <Input placeholder="请输入发现人/提出人" />
        </Form.Item>

        <Form.Item
          label="发现日期"
          name="find_time"
          rules={[{ required: true, message: "发现日期必填" }]}
        >
          <DatePicker style={{ width: "100%" }} />
        </Form.Item>

        <Form.Item label="问题解答" name="pro_answer">
          <TextArea rows={2} placeholder="请输入问题解答" />
        </Form.Item>

        <Form.Item
          label="工作类型"
          name="work_type"
          rules={[{ required: true, message: "工作类型必填" }]}
        >
          <Select options={WORK_TYPE_OPTIONS} placeholder="请选择工作类型" />
        </Form.Item>

        <Form.Item label="责任人" name="duty_user_id">
          <PpmUserSelect
            res="projectMember"
            searchData={{ pm_project_id: projectId ?? null }}
            placeholder={projectId ? "请选择责任人" : "请先填写项目"}
          />
        </Form.Item>

        <Form.Item
          label="预计工作量"
          name="work_load"
          rules={[{ required: true, message: "工作量必填" }]}
        >
          <InputNumber
            placeholder="请输入工作量"
            precision={1}
            step={0.5}
            min={0}
            addonAfter="人/天"
            style={{ width: "100%" }}
          />
        </Form.Item>

        <Form.Item
          label="计划开始时间"
          name="plan_start_time"
          rules={[{ required: true, message: "计划开始时间必填" }]}
        >
          <DatePicker style={{ width: "100%" }} />
        </Form.Item>

        <Form.Item
          label="计划完成时间"
          name="plan_end_time"
          rules={[{ required: true, message: "计划完成时间必填" }]}
        >
          <DatePicker style={{ width: "100%" }} />
        </Form.Item>

        <Form.Item label="备注" name="remarks">
          <TextArea rows={2} placeholder="请输入备注" />
        </Form.Item>

        <Form.Item
          label="变更原因"
          name="change_reason"
          rules={[{ required: true, message: "变更原因必填" }]}
        >
          <TextArea rows={3} placeholder="请输入变更原因" />
        </Form.Item>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 8,
          }}
        >
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" loading={busy} onClick={() => void submit()}>
            提交变更申请
          </Button>
        </div>
      </Form>
    </Spin>
  );
}

// ===========================================================================
// 2. ChangeEditForm — ChangeForm.vue (编辑,status=1)
// ===========================================================================

export interface ChangeEditFormProps {
  change: ProblemChange;
  onSuccess: () => void;
  onCancel: () => void;
}

interface ChangeEditValues {
  pro_desc?: string;
  pro_type?: string;
  is_urgent?: boolean;
  duty_user_id?: string;
  work_load?: string;
  plan_start_time?: Dayjs;
  plan_end_time?: Dayjs;
  change_reason?: string;
  remarks?: string;
}

export function ChangeEditForm({
  change,
  onSuccess,
  onCancel,
}: ChangeEditFormProps) {
  const [form] = Form.useForm<ChangeEditValues>();
  const [busy, setBusy] = useState(false);
  const projectId = change.project_id ?? undefined;

  const initialValues = useMemo<ChangeEditValues>(
    () => ({
      pro_desc: change.pro_desc ?? undefined,
      pro_type: change.pro_type ?? undefined,
      is_urgent: change.is_urgent === "1" || change.is_urgent === "是",
      duty_user_id: change.duty_user_id ?? undefined,
      work_load: change.work_load ?? undefined,
      plan_start_time: toDay(change.plan_start_time),
      plan_end_time: toDay(change.plan_end_time),
      change_reason: change.change_reason ?? undefined,
      remarks: change.remarks ?? undefined,
    }),
    [change],
  );

  const submit = async () => {
    try {
      const v = await form.validateFields();
      setBusy(true);
      const body: ProblemChangeUpdate = {
        pro_desc: v.pro_desc ?? null,
        pro_type: v.pro_type ?? null,
        is_urgent: v.is_urgent ? "1" : "0",
        duty_user_id: v.duty_user_id ?? null,
        work_load: v.work_load ?? null,
        plan_start_time: v.plan_start_time ? dayStrToApi(v.plan_start_time) : null,
        plan_end_time: v.plan_end_time ? dayStrToApi(v.plan_end_time) : null,
        change_reason: v.change_reason ?? null,
      };
      await updateProblemChange(change.id, body);
      notifyOk("已保存");
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) message.error(errMessage(err, "保存失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Form<ChangeEditValues>
      form={form}
      layout="vertical"
      initialValues={initialValues}
    >
      <Form.Item label="问题描述" name="pro_desc">
        <Input placeholder="请输入问题描述" />
      </Form.Item>
      <Form.Item label="问题类型" name="pro_type">
        <Select options={PRO_TYPE_OPTIONS} placeholder="请选择问题类型" />
      </Form.Item>
      <Form.Item label="是否紧急" name="is_urgent" valuePropName="checked">
        <Switch checkedChildren="是" unCheckedChildren="否" />
      </Form.Item>
      <Form.Item label="责任人" name="duty_user_id">
        <PpmUserSelect
          res="projectMember"
          searchData={{ pm_project_id: projectId ?? null }}
          placeholder="请选择责任人"
        />
      </Form.Item>
      <Form.Item label="预计工作量" name="work_load">
        <InputNumber
          placeholder="请输入工作量"
          precision={1}
          step={0.5}
          min={0}
          addonAfter="人/天"
          style={{ width: "100%" }}
        />
      </Form.Item>
      <Form.Item label="计划开始时间" name="plan_start_time">
        <DatePicker style={{ width: "100%" }} />
      </Form.Item>
      <Form.Item label="计划完成时间" name="plan_end_time">
        <DatePicker style={{ width: "100%" }} />
      </Form.Item>
      <Form.Item label="变更原因" name="change_reason">
        <TextArea rows={3} placeholder="请输入变更原因" />
      </Form.Item>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 8,
        }}
      >
        <Button onClick={onCancel}>取消</Button>
        <Button type="primary" loading={busy} onClick={() => void submit()}>
          保存
        </Button>
      </div>
    </Form>
  );
}

// ===========================================================================
// 3. ChangeDetailForm — ChangeDetailForm.vue (详情 + 流程履历)
// ===========================================================================

export interface ChangeDetailFormProps {
  change: ProblemChange;
  onCancel: () => void;
}

export function ChangeDetailForm({
  change,
  onCancel,
}: ChangeDetailFormProps) {
  const [logs, setLogs] = useState<ProblemProcessLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingLogs(true);
    listProblemChangeLogs(change.id)
      .then((data) => {
        if (!cancelled) setLogs(data);
      })
      .catch(() => {
        if (!cancelled) setLogs([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingLogs(false);
      });
    return () => {
      cancelled = true;
    };
  }, [change.id]);

  return (
    <div>
      <ChangeDescriptions change={change} />
      <ProcessTimeline logs={logs} loading={loadingLogs} />
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <Button onClick={onCancel}>关闭</Button>
      </div>
    </div>
  );
}

// ===========================================================================
// 4. ChangeAuditForm — ChangeAuditForm.vue (审核,status=1)
// ===========================================================================

export interface ChangeAuditFormProps {
  changeId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function ChangeAuditForm({
  changeId,
  onSuccess,
  onCancel,
}: ChangeAuditFormProps) {
  const [change, setChange] = useState<ProblemChange | null>(null);
  const [logs, setLogs] = useState<ProblemProcessLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [isBack, setIsBack] = useState<"0" | "1">("0");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  // 加载变更详情 + 流程履历(对照源 ChangeAuditForm.vue open → getChange + getProcessLogPage)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getProblemChange(changeId), listProblemChangeLogs(changeId)])
      .then(([c, lg]) => {
        if (cancelled) return;
        setChange(c);
        setLogs(lg);
        setIsBack("0");
      })
      .catch(() => {
        if (!cancelled) {
          setChange(null);
          setLogs([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [changeId]);

  const submit = async () => {
    if (isBack === "1" && !comment.trim()) {
      message.warning("驳回意见不能为空");
      return;
    }
    setBusy(true);
    try {
      if (isBack === "0") {
        await nextProcessProblemChange(changeId, {
          comment: comment.trim() || null,
        });
        notifyOk("已推进到下一节点");
      } else {
        await rejectProcessProblemChange(changeId, { comment: comment.trim() });
        notifyOk("已驳回");
      }
      onSuccess();
    } catch (err) {
      message.error(errMessage(err, "提交失败"));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 24 }}>
        <Spin />
      </div>
    );
  }
  if (!change) {
    return (
      <div>
        <Text type="danger">加载变更详情失败</Text>
        <div style={{ marginTop: 12, textAlign: "right" }}>
          <Button onClick={onCancel}>关闭</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <ChangeDescriptions change={change} />
      <ProcessTimeline logs={logs} loading={false} />
      <Divider>审核</Divider>
      <Form layout="vertical">
        <Form.Item label="是否驳回(对照源 isBack)">
          <Radio.Group
            value={isBack}
            onChange={(e) => setIsBack(e.target.value as "0" | "1")}
          >
            <Radio value="0">否(通过)</Radio>
            <Radio value="1">是(驳回)</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item label="审核意见/备注(对照源 comment)">
          <TextArea
            rows={4}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="请输入审核意见(驳回时必填)"
          />
        </Form.Item>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" loading={busy} onClick={() => void submit()}>
            提交
          </Button>
        </div>
      </Form>
    </div>
  );
}

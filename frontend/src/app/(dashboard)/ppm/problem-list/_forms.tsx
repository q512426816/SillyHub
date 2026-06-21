"use client";

/**
 * 问题清单 6 态表单组件 (对照源 dept_project_front problemlist/*.vue)。
 *
 * 每个 Form 对应源一个 .vue,字段逐字段对齐 + disabled 策略逐态对齐:
 *
 *   组件               | 源                  | 入口状态                | 可编辑字段
 *   -------------------|---------------------|-------------------------|--------------------------------
 *   ProblemCreateForm  | ListForm.vue        | 新建/编辑(status=1)    | 全字段(责任人按 projectMember+role_name 联动)
 *   ProblemStartForm   | ListStartForm.vue   | status=3 处置中(开始)  | dutyUserId 确认 + handleInfo
 *   ProblemAuditForm   | ListAuditForm.vue   | status=2 审核中         | isBack + comment (前序全只读)
 *   ProblemDoneForm    | ListDoneForm.vue    | status=3 处置中(完成)  | timeSpent + handleInfo
 *   ProblemCloseForm   | ListCloseForm.vue   | status=6 待验证         | checkTime + checkResult + checkInfo
 *   ProblemDetailForm  | ListDetailForm.vue  | 任意状态(详情)         | 全字段只读 + 流程履历 Timeline
 *
 * 复用:PpmUserSelect / PpmFileUrls / addWorkingDaysDate / problem.ts API。
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
import {
  closeTaskProblem,
  createProblem,
  doneTaskProblem,
  listProblemLogs,
  nextProcessProblem,
  rejectProcessProblem,
  updateProblem,
} from "@/lib/ppm";
import type {
  ProblemCloseTaskReq,
  ProblemDoneTaskReq,
  ProblemList,
  ProblemListCreate,
  ProblemListUpdate,
  ProblemProcessLog,
} from "@/lib/ppm";
import { addWorkingDaysDate } from "@/lib/ppm/workday";

const { TextArea } = Input;
const { Text } = Typography;

// ── 字典(对齐源 ListForm.vue options) ─────────────────────────────────────

const PRO_TYPE_OPTIONS = [
  { label: "系统BUG", value: "bug" },
  { label: "变更", value: "change" },
];

/** 源 ListForm.vue workType options:前端工作/后端工作/业务工作。 */
const WORK_TYPE_OPTIONS = [
  { label: "前端工作", value: "前端" },
  { label: "后端工作", value: "后端" },
  { label: "业务工作", value: "业务" },
];

/**
 * workType value → 角色名(对齐源 searchData role_name)。
 * 源 ListForm.vue dutyUser 查询条件 roleName = workType(直接传值)。
 */
function workTypeToRoleName(workType: string | null | undefined): string | null {
  if (!workType) return null;
  // 源 workType="前端" 时 roleName="前端" 等价于 role_name 含「前端」的项目成员
  return workType;
}

const TYPE_LABEL: Record<string, string> = {
  bug: "系统BUG",
  change: "变更",
};

const WORK_TYPE_LABEL: Record<string, string> = {
  前端: "前端工作",
  后端: "后端工作",
  业务: "业务工作",
};

// ── 共享 helpers ───────────────────────────────────────────────────────────

/** dayjs 转表单字符串(YYYY-MM-DD),null/异常返回 ""。 */
function toDayStr(v: unknown): string {
  if (v == null || v === "") return "";
  const d = dayjs(typeof v === "string" || typeof v === "number" || v instanceof Date ? v : NaN);
  return d.isValid() ? d.format("YYYY-MM-DD") : "";
}

/** 表单字符串 → 后端 nullable ISO 串(YYYY-MM-DD);空串 → null。 */
function dayStrToApi(v: string | null | undefined): string | null {
  if (!v) return null;
  return v;
}

function notifyOk(text: string) {
  message.success(text);
}
function notifyErr(err: unknown, fallback: string) {
  if (err instanceof ApiError) message.error(err.message || fallback);
  else message.error(fallback);
}

// ── 流程履历 Timeline(对照源 el-timeline processList) ───────────────────────

/**
 * 审批/处置/关闭/详情各态表单复用的流程履历 Timeline。
 * logs 由父组件从 listProblemLogs 异步拉取。
 */
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
                  {log.created_at
                    ? dayjs(log.created_at).format("YYYY-MM-DD HH:mm:ss")
                    : "—"}
                </div>
                {log.comment && (
                  <div style={{ fontSize: 12 }}>备注:{log.comment}</div>
                )}
              </div>
            ),
          }))}
        />
      )}
    </>
  );
}

/**
 * 在表单组件内 lazy 加载流程履历(listProblemLogs)。
 * 返回 [logs, loading]。
 */
function useProblemLogs(
  problemId: string | undefined,
): [ProblemProcessLog[], boolean] {
  const [logs, setLogs] = useState<ProblemProcessLog[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!problemId) return;
    let cancelled = false;
    setLoading(true);
    listProblemLogs(problemId)
      .then((data) => {
        if (!cancelled) setLogs(data);
      })
      .catch(() => {
        if (!cancelled) setLogs([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [problemId]);
  return [logs, loading];
}

// ===========================================================================
// 1. ProblemCreateForm — ListForm.vue (新建/编辑)
// ===========================================================================

export interface ProblemCreateFormProps {
  problem?: ProblemList; // undefined=新建,否则 status=1 编辑
  onSuccess: () => void;
  onCancel: () => void;
}

export function ProblemCreateForm({
  problem,
  onSuccess,
  onCancel,
}: ProblemCreateFormProps) {
  const isEdit = !!problem;
  const [form] = Form.useForm<ProblemCreateValues>();
  const [busy, setBusy] = useState(false);
  // dutyUser 联动 searchData 依赖 projectId + workType
  const [projectId, setProjectId] = useState<string | undefined>(
    problem?.project_id,
  );
  const [workType, setWorkType] = useState<string | undefined>(
    problem?.work_type ?? undefined,
  );
  const [dutyUserId, setDutyUserId] = useState<string | undefined>(
    problem?.duty_user_id ?? undefined,
  );
  const [fileUrls, setFileUrls] = useState<string[]>(
    problem?.file_urls ?? [],
  );
  const [planEndTouched, setPlanEndTouched] = useState(false);

  // 工作日联动:planStartTime + workLoad → planEndTime (源 ListForm.vue)
  const initialValues = useMemo<ProblemCreateValues>(
    () => ({
      project_id: problem?.project_id,
      module_id: problem?.module_id ?? undefined,
      model_name: problem?.model_name ?? undefined,
      func_name: problem?.func_name ?? undefined,
      pro_desc: problem?.pro_desc ?? undefined,
      pro_answer: problem?.pro_answer ?? undefined,
      func_name_unused: undefined,
      pro_type: problem?.pro_type ?? "bug",
      is_urgent: problem?.is_urgent === "1" || problem?.is_urgent === "是",
      find_by: problem?.find_by ?? undefined,
      find_time:
        problem?.find_time != null && problem.find_time !== ""
          ? (dayjs(problem.find_time) as Dayjs | undefined)
          : (dayjs() as Dayjs),
      work_type: (problem?.work_type ?? undefined) as
        | (typeof WORK_TYPE_OPTIONS)[number]["value"]
        | undefined,
      duty_user_id: problem?.duty_user_id ?? undefined,
      work_load: problem?.work_load ?? undefined,
      plan_start_time:
        problem?.plan_start_time != null && problem.plan_start_time !== ""
          ? dayjs(problem.plan_start_time)
          : undefined,
      plan_end_time:
        problem?.plan_end_time != null && problem.plan_end_time !== ""
          ? dayjs(problem.plan_end_time)
          : undefined,
      audit_user_id: problem?.audit_user_id ?? undefined,
      remarks: problem?.remarks ?? undefined,
    }),
    [problem],
  );

  // 工作日联动:plan_start_time + work_load → plan_end_time
  const planStart = Form.useWatch("plan_start_time", form);
  const workLoad = Form.useWatch("work_load", form);
  useEffect(() => {
    if (planEndTouched) return;
    const days = Number(workLoad ?? 0);
    if (!planStart || !Number.isFinite(days) || days <= 0) return;
    try {
      const computed = dayjs(addWorkingDaysDate(planStart.toISOString(), days));
      if (computed.isValid()) {
        form.setFieldValue("plan_end_time", computed);
      }
    } catch {
      // ignore
    }
  }, [planStart, workLoad, planEndTouched, form]);

  const submit = async (submitNow: boolean) => {
    try {
      const v = await form.validateFields();
      setBusy(true);
      const payload: ProblemListCreate = {
        project_id: (v.project_id ?? "").trim(),
        project_name: problem?.project_name ?? null,
        module_id: v.module_id ?? null,
        model_name: v.model_name ?? null,
        func_name: v.func_name ?? null,
        pro_desc: v.pro_desc ?? null,
        pro_answer: v.pro_answer ?? null,
        file_urls: fileUrls,
        pro_type: v.pro_type ?? "bug",
        is_urgent: v.is_urgent ? "1" : "0",
        find_by: v.find_by ?? null,
        find_time: v.find_time ? dayStrToApi(v.find_time.format("YYYY-MM-DD")) : null,
        work_type: v.work_type ?? null,
        duty_user_id: v.duty_user_id ?? null,
        duty_user_name: null,
        plan_start_time: v.plan_start_time
          ? dayStrToApi(v.plan_start_time.format("YYYY-MM-DD"))
          : null,
        plan_end_time: v.plan_end_time
          ? dayStrToApi(v.plan_end_time.format("YYYY-MM-DD"))
          : null,
        audit_user_id: v.audit_user_id ?? null,
        remarks: v.remarks ?? null,
        work_load: v.work_load ?? null,
        submit: submitNow,
      };
      if (isEdit && problem) {
        const upd: ProblemListUpdate = {
          project_name: payload.project_name,
          module_id: payload.module_id,
          model_name: payload.model_name,
          func_name: payload.func_name,
          pro_desc: payload.pro_desc,
          pro_answer: payload.pro_answer,
          file_urls: payload.file_urls,
          pro_type: payload.pro_type,
          is_urgent: payload.is_urgent,
          find_by: payload.find_by,
          find_time: payload.find_time,
          work_type: payload.work_type,
          duty_user_id: payload.duty_user_id,
          plan_start_time: payload.plan_start_time,
          plan_end_time: payload.plan_end_time,
          audit_user_id: payload.audit_user_id,
          remarks: payload.remarks,
          work_load: payload.work_load,
        };
        if (submitNow) {
          // 先更新再推进(对照源 submitFormProcess(true)=nextProcess)
          await updateProblem(problem.id, upd);
          await nextProcessProblem(problem.id);
        } else {
          await updateProblem(problem.id, upd);
        }
        notifyOk(submitNow ? "已保存并提交审核" : "已保存");
      } else {
        await createProblem(payload);
        notifyOk(submitNow ? "已创建并提交审核" : "已保存为草稿");
      }
      onSuccess();
    } catch (err) {
      // 校验失败时 form 内部已标注;仅对 API 错误提示
      if (err instanceof ApiError) notifyErr(err, "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const dutySearchData = useMemo(
    () => ({
      pm_project_id: projectId ?? null,
      role_name: workTypeToRoleName(workType),
    }),
    [projectId, workType],
  );

  return (
    <Form<ProblemCreateValues>
      form={form}
      layout="vertical"
      initialValues={initialValues}
      onValuesChange={(changed) => {
        if ("project_id" in changed) setProjectId(changed.project_id ?? undefined);
        if ("work_type" in changed) {
          setWorkType(changed.work_type as string | undefined);
          // 切换工作类型清空责任人(对照源 @change="formData.dutyUserId = undefined")
          form.setFieldValue("duty_user_id", undefined);
        }
      }}
    >
      <Form.Item
        label="项目"
        name="project_id"
        rules={[{ required: true, message: "项目必填" }]}
      >
        <PpmUserSelect
          res="project"
          placeholder="请选择项目"
          onChange={(v) => setProjectId((v as string | null) ?? undefined)}
        />
      </Form.Item>

      {projectId && (
        <Form.Item label="关联模块名称" name="module_id">
          <Input placeholder="请输入模块 ID(可选)" />
        </Form.Item>
      )}

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

      <Form.Item label="问题答复/问题解答" name="pro_answer">
        <TextArea
          rows={2}
          placeholder="请输入问题解答(问题详细描述)"
        />
      </Form.Item>

      <Form.Item label="问题附件">
        <PpmFileUrls value={fileUrls} onChange={setFileUrls} />
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

      <Form.Item
        label="工作类型"
        name="work_type"
        rules={[{ required: true, message: "工作类型必填" }]}
      >
        <Select options={WORK_TYPE_OPTIONS} placeholder="请选择工作类型" />
      </Form.Item>

      <Form.Item
        label="责任人"
        name="duty_user_id"
        rules={[{ required: true, message: "责任人必填" }]}
      >
        <PpmUserSelect
          res="projectMember"
          searchData={dutySearchData}
          placeholder={
            projectId && workType
              ? `请选择 ${WORK_TYPE_LABEL[workType] ?? workType} 人员`
              : "请先选择项目与工作类型"
          }
          onChange={(v) => setDutyUserId((v as string | null) ?? undefined)}
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
        <DatePicker
          style={{ width: "100%" }}
          onChange={() => setPlanEndTouched(true)}
        />
      </Form.Item>

      <Form.Item label="验证人" name="audit_user_id">
        <PpmUserSelect
          res="projectMember"
          searchData={{ pm_project_id: projectId ?? null }}
          placeholder="请选择验证人(可选)"
        />
      </Form.Item>

      <Form.Item label="备注" name="remarks">
        <TextArea rows={2} placeholder="请输入备注" />
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
        <Button type="primary" loading={busy} onClick={() => void submit(false)}>
          保存
        </Button>
        <Button
          type="primary"
          loading={busy}
          onClick={() => void submit(true)}
        >
          {isEdit ? "保存并提交" : "创建并提交"}
        </Button>
      </div>
    </Form>
  );
}

interface ProblemCreateValues {
  project_id?: string;
  module_id?: string;
  model_name?: string;
  func_name?: string;
  pro_desc?: string;
  pro_answer?: string;
  func_name_unused?: string;
  pro_type?: string;
  is_urgent?: boolean;
  find_by?: string;
  find_time?: Dayjs;
  work_type?: string;
  duty_user_id?: string;
  work_load?: string;
  plan_start_time?: Dayjs;
  plan_end_time?: Dayjs;
  audit_user_id?: string;
  remarks?: string;
}

// ===========================================================================
// 2. ProblemStartForm — ListStartForm.vue (开始处置,status=3)
// ===========================================================================

export interface ProblemStartFormProps {
  problem: ProblemList;
  onSuccess: () => void;
  onCancel: () => void;
}

export function ProblemStartForm({
  problem,
  onSuccess,
  onCancel,
}: ProblemStartFormProps) {
  const [handleInfo, setHandleInfo] = useState(problem.handle_info ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (completed: boolean) => {
    setBusy(true);
    try {
      const body: ProblemDoneTaskReq = {
        handle_info: handleInfo || null,
        completed,
        time_spent: null,
      };
      await doneTaskProblem(problem.id, body);
      notifyOk(completed ? "已开始处置" : "已保存处置说明");
      onSuccess();
    } catch (err) {
      notifyErr(err, "提交失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <ProblemDescriptions problem={problem} />
      <Divider />
      <Form layout="vertical">
        <Form.Item label="开始/处置备注(对照源 startRemark)">
          <TextArea
            rows={4}
            value={handleInfo}
            onChange={(e) => setHandleInfo(e.target.value)}
            placeholder="请输入处置说明"
          />
        </Form.Item>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button onClick={onCancel}>取消</Button>
          <Button
            type="primary"
            loading={busy}
            onClick={() => void submit(true)}
          >
            开始处置
          </Button>
        </div>
      </Form>
    </div>
  );
}

// ===========================================================================
// 3. ProblemAuditForm — ListAuditForm.vue (审核,status=2)
// ===========================================================================

export interface ProblemAuditFormProps {
  problem: ProblemList;
  onSuccess: () => void;
  onCancel: () => void;
}

export function ProblemAuditForm({
  problem,
  onSuccess,
  onCancel,
}: ProblemAuditFormProps) {
  const [isBack, setIsBack] = useState<"0" | "1">("0");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [logs, loadingLogs] = useProblemLogs(problem.id);

  const submit = async () => {
    if (isBack === "1" && !comment.trim()) {
      message.warning("驳回意见不能为空");
      return;
    }
    setBusy(true);
    try {
      if (isBack === "0") {
        await nextProcessProblem(problem.id, {
          comment: comment.trim() || null,
        });
        notifyOk("已推进到下一节点");
      } else {
        await rejectProcessProblem(problem.id, { comment: comment.trim() });
        notifyOk("已驳回");
      }
      onSuccess();
    } catch (err) {
      notifyErr(err, "提交失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <ProblemDescriptions problem={problem} />
      <ProcessTimeline logs={logs} loading={loadingLogs} />
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

// ===========================================================================
// 4. ProblemDoneForm — ListDoneForm.vue (完成处置,status=3)
// ===========================================================================

export function ProblemDoneForm({
  problem,
  onSuccess,
  onCancel,
}: ProblemStartFormProps) {
  const [handleInfo, setHandleInfo] = useState(problem.handle_info ?? "");
  const [timeSpent, setTimeSpent] = useState<number | null>(
    problem.time_spent ?? null,
  );
  const [attachUrls, setAttachUrls] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [logs, loadingLogs] = useProblemLogs(problem.id);

  const submit = async (submit: boolean, completed: boolean) => {
    if (submit && !handleInfo.trim()) {
      message.warning("请输入处置情况");
      return;
    }
    if (submit && (timeSpent == null || timeSpent < 0)) {
      message.warning("请填写本次耗时");
      return;
    }
    setBusy(true);
    try {
      const body: ProblemDoneTaskReq = {
        handle_info: handleInfo || null,
        time_spent: timeSpent,
        completed,
      };
      await doneTaskProblem(problem.id, body);
      notifyOk(completed ? "已完工,进入待验证" : submit ? "已报工" : "已保存");
      onSuccess();
    } catch (err) {
      notifyErr(err, "提交失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <ProblemDescriptions problem={problem} />
      <ProcessTimeline logs={logs} loading={loadingLogs} />
      <Divider>处置</Divider>
      <Form layout="vertical">
        <Form.Item label="本次耗时(对照源 timeSpent)">
          <InputNumber
            value={timeSpent}
            onChange={(v) => setTimeSpent(v == null ? null : Number(v))}
            precision={1}
            step={0.5}
            min={0}
            addonAfter="人天"
            style={{ width: "100%" }}
          />
        </Form.Item>
        <Form.Item label="处置情况(对照源 handleInfo)">
          <TextArea
            rows={4}
            value={handleInfo}
            onChange={(e) => setHandleInfo(e.target.value)}
            placeholder="请输入处置情况"
          />
        </Form.Item>
        <Form.Item
          label="处置附件(对照源 attachGroupId)"
          extra="当前后端 DoneTask 未持久化附件,仅本次会话保留"
        >
          <PpmFileUrls value={attachUrls} onChange={setAttachUrls} />
        </Form.Item>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button onClick={onCancel}>取消</Button>
          <Button
            loading={busy}
            onClick={() => void submit(false, false)}
          >
            保存
          </Button>
          <Button
            type="default"
            loading={busy}
            onClick={() => void submit(true, false)}
          >
            报工
          </Button>
          <Button
            type="primary"
            loading={busy}
            onClick={() => void submit(true, true)}
          >
            完工
          </Button>
        </div>
      </Form>
    </div>
  );
}

// ===========================================================================
// 5. ProblemCloseForm — ListCloseForm.vue (验证关闭,status=6)
// ===========================================================================

export interface ProblemCloseFormProps {
  problem: ProblemList;
  onSuccess: () => void;
  onCancel: () => void;
}

export function ProblemCloseForm({
  problem,
  onSuccess,
  onCancel,
}: ProblemCloseFormProps) {
  const [checkTime, setCheckTime] = useState<Dayjs>(dayjs());
  const [checkResult, setCheckResult] = useState<"1" | "0">("1");
  const [checkInfo, setCheckInfo] = useState("通过");
  const [busy, setBusy] = useState(false);
  const [logs, loadingLogs] = useProblemLogs(problem.id);

  const submit = async () => {
    if (!checkInfo.trim()) {
      message.warning("请输入验证说明");
      return;
    }
    setBusy(true);
    try {
      // 注:后端 CloseTaskReq 当前不接收 check_time;前端保留 UI 供后续接入。
      void checkTime;
      const body: ProblemCloseTaskReq = {
        check_info: checkInfo,
        check_result: checkResult,
      };
      await closeTaskProblem(problem.id, body);
      notifyOk(checkResult === "1" ? "已验证通过并关闭" : "已打回处置");
      onSuccess();
    } catch (err) {
      notifyErr(err, "提交失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <ProblemDescriptions problem={problem} />
      <ProcessTimeline logs={logs} loading={loadingLogs} />
      <Divider>验证关闭</Divider>
      <Form layout="vertical">
        <Form.Item
          label="验证时间(对照源 checkTime)"
          extra="当前后端 CloseTask 未持久化验证时间,仅本次会话保留"
        >
          <DatePicker
            showTime
            value={checkTime}
            onChange={(v) => v && setCheckTime(v)}
            style={{ width: "100%" }}
          />
        </Form.Item>
        <Form.Item label="验证结果(对照源 checkResult)">
          <Radio.Group
            value={checkResult}
            onChange={(e) => setCheckResult(e.target.value as "1" | "0")}
          >
            <Radio value="1">通过(关闭)</Radio>
            <Radio value="0">不通过(打回处置)</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item label="验证说明(对照源 checkInfo)">
          <TextArea
            rows={4}
            value={checkInfo}
            onChange={(e) => setCheckInfo(e.target.value)}
            placeholder="请输入验证说明"
          />
        </Form.Item>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" loading={busy} onClick={() => void submit()}>
            确定
          </Button>
        </div>
      </Form>
    </div>
  );
}

// ===========================================================================
// 6. ProblemDetailForm — ListDetailForm.vue (详情 + 流程履历)
// ===========================================================================

export interface ProblemDetailFormProps {
  problem: ProblemList;
  logs: ProblemProcessLog[];
  loadingLogs: boolean;
  onCancel: () => void;
}

export function ProblemDetailForm({
  problem,
  logs,
  loadingLogs,
  onCancel,
}: ProblemDetailFormProps) {
  return (
    <div>
      <ProblemDescriptions problem={problem} />
      <ProcessTimeline logs={logs} loading={loadingLogs} />
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <Button onClick={onCancel}>关闭</Button>
      </div>
    </div>
  );
}

// ===========================================================================
// 共用:只读信息区(对照源 el-descriptions「问题信息」)
// ===========================================================================

function ProblemDescriptions({ problem }: { problem: ProblemList }) {
  return (
    <Descriptions
      title="问题信息"
      column={1}
      bordered
      size="small"
      labelStyle={{ width: 140 }}
    >
      <Descriptions.Item label="项目">
        {problem.project_name ?? problem.project_id}
      </Descriptions.Item>
      <Descriptions.Item label="模块">
        {problem.model_name ?? problem.module_id ?? "—"}
      </Descriptions.Item>
      <Descriptions.Item label="问题描述">
        {problem.pro_desc ?? "—"}
      </Descriptions.Item>
      <Descriptions.Item label="功能名称">
        {problem.func_name ?? "—"}
      </Descriptions.Item>
      <Descriptions.Item label="问题类型">
        {problem.pro_type ? TYPE_LABEL[problem.pro_type] ?? problem.pro_type : "—"}
      </Descriptions.Item>
      <Descriptions.Item label="是否紧急">
        {problem.is_urgent === "1" || problem.is_urgent === "是" ? "是" : "否"}
      </Descriptions.Item>
      <Descriptions.Item label="发现人/提出人">
        {problem.find_by ?? "—"}
      </Descriptions.Item>
      <Descriptions.Item label="发现日期">
        {toDayStr(problem.find_time) || "—"}
      </Descriptions.Item>
      <Descriptions.Item label="工作类型">
        {problem.work_type
          ? WORK_TYPE_LABEL[problem.work_type] ?? problem.work_type
          : "—"}
      </Descriptions.Item>
      <Descriptions.Item label="责任人">
        {problem.duty_user_name ?? problem.duty_user_id ?? "待指派"}
      </Descriptions.Item>
      <Descriptions.Item label="计划时间">
        {toDayStr(problem.plan_start_time) || "?"} ~{" "}
        {toDayStr(problem.plan_end_time) || "?"}
      </Descriptions.Item>
      <Descriptions.Item label="问题附件">
        {problem.file_urls && problem.file_urls.length > 0 ? (
          <PpmFileUrls value={problem.file_urls} disabled />
        ) : (
          <Text type="secondary">无</Text>
        )}
      </Descriptions.Item>
      <Descriptions.Item label="工作量(人/天)">
        {problem.work_load ?? "—"}
      </Descriptions.Item>
      <Descriptions.Item label="总耗时(人/天)">
        {problem.time_spent ?? "—"}
      </Descriptions.Item>
      <Descriptions.Item label="处置情况">
        {problem.handle_info ?? "—"}
      </Descriptions.Item>
      {problem.check_info && (
        <Descriptions.Item label="验证说明">
          {problem.check_info}
        </Descriptions.Item>
      )}
    </Descriptions>
  );
}

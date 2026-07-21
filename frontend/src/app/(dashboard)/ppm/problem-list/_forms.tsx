"use client";

/**
 * 问题清单表单组件 (3 态简化, 2026-07-20 对齐任务计划)。
 *
 * 审批/验证/驳回流删除后,只剩一个表单:
 *   ProblemCreateForm — 新建 / 编辑 (status=新建|进行中)
 *
 * 执行 (开始/执行/跨天填报) 不在此处,走公共弹窗 problem-detail-modal
 * (与任务计划 task-detail-modal 一致)。
 *
 * 复用:PpmUserSelect / PpmFileUrls / addWorkingDaysDate / problem.ts API。
 *
 * 设计依据:.sillyspec/changes/2026-07-20-problem-list-align-task-plan/design.md
 */
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  message,
  Select,
  Switch,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";

import { PpmFileUrls } from "@/components/ppm-file-urls";
import { PpmUserSelect } from "@/components/ppm-user-select";
import { ApiError } from "@/lib/api";
import { errMessage } from "@/lib/errors";
import {
  createProblem,
  listModulesByProject,
  updateProblem,
} from "@/lib/ppm";
import type {
  ModuleSimpleItem,
  ProblemList,
  ProblemListCreate,
  ProblemListUpdate,
} from "@/lib/ppm";
import { addWorkingDaysDate } from "@/lib/ppm/workday";

const { TextArea } = Input;

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

const WORK_TYPE_LABEL: Record<string, string> = {
  前端: "前端工作",
  后端: "后端工作",
  业务: "业务工作",
};

// ── 共享 helpers ───────────────────────────────────────────────────────────

/** 表单字符串 → 后端 nullable ISO 串(YYYY-MM-DD);空串 → null。 */
function dayStrToApi(v: string | null | undefined): string | null {
  if (!v) return null;
  return v;
}

function notifyOk(text: string) {
  message.success(text);
}

// ===========================================================================
// ProblemCreateForm — ListForm.vue (新建/编辑)
// ===========================================================================

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
  now_handle_user?: string;
  work_load?: string;
  plan_start_time?: Dayjs;
  plan_end_time?: Dayjs;
  audit_user_id?: string;
  remarks?: string;
}

export interface ProblemCreateFormProps {
  /** undefined=新建,否则编辑 (新建/进行中态均可编辑, D-003)。 */
  problem?: ProblemList;
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
  const [fileUrls, setFileUrls] = useState<string[]>(
    problem?.file_urls ?? [],
  );
  const [planEndTouched, setPlanEndTouched] = useState(false);
  // 关联模块下拉:按当前项目反查 (module_id 用,避免手输 UUID 触发 422)。
  const [modules, setModules] = useState<ModuleSimpleItem[]>([]);

  useEffect(() => {
    if (!projectId) {
      setModules([]);
      return;
    }
    let cancelled = false;
    listModulesByProject(projectId)
      .then((list) => {
        if (!cancelled) setModules(list);
      })
      .catch(() => {
        if (!cancelled) setModules([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

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
      now_handle_user: problem?.now_handle_user ?? undefined,
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

  // 3 态简化:新建即落「新建」态,无 submit/审批;编辑直接 update。
  const submit = async () => {
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
        work_load: v.work_load != null ? String(v.work_load) : null,
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
          now_handle_user: v.now_handle_user ?? null,
          plan_start_time: payload.plan_start_time,
          plan_end_time: payload.plan_end_time,
          audit_user_id: payload.audit_user_id,
          remarks: payload.remarks,
          work_load: payload.work_load,
        };
        await updateProblem(problem.id, upd);
        notifyOk("已保存");
      } else {
        await createProblem(payload);
        notifyOk("已创建");
      }
      onSuccess();
    } catch (err) {
      // 校验失败时 form 内部已标注;仅对 API 错误提示
      if (err instanceof ApiError) message.error(errMessage(err, "保存失败"));
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
        if ("project_id" in changed) {
          setProjectId(changed.project_id ?? undefined);
          // 切换项目清空关联模块(模块按项目拉,旧值在新项目下无效)
          form.setFieldValue("module_id", undefined);
        }
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

      <Form.Item label="关联模块" name="module_id">
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          disabled={!projectId}
          placeholder={projectId ? "请选择模块(可选)" : "请先选择项目"}
          notFoundContent={projectId ? "该项目暂无模块" : "请先选择项目"}
          options={modules.map((m) => ({
            value: m.id,
            label: m.module_name ?? m.id,
          }))}
        />
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
        />
      </Form.Item>

      {/* 处置人：编辑模式可调整，新建模式不展示（处置人由流程自动推进） */}
      {isEdit && (
        <Form.Item
          label="处置人"
          name="now_handle_user"
        >
          <PpmUserSelect
            res="projectMember"
            searchData={{ pm_project_id: projectId ?? null }}
            placeholder="请选择处置人（可选）"
          />
        </Form.Item>
      )}

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
        <Button type="primary" loading={busy} onClick={() => void submit()}>
          保存
        </Button>
      </div>
    </Form>
  );
}

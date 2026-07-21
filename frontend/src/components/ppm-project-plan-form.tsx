"use client";

/**
 * 项目计划 17 字段表单抽屉 (对齐源 ProjectPlanForm.vue)。
 *
 * 对照源 dept_project_front src/views/ppm/projectplan/ProjectPlanForm.vue,
 * 完整覆盖 17 个录入字段 + 两个前端派生 (countMoney / countUser):
 *
 * 基本信息:
 *   1  project_id              项目 (PpmUserSelect res=project, 选中回填 project_name + company_name)
 *   2  project_manager_id      项目经理 (PpmUserSelect res=projectMember, searchData role_name=项目经理,
 *                                回填 project_manager_name)
 *   3  project_start_time      项目开始时间 (DatePicker)
 *   4  project_plan_end_time   预计验收时间 (DatePicker)
 *   5  company_name            公司名称 (Input, 随项目联动只读)
 *
 * 合同:
 *   6  contract_sign_time      合同签订时间 (DatePicker)
 *   7  contract_name           合同名称 (Input)
 *   8  contract_amount         合同金额(含税) (InputNumber ¥)
 *
 * 利润 (countMoney 派生):
 *   9  profit_margin           公司既定利润率 (InputNumber %)
 *   10 profit_amount           公司既定利润金额 (InputNumber ¥, disabled 派生 = contract_amount * margin%)
 *
 * 预算:
 *   11 budget_amount           预算金额 (InputNumber ¥)
 *   12 budget_person_days      预算人天 (InputNumber)
 *
 * 人天 (countUser 派生):
 *   13 actual_consumption_person_days  实际花费人天 (InputNumber)
 *   14 remaining_available_person_days 剩余可用人天 (InputNumber, 派生 = budget - actual)
 *
 * 成本:
 *   15 total_cost              总成本 (InputNumber ¥)
 *   16 labor_cost              人力成本 (InputNumber ¥)
 *   17 remaining_cost          剩余成本 (InputNumber ¥, 后端 three-level 派生 = total - labor,表单可手填)
 *   (+ cost_adjustment         成本调剂)
 *   (+ adjustment_person_days  调剂人天)
 *
 * 走 AntD Drawer + Form,提交时按 create/edit 分流调用 createProjectPlan / updateProjectPlan。
 *
 * 设计依据:tasks/task-03.md §17 字段表单 + 源 ProjectPlanForm.vue。
 */
import { useEffect, useMemo, useRef } from "react";
import {
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";

import { PpmUserSelect, type PpmSelectOption } from "@/components/ppm-user-select";
import { ApiError } from "@/lib/api";
import {
  createProjectPlan,
  getProject,
  listProjectMembers,
  updateProjectPlan,
  type PsProjectPlan,
} from "@/lib/ppm";

interface FormValues {
  project_id: string;
  project_name?: string | null;
  project_manager_id?: string | null;
  project_manager_name?: string | null;
  project_start_time?: Dayjs | null;
  project_plan_end_time?: Dayjs | null;
  company_name?: string | null;
  contract_sign_time?: Dayjs | null;
  contract_name?: string | null;
  contract_amount?: number | null;
  profit_margin?: number | null;
  profit_amount?: number | null;
  budget_amount?: number | null;
  budget_person_days?: number | null;
  actual_consumption_person_days?: number | null;
  remaining_available_person_days?: number | null;
  total_cost?: number | null;
  labor_cost?: number | null;
  remaining_cost?: number | null;
  cost_adjustment?: number | null;
  adjustment_person_days?: number | null;
  module?: string | null;
}

export interface PpmProjectPlanFormProps {
  open: boolean;
  mode: "create" | "edit";
  plan?: PsProjectPlan;
  onClose: () => void;
  onSaved: () => void;
}

export function PpmProjectPlanForm({
  open,
  mode,
  plan,
  onClose,
  onSaved,
}: PpmProjectPlanFormProps) {
  const [form] = Form.useForm<FormValues>();
  const [messageApi, contextHolder] = message.useMessage();

  // 项目经理 searchData 依赖 projectId;未选项目时不传 pm_project_id
  // (后端对 '-' 会 422;PpmUserSelect 也不渲染 projectMember 选项,
  // 直接用 user fallback,见下方 res 切换)。
  const projectId = Form.useWatch("project_id", form);
  const managerSearchData = useMemo(
    () => ({
      pm_project_id: projectId || undefined,
      role_name: "项目经理",
    }),
    [projectId],
  );

  // 缓存下拉 options,供 onChange 里反查 raw(回填 project_name / company_name /
  // project_manager_name)。PpmUserSelect 的 onChange 只回传 value,不回传 options。
  const projectOptsRef = useRef<PpmSelectOption[]>([]);
  const memberOptsRef = useRef<PpmSelectOption[]>([]);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && plan) {
      form.setFieldsValue({
        project_id: plan.project_id ?? undefined,
        project_name: plan.project_name,
        project_manager_id: plan.project_manager_id,
        project_manager_name: plan.project_manager_name,
        project_start_time: plan.project_start_time
          ? dayjs(plan.project_start_time)
          : null,
        project_plan_end_time: plan.project_plan_end_time
          ? dayjs(plan.project_plan_end_time)
          : null,
        company_name: plan.company_name,
        contract_sign_time: plan.contract_sign_time
          ? dayjs(plan.contract_sign_time)
          : null,
        contract_name: plan.contract_name,
        contract_amount: numOr(plan.contract_amount),
        profit_margin: numOr(plan.profit_margin),
        profit_amount: numOr(plan.profit_amount),
        budget_amount: numOr(plan.budget_amount),
        budget_person_days: numOr(plan.budget_person_days),
        actual_consumption_person_days: numOr(
          plan.actual_consumption_person_days,
        ),
        remaining_available_person_days: numOr(
          plan.remaining_available_person_days,
        ),
        total_cost: numOr(plan.total_cost),
        labor_cost: numOr(plan.labor_cost),
        remaining_cost: numOr(plan.remaining_cost),
        cost_adjustment: numOr(plan.cost_adjustment),
        adjustment_person_days: numOr(plan.adjustment_person_days),
        module: plan.module,
      });
    } else {
      form.resetFields();
    }
  }, [open, mode, plan, form]);

  // 前端派生:利润金额 = 合同金额 × 利润率%
  const countMoney = () => {
    const contract = form.getFieldValue("contract_amount");
    const margin = form.getFieldValue("profit_margin");
    const c = typeof contract === "number" ? contract : Number(contract);
    const m = typeof margin === "number" ? margin : Number(margin);
    if (!Number.isNaN(c) && !Number.isNaN(m)) {
      form.setFieldValue("profit_amount", Math.round(c * m * 0.01 * 100) / 100);
    } else {
      form.setFieldValue("profit_amount", 0);
    }
  };

  // 前端派生:剩余可用人天 = 预算人天 - 实际花费人天
  const countUser = () => {
    const budget = form.getFieldValue("budget_person_days");
    const actual = form.getFieldValue("actual_consumption_person_days");
    const b = typeof budget === "number" ? budget : Number(budget);
    const a = typeof actual === "number" ? actual : Number(actual);
    if (!Number.isNaN(b) && !Number.isNaN(a)) {
      form.setFieldValue("remaining_available_person_days", b - a);
    } else {
      form.setFieldValue("remaining_available_person_days", 0);
    }
  };

  const handleSubmit = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const payload: Record<string, string | null> = {
      project_name: values.project_name || null,
      project_manager_id: values.project_manager_id || null,
      project_manager_name: values.project_manager_name || null,
      project_start_time: values.project_start_time
        ? values.project_start_time.format("YYYY-MM-DD")
        : null,
      project_plan_end_time: values.project_plan_end_time
        ? values.project_plan_end_time.format("YYYY-MM-DD")
        : null,
      company_name: values.company_name || null,
      contract_sign_time: values.contract_sign_time
        ? values.contract_sign_time.format("YYYY-MM-DD")
        : null,
      contract_name: values.contract_name || null,
      contract_amount: numToStr(values.contract_amount),
      profit_margin: numToStr(values.profit_margin),
      profit_amount: numToStr(values.profit_amount),
      budget_amount: numToStr(values.budget_amount),
      budget_person_days: numToStr(values.budget_person_days),
      actual_consumption_person_days: numToStr(
        values.actual_consumption_person_days,
      ),
      remaining_available_person_days: numToStr(
        values.remaining_available_person_days,
      ),
      total_cost: numToStr(values.total_cost),
      labor_cost: numToStr(values.labor_cost),
      remaining_cost: numToStr(values.remaining_cost),
      cost_adjustment: numToStr(values.cost_adjustment),
      adjustment_person_days: numToStr(values.adjustment_person_days),
      module: values.module || null,
    };

    try {
      if (mode === "create") {
        if (!values.project_id?.trim()) {
          messageApi.error("请选择项目");
          return;
        }
        await createProjectPlan({
          project_id: values.project_id.trim(),
          ...payload,
        });
        messageApi.success("创建成功");
      } else if (plan) {
        await updateProjectPlan(plan.id, payload);
        messageApi.success("更新成功");
      }
      onSaved();
    } catch (e) {
      messageApi.error(e instanceof ApiError ? e.message : "保存失败");
    }
  };

  return (
    <Modal
      title={mode === "create" ? "新建项目计划" : "编辑项目计划"}
      open={open}
      onCancel={onClose}
      width={920}
      maskClosable={false}
      destroyOnClose
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>
            取消
          </Button>
          <Button type="primary" onClick={() => void handleSubmit()}>
            确定
          </Button>
        </div>
      }
    >
      {contextHolder}
      <Form<FormValues>
        form={form}
        layout="vertical"
        requiredMark
      >
        {/* 基本信息 */}
        <FormSection title="基本信息">
          <Row2>
            <Form.Item
              label="项目名称"
              name="project_id"
              rules={[{ required: true, message: "请选择项目" }]}
            >
              <PpmUserSelect
                res="project"
                placeholder="请选择项目"
                onLoadedOptions={(opts) => (projectOptsRef.current = opts)}
                onChange={(value) =>
                  onProjectChange(form, value, projectOptsRef.current)
                }
              />
            </Form.Item>
            <Form.Item
              label="项目经理名称"
              name="project_manager_id"
              rules={[{ required: true, message: "请选择项目经理" }]}
            >
              <PpmUserSelect
                res={projectId ? "projectMember" : "user"}
                placeholder={
                  projectId ? "请选择项目经理" : "请先选择项目,再选择项目经理"
                }
                searchData={managerSearchData}
                onLoadedOptions={(opts) => (memberOptsRef.current = opts)}
                onChange={(value) =>
                  onManagerChange(form, value, memberOptsRef.current)
                }
              />
            </Form.Item>
          </Row2>
          <Row2>
            <Form.Item label="项目开始时间" name="project_start_time">
              <DatePicker style={{ width: "100%" }} placeholder="选择项目开始时间" />
            </Form.Item>
            <Form.Item label="预计验收时间" name="project_plan_end_time">
              <DatePicker style={{ width: "100%" }} placeholder="选择预计验收时间" />
            </Form.Item>
          </Row2>
          <Form.Item label="公司名称" name="company_name">
            <Input placeholder="随项目自动带出" disabled />
          </Form.Item>
        </FormSection>

        {/* 合同信息 */}
        <FormSection title="合同信息">
          <Row2>
            <Form.Item label="合同名称" name="contract_name">
              <Input placeholder="请输入合同名称" />
            </Form.Item>
            <Form.Item label="合同签订时间" name="contract_sign_time">
              <DatePicker style={{ width: "100%" }} placeholder="选择合同签订时间" />
            </Form.Item>
          </Row2>
          <Form.Item label="合同金额(含税)" name="contract_amount">
            <InputNumber
              style={{ width: "100%" }}
              precision={2}
              step={1}
              min={0}
              addonBefore="¥"
              placeholder="请输入"
              onChange={() => countMoney()}
            />
          </Form.Item>
        </FormSection>

        {/* 利润信息 */}
        <FormSection title="利润信息">
          <Row2>
            <Form.Item label="公司既定利润率" name="profit_margin">
              <InputNumber
                style={{ width: "100%" }}
                precision={2}
                step={1}
                min={0}
                max={100}
                addonAfter="%"
                placeholder="请输入"
                onChange={() => countMoney()}
              />
            </Form.Item>
            <Form.Item label="公司既定利润金额" name="profit_amount">
              <InputNumber
                style={{ width: "100%" }}
                precision={2}
                step={1}
                min={0}
                addonBefore="¥"
                placeholder="自动计算"
                disabled
              />
            </Form.Item>
          </Row2>
        </FormSection>

        {/* 预算信息 */}
        <FormSection title="预算信息">
          <Row2>
            <Form.Item label="预算金额" name="budget_amount">
              <InputNumber
                style={{ width: "100%" }}
                precision={2}
                step={1}
                min={0}
                addonBefore="¥"
                placeholder="请输入"
              />
            </Form.Item>
            <Form.Item label="预算人天" name="budget_person_days">
              <InputNumber
                style={{ width: "100%" }}
                step={1}
                min={0}
                addonAfter="人/天"
                placeholder="请输入"
                onChange={() => countUser()}
              />
            </Form.Item>
          </Row2>
          <Row2>
            <Form.Item label="实际花费人天" name="actual_consumption_person_days">
              <InputNumber
                style={{ width: "100%" }}
                step={1}
                min={0}
                addonAfter="人/天"
                placeholder="请输入"
                onChange={() => countUser()}
              />
            </Form.Item>
            <Form.Item label="剩余可用人天" name="remaining_available_person_days">
              <InputNumber
                style={{ width: "100%" }}
                step={1}
                addonAfter="人/天"
                placeholder="自动计算"
              />
            </Form.Item>
          </Row2>
        </FormSection>

        {/* 成本信息 */}
        <FormSection title="成本信息">
          <Row2>
            <Form.Item label="总成本" name="total_cost">
              <InputNumber
                style={{ width: "100%" }}
                precision={2}
                step={1}
                min={0}
                addonBefore="¥"
                placeholder="请输入"
              />
            </Form.Item>
            <Form.Item label="人力成本" name="labor_cost">
              <InputNumber
                style={{ width: "100%" }}
                precision={2}
                step={1}
                min={0}
                addonBefore="¥"
                placeholder="请输入"
              />
            </Form.Item>
          </Row2>
          <Row2>
            <Form.Item label="剩余成本" name="remaining_cost">
              <InputNumber
                style={{ width: "100%" }}
                precision={2}
                step={1}
                addonBefore="¥"
                placeholder="请输入"
              />
            </Form.Item>
            <Form.Item label="成本调剂" name="cost_adjustment">
              <InputNumber
                style={{ width: "100%" }}
                precision={2}
                step={1}
                placeholder="请输入"
              />
            </Form.Item>
          </Row2>
          <Form.Item label="调剂人天" name="adjustment_person_days">
            <InputNumber
              style={{ width: "100%" }}
              step={1}
              min={0}
              addonAfter="人/天"
              placeholder="请输入"
            />
          </Form.Item>
          <Form.Item label="模块" name="module">
            <Input.TextArea rows={2} placeholder="请输入模块" />
          </Form.Item>
        </FormSection>
      </Form>
    </Modal>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────

function numOr(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function numToStr(v: number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

// 项目切换:回填 project_name(下拉 options 直出)+ company_name(getProject 详情,
// simple-list 不含公司名,故原回填本就不生效);项目经理先清空,若该项目只有
// 唯一项目经理则自动带入(listProjectMembers 复用 ilike 过滤,命中单角色 +
// 多角色逗号拼接的成员)。第三参数 _opts 为 onLoadedOptions 预留位。
async function onProjectChange(
  form: ReturnType<typeof Form.useForm<FormValues>>[0],
  value: string | string[] | null,
  _opts?: PpmSelectOption[],
) {
  const id = Array.isArray(value) ? value[0] : value;
  const opt = _opts?.find((o) => o.value === id);
  const raw = opt?.raw as { project_name?: string } | undefined;
  // 先用 options 直出值同步重置联动字段,清掉上一个项目的残留。
  form.setFieldValue("project_name", raw?.project_name ?? id ?? null);
  form.setFieldValue("company_name", null);
  form.setFieldValue("project_manager_id", undefined);
  form.setFieldValue("project_manager_name", undefined);
  if (!id) return;
  // 并行查项目详情(含公司名)+ 该项目项目经理;公司名回填,项目经理唯一则带入。
  try {
    const [project, managers] = await Promise.all([
      getProject(id),
      listProjectMembers({ pm_project_id: id, role_name: "项目经理" }),
    ]);
    form.setFieldValue("company_name", project.company_name ?? null);
    if (managers.length === 1) {
      const m = managers[0];
      if (m) {
        form.setFieldValue("project_manager_id", m.user_id);
        form.setFieldValue("project_manager_name", m.user_name ?? m.user_id);
      }
    }
  } catch {
    // 查询失败不阻断选项目:公司名/项目经理保持已重置的空值。
  }
}

// 项目经理切换:回填 project_manager_name(对齐源 change-data 回填 name)。
function onManagerChange(
  form: ReturnType<typeof Form.useForm<FormValues>>[0],
  value: string | string[] | null,
  opts?: PpmSelectOption[],
) {
  const id = Array.isArray(value) ? value[0] : value;
  const opt = opts?.find((o) => o.value === id);
  form.setFieldValue(
    "project_manager_name",
    opt?.label ?? id ?? null,
  );
}

// ── 局部布局 helper ───────────────────────────────────────────────────────

function FormSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="mb-2 border-b border-border pb-1 text-xs font-medium text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function Row2({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {children}
    </div>
  );
}

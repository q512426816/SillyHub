"use client";

/**
 * 项目计划 17 字段表单抽屉 (task-03)。
 *
 * 从 project-plans/page.tsx 的内联 PlanFormDrawer 抽出,补齐到 17 个录入字段
 * (对照 task-03.md 字段清单 + 后端 PsProjectPlanBase)。派生字段
 * remaining_* 与系统字段 id/created_at/updated_at/create_name 不进表单。
 *
 * 分段 (对齐源 Vue 主表):
 *  - 基本信息区 (1-6, 17)
 *  - 合同信息区 (7-9)
 *  - 成本信息区 (10-15)
 *  - 状态 (16)
 *
 * 走 AntD Drawer + Form,提交时按 create/edit 分流调用
 * createProjectPlan / updateProjectPlan。
 *
 * 设计依据:tasks/task-03.md §17 字段表单。
 */
import { useEffect } from "react";
import {
  DatePicker,
  Drawer,
  Form,
  Input,
  Select,
  message,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  createProjectPlan,
  updateProjectPlan,
  type PsProjectPlan,
} from "@/lib/ppm";

const STATUS_OPTIONS = [
  { label: "草稿 (draft)", value: "draft" },
  { label: "审批中 (approving)", value: "approving" },
  { label: "已完成 (done)", value: "done" },
];

interface FormValues {
  project_id: string;
  project_name?: string | null;
  project_manager_id?: string | null;
  project_manager_name?: string | null;
  project_start_time?: Dayjs | null;
  project_plan_end_time?: Dayjs | null;
  contract_sign_time?: Dayjs | null;
  contract_name?: string | null;
  contract_amount?: string | null;
  profit_margin?: string | null;
  profit_amount?: string | null;
  module?: string | null;
  budget_amount?: string | null;
  budget_person_days?: string | null;
  actual_consumption_person_days?: string | null;
  status?: string;
  company_name?: string | null;
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

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && plan) {
      form.setFieldsValue({
        project_id: plan.project_id,
        project_name: plan.project_name,
        project_manager_id: plan.project_manager_id,
        project_manager_name: plan.project_manager_name,
        project_start_time: plan.project_start_time
          ? dayjs(plan.project_start_time)
          : null,
        project_plan_end_time: plan.project_plan_end_time
          ? dayjs(plan.project_plan_end_time)
          : null,
        contract_sign_time: plan.contract_sign_time
          ? dayjs(plan.contract_sign_time)
          : null,
        contract_name: plan.contract_name,
        contract_amount: plan.contract_amount,
        profit_margin: plan.profit_margin,
        profit_amount: plan.profit_amount,
        module: plan.module,
        budget_amount: plan.budget_amount,
        budget_person_days: plan.budget_person_days,
        actual_consumption_person_days: plan.actual_consumption_person_days,
        status: plan.status,
        company_name: plan.company_name,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ status: "draft" });
    }
  }, [open, mode, plan, form]);

  const handleSubmit = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // 校验失败,Form 自带提示
    }

    // 日期转字符串;非日期字段直传 (源 String 语义)
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
      contract_sign_time: values.contract_sign_time
        ? values.contract_sign_time.format("YYYY-MM-DD")
        : null,
      contract_name: values.contract_name || null,
      contract_amount: values.contract_amount || null,
      profit_margin: values.profit_margin || null,
      profit_amount: values.profit_amount || null,
      module: values.module || null,
      budget_amount: values.budget_amount || null,
      budget_person_days: values.budget_person_days || null,
      actual_consumption_person_days:
        values.actual_consumption_person_days || null,
      status: values.status ?? "draft",
      company_name: values.company_name || null,
    };

    try {
      if (mode === "create") {
        if (!values.project_id?.trim()) {
          messageApi.error("项目 ID 必填");
          return;
        }
        await createProjectPlan({
          project_id: values.project_id.trim(),
          ...payload,
        });
      } else if (plan) {
        await updateProjectPlan(plan.id, payload);
      }
      onSaved();
    } catch (e) {
      messageApi.error(e instanceof ApiError ? e.message : "保存失败");
    }
  };

  return (
    <Drawer
      title={mode === "create" ? "新建项目计划" : "编辑项目计划"}
      open={open}
      onClose={onClose}
      width={640}
      destroyOnClose
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" onClick={() => void handleSubmit()}>
            保存
          </Button>
        </div>
      }
    >
      {contextHolder}
      <Form<FormValues>
        form={form}
        layout="vertical"
        requiredMark
        initialValues={{ status: "draft" }}
      >
        {/* 基本信息 */}
        <FormSection title="基本信息">
          <Form.Item
            label="项目 ID"
            name="project_id"
            rules={[{ required: true, message: "请输入项目 ID" }]}
          >
            <Input placeholder="项目 ID" disabled={mode === "edit"} />
          </Form.Item>
          <Row2>
            <Form.Item label="项目名称" name="project_name">
              <Input placeholder="项目名称" />
            </Form.Item>
            <Form.Item label="公司名称" name="company_name">
              <Input placeholder="公司名称" />
            </Form.Item>
          </Row2>
          <Row2>
            <Form.Item label="项目经理" name="project_manager_name">
              <Input placeholder="项目经理姓名" />
            </Form.Item>
            <Form.Item label="项目经理 ID" name="project_manager_id">
              <Input placeholder="项目经理 ID" />
            </Form.Item>
          </Row2>
          <Row2>
            <Form.Item label="项目开始时间" name="project_start_time">
              <DatePicker style={{ width: "100%" }} placeholder="选择日期" />
            </Form.Item>
            <Form.Item label="计划结束时间" name="project_plan_end_time">
              <DatePicker style={{ width: "100%" }} placeholder="选择日期" />
            </Form.Item>
          </Row2>
        </FormSection>

        {/* 合同信息 */}
        <FormSection title="合同信息">
          <Row2>
            <Form.Item label="合同名称" name="contract_name">
              <Input placeholder="合同名称" />
            </Form.Item>
            <Form.Item label="合同签订时间" name="contract_sign_time">
              <DatePicker style={{ width: "100%" }} placeholder="选择日期" />
            </Form.Item>
          </Row2>
          <Form.Item label="合同金额" name="contract_amount">
            <Input placeholder="合同金额" />
          </Form.Item>
        </FormSection>

        {/* 成本信息 */}
        <FormSection title="成本信息">
          <Row2>
            <Form.Item label="利润率" name="profit_margin">
              <Input placeholder="利润率" />
            </Form.Item>
            <Form.Item label="利润金额" name="profit_amount">
              <Input placeholder="利润金额" />
            </Form.Item>
          </Row2>
          <Row2>
            <Form.Item label="预算金额" name="budget_amount">
              <Input placeholder="预算金额" />
            </Form.Item>
            <Form.Item label="预算人天" name="budget_person_days">
              <Input placeholder="预算人天" />
            </Form.Item>
          </Row2>
          <Row2>
            <Form.Item label="实际消耗人天" name="actual_consumption_person_days">
              <Input placeholder="实际消耗人天" />
            </Form.Item>
            <Form.Item label="状态" name="status">
              <Select options={STATUS_OPTIONS} />
            </Form.Item>
          </Row2>
          <Form.Item label="模块" name="module">
            <Input.TextArea rows={2} placeholder="模块说明" />
          </Form.Item>
        </FormSection>
      </Form>
    </Drawer>
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

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AutoComplete,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
} from "antd";
import { PpmUserSelect } from "@/components/ppm-user-select";
import { ApiError } from "@/lib/api";
import {
  createPsPlanNode,
  listPlanNodes,
  updatePsPlanNode,
  type PlanNode,
  type PsPlanNode,
} from "@/lib/ppm";
import { fromDate, toDay } from "@/components/ppm/milestone/milestone-helpers";

// ---------------------------------------------------------------------------
// P0-7:里程碑主表(PsPlanNode)CRUD 抽屉,对照源 PsPlanNodeForm.vue 7 字段
// (no / overallStage / dutyUserId / taskTheme / planWorkload /
//  planBeginTime / planCompleteTime)。
// ---------------------------------------------------------------------------

interface PsPlanNodeVals {
  no?: string | null;
  overall_stage?: string | null;
  duty_user_id?: string | null;
  task_theme?: string | null;
  plan_workload?: string | null;
  plan_begin_time?: string | null;
  plan_complete_time?: string | null;
}

export function PsPlanNodeDrawer({
  open,
  mode,
  node,
  planId,
  projectId,
  nextNo,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: "create" | "edit";
  node?: PsPlanNode;
  planId: string;
  projectId: string | null;
  nextNo: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<PsPlanNodeVals>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 总体阶段下拉候选:计划节点模板(PlanNode)的 overall_stage 去重。
  // AutoComplete 仍可手动输入不在模板里的值(不匹配模板即纯文本提交)。
  const [stageOptions, setStageOptions] = useState<{ value: string }[]>([]);

  const initialValues = useMemo<PsPlanNodeVals>(
    () => ({
      no: node?.no ?? (mode === "create" ? nextNo : ""),
      overall_stage: node?.overall_stage ?? "",
      duty_user_id: node?.duty_user_id ?? "",
      task_theme: node?.task_theme ?? "",
      plan_workload: node?.plan_workload ?? "",
      plan_begin_time: node?.plan_begin_time ?? "",
      plan_complete_time: node?.plan_complete_time ?? "",
    }),
    [node, mode, nextNo],
  );

  useEffect(() => {
    if (open) form.setFieldsValue(initialValues);
  }, [form, initialValues, open]);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const nodes = await listPlanNodes({ page_size: 200 });
        const stages = Array.from(
          new Set(
            nodes
              .map((n: PlanNode) => n.overall_stage)
              .filter((s): s is string => Boolean(s)),
          ),
        );
        setStageOptions(stages.map((s) => ({ value: s })));
      } catch {
        // 静默:加载失败时下拉为空,仍可手动输入
      }
    })();
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const vals = await form.validateFields();
      const body = {
        no: (vals.no as string) || null,
        overall_stage: (vals.overall_stage as string) || null,
        duty_user_id: (vals.duty_user_id as string) || null,
        task_theme: (vals.task_theme as string) || null,
        plan_workload:
          vals.plan_workload != null && vals.plan_workload !== ""
            ? String(vals.plan_workload)
            : null,
        plan_begin_time: (vals.plan_begin_time as string) || null,
        plan_complete_time: (vals.plan_complete_time as string) || null,
      };
      if (mode === "create") {
        await createPsPlanNode({ ps_project_plan_id: planId, ...body });
      } else if (node) {
        await updatePsPlanNode(node.id, body);
      }
      onSaved();
    } catch (e) {
      if (e instanceof ApiError) {
        setErr(e.message);
      } else if (e && typeof e === "object" && "errorFields" in e) {
        // AntD 校验失败,字段下已提示
      } else {
        setErr("保存失败");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={mode === "create" ? "新建里程碑" : "编辑里程碑"}
      open={open}
      onCancel={onClose}
      width={640}
      destroyOnClose
      maskClosable={false}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>关闭</Button>
          <Button type="primary" loading={busy} onClick={() => void submit()}>
            保存
          </Button>
        </div>
      }
    >
      <Form<PsPlanNodeVals> form={form} layout="vertical" initialValues={initialValues}>
        <div className="grid grid-cols-2 gap-3">
          <Form.Item
            label="序号"
            name="no"
            rules={[{ required: true, message: "请输入序号" }]}
          >
            <Input placeholder="如 1" />
          </Form.Item>
          <Form.Item
            label="总体阶段"
            name="overall_stage"
            rules={[{ required: true, message: "请输入总体阶段" }]}
          >
            <AutoComplete
              options={stageOptions}
              filterOption={(input, option) =>
                (option?.value ?? "").toLowerCase().includes(input.toLowerCase())
              }
              allowClear
              placeholder="如 实施阶段"
            />
          </Form.Item>
        </div>
        <Form.Item
          label="责任人"
          name="duty_user_id"
          rules={[{ required: true, message: "请选择责任人" }]}
        >
          {projectId ? (
            <PpmUserSelect
              res="projectMember"
              searchData={{ pm_project_id: projectId }}
              allowClear
              placeholder="选择责任人"
            />
          ) : (
            <Input placeholder="责任人 ID" />
          )}
        </Form.Item>
        <div className="grid grid-cols-2 gap-3">
          <Form.Item label="任务主题" name="task_theme">
            <Input placeholder="请输入任务主题" />
          </Form.Item>
          <Form.Item
            label="预计工作量"
            name="plan_workload"
            rules={[{ required: true, message: "请输入预计工作量" }]}
          >
            <InputNumber
              placeholder="如 5(工作日)"
              step={0.5}
              precision={1}
              min={0}
              className="w-full"
              style={{ width: "100%" }}
            />
          </Form.Item>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Form.Item
            label="计划开始时间"
            name="plan_begin_time"
            getValueProps={(v) => ({ value: toDay(v) })}
            normalize={(d) => fromDate(d)}
            rules={[{ required: true, message: "请选择计划开始时间" }]}
          >
            <DatePicker className="w-full" format="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item
            label="计划完成时间"
            name="plan_complete_time"
            getValueProps={(v) => ({ value: toDay(v) })}
            normalize={(d) => fromDate(d)}
            rules={[{ required: true, message: "请选择计划完成时间" }]}
          >
            <DatePicker className="w-full" format="YYYY-MM-DD" />
          </Form.Item>
        </div>
      </Form>
      {err && <p className="mt-2 text-[11px] text-destructive">{err}</p>}
    </Modal>
  );
}

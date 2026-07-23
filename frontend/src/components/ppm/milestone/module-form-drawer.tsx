"use client";

import { useEffect } from "react";
import { Button, DatePicker, Form, Input, InputNumber, Modal } from "antd";
import { PpmUserSelect } from "@/components/ppm-user-select";
import type { PlanNodeModule } from "@/lib/ppm";
import { fromDate, toDay } from "@/components/ppm/milestone/milestone-helpers";

// ---------------------------------------------------------------------------
// P2-2:模块 CRUD 抽屉(对照源 PlanNodeModuleForm.vue)
// 字段:moduleName / planWorkload(InputNumber step=0.5)/ planBeginTime /
//       planCompleteTime(DatePicker YYYY-MM-DD)/ dutyUserId(PpmUserSelect)
// ---------------------------------------------------------------------------

interface ModuleFormDrawerProps {
  open: boolean;
  mode: "create" | "edit";
  module?: PlanNodeModule;
  projectId: string | null;
  saving: boolean;
  onClose: () => void;
  onSave: (vals: {
    module_name: string | null;
    plan_workload: string | null;
    plan_begin_time: string | null;
    plan_complete_time: string | null;
    duty_user_id: string | null;
  }) => void;
}

export function ModuleFormDrawer({
  open,
  mode,
  module: moduleRow,
  projectId,
  saving,
  onClose,
  onSave,
}: ModuleFormDrawerProps) {
  const [form] = Form.useForm<{
    module_name: string;
    plan_workload: string;
    plan_begin_time: string;
    plan_complete_time: string;
    duty_user_id: string;
  }>();

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      module_name: moduleRow?.module_name ?? "",
      plan_workload: moduleRow?.plan_workload ?? "",
      plan_begin_time: moduleRow?.plan_begin_time ?? "",
      plan_complete_time: moduleRow?.plan_complete_time ?? "",
      duty_user_id: moduleRow?.duty_user_id ?? "",
    });
  }, [open, moduleRow, form]);

  const submit = async () => {
    const vals = await form.validateFields();
    onSave({
      module_name: vals.module_name || null,
      plan_workload:
        vals.plan_workload != null && vals.plan_workload !== ""
          ? String(vals.plan_workload)
          : null,
      plan_begin_time: vals.plan_begin_time || null,
      plan_complete_time: vals.plan_complete_time || null,
      duty_user_id: vals.duty_user_id || null,
    });
  };

  return (
    <Modal
      open={open}
      title={mode === "create" ? "新建模块" : "编辑模块"}
      width={520}
      onCancel={onClose}
      destroyOnClose
      maskClosable={false}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={() => void submit()}>
            保存
          </Button>
        </div>
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label="模块名称"
          name="module_name"
          rules={[{ required: true, message: "请输入模块名称" }]}
        >
          <Input placeholder="如:需求分析模块" />
        </Form.Item>
        <Form.Item label="计划工作量(工作日)" name="plan_workload">
          <InputNumber
            placeholder="如 5"
            step={0.5}
            precision={1}
            min={0}
            className="w-full"
            style={{ width: "100%" }}
          />
        </Form.Item>
        <div className="grid grid-cols-2 gap-3">
          <Form.Item
            label="计划开始时间"
            name="plan_begin_time"
            getValueProps={(v) => ({ value: toDay(v) })}
            normalize={(d) => fromDate(d)}
          >
            <DatePicker className="w-full" format="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item
            label="计划完成时间"
            name="plan_complete_time"
            getValueProps={(v) => ({ value: toDay(v) })}
            normalize={(d) => fromDate(d)}
          >
            <DatePicker className="w-full" format="YYYY-MM-DD" />
          </Form.Item>
        </div>
        <Form.Item label="责任人" name="duty_user_id">
          {projectId ? (
            <PpmUserSelect
              res="projectMember"
              searchData={{ pm_project_id: projectId }}
              allowClear
              placeholder="选择责任人(项目成员)"
            />
          ) : (
            <Input placeholder="需要先选择项目" disabled />
          )}
        </Form.Item>
      </Form>
    </Modal>
  );
}

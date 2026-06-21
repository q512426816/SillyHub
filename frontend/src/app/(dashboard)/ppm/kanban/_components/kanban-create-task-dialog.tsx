"use client";

/**
 * KanbanCreateTaskDialog — 对齐源 `CreateTaskDialog.vue`。
 *
 * 表单字段(本仓 PlanTask 模型约束,非源全字段):
 *  - 任务标题 (content,必填)
 *  - 任务描述:并入 content(本仓无独立 description 字段,沿用 task-detail-drawer
 *    内联编辑 title 的语义,描述可合并到 content 多行)
 *  - 所属项目 (project_id + project_name via PpmUserSelect res=project)
 *  - 负责人 (user_id via PpmUserSelect res=projectMember)
 *  - 截止时间 (end_time)
 *  - 预估工时 (work_load 字符串,本仓 PlanTask.work_load)
 *
 * 字段差异:源有 priority(单选)+ progress(滑块);本仓 PlanTask 无这两个字段,
 * 故不渲染。提交 → store.createTask + success 回调(父级刷新已在 store action 内)。
 */
import { useEffect, useState } from "react";
import { DatePicker, Form, Input, InputNumber, Modal, message } from "antd";

import { PpmUserSelect } from "@/components/ppm-user-select";
import { ApiError } from "@/lib/api";
import { useKanbanStore } from "@/stores/kanban";
import type { KanbanTaskCreateReq } from "@/lib/ppm/types";

interface FormValues {
  title: string;
  description?: string;
  projectId?: string;
  assigneeId?: string;
  endTime?: Date;
  estimateHours?: number;
}

export function KanbanCreateTaskDialog({
  open,
  defaultAssigneeId,
  onClose,
  onSuccess,
}: {
  open: boolean;
  defaultAssigneeId?: string;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const createTask = useKanbanStore((s) => s.createTask);

  // 打开时重置 + 预填负责人(对齐源 watch visible + assigneeId)
  useEffect(() => {
    if (open) {
      form.resetFields();
      form.setFieldsValue({
        title: "",
        description: "",
        projectId: undefined,
        assigneeId: defaultAssigneeId,
        endTime: undefined,
        estimateHours: 8,
      });
    }
  }, [open, defaultAssigneeId, form]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);

      // content:标题 + 描述(本仓无独立 description 字段,合并)
      const content = values.description?.trim()
        ? `${values.title.trim()}\n\n${values.description.trim()}`
        : values.title.trim();

      const req: KanbanTaskCreateReq = {
        content,
        user_id: values.assigneeId ?? null,
        project_id: values.projectId ?? null,
        end_time: values.endTime ? values.endTime.toISOString() : null,
        work_load:
          values.estimateHours != null
            ? String(values.estimateHours)
            : null,
      };

      await createTask(req);
      void message.success("任务创建成功");
      onSuccess?.();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        void message.error(err.message || "创建任务失败");
      }
      // validateFields 抛出的字段错误由 Form 自身展示,无需处理
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="创建任务"
      open={open}
      onOk={handleSubmit}
      onCancel={onClose}
      confirmLoading={submitting}
      okText="创建"
      cancelText="取消"
      destroyOnHidden
      width={600}
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          name="title"
          label="任务标题"
          rules={[
            { required: true, message: "请输入任务标题" },
            { min: 2, max: 100, message: "长度在 2 到 100 个字符" },
          ]}
        >
          <Input placeholder="请输入任务标题" maxLength={100} showCount />
        </Form.Item>

        <Form.Item name="description" label="任务描述">
          <Input.TextArea rows={4} placeholder="请输入任务描述" maxLength={500} showCount />
        </Form.Item>

        <Form.Item name="projectId" label="所属项目">
          <PpmUserSelect res="project" placeholder="请选择项目" allowClear />
        </Form.Item>

        <Form.Item name="assigneeId" label="负责人">
          <PpmUserSelect res="projectMember" placeholder="请选择负责人" allowClear />
        </Form.Item>

        <Form.Item name="endTime" label="截止时间">
          <DatePicker
            showTime
            style={{ width: "100%" }}
            format="YYYY-MM-DD HH:mm"
            placeholder="请选择截止时间"
          />
        </Form.Item>

        <Form.Item name="estimateHours" label="预估工时(小时)">
          <InputNumber min={0.5} max={100} step={0.5} style={{ width: "100%" }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default KanbanCreateTaskDialog;

"use client";

/**
 * KanbanEditTaskDialog — 对齐源 `EditTaskDialog.vue`。
 *
 * 预填选中任务 → updateKanbanTask(本仓 task update 仅支持 content/status/
 * work_load/end_time/file_urls;不支持改 project_id/assigneeId,这两个走
 * 专门的 assign dialog + 拖拽)。
 *
 * 字段差异:源可改 project/assignee/priority/status;本仓 update 只暴露 status +
 * content + deadline + hours。project/assignee 的编辑通过 AssignTaskDialog +
 * 拖拽完成(对齐源分离职责)。
 */
import { useEffect, useState } from "react";
import { DatePicker, Form, Input, InputNumber, Modal, Select, message } from "antd";
import dayjs, { type Dayjs } from "dayjs";

import { ApiError } from "@/lib/api";
import { updateKanbanTask } from "@/lib/ppm/kanban";
import type { KanbanTaskCard } from "@/lib/ppm/types";

const STATUS_OPTIONS = [
  { label: "未开始", value: "未开始" },
  { label: "进行中", value: "进行中" },
  { label: "已完成", value: "已完成" },
];

interface FormValues {
  title: string;
  status: string;
  endTime?: Dayjs;
  estimateHours?: number;
}

export function KanbanEditTaskDialog({
  open,
  task,
  onClose,
  onSuccess,
}: {
  open: boolean;
  task: KanbanTaskCard | null;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);

  // 打开 + task 变化 → 预填(对齐源 watch visible + loadTaskData)
  useEffect(() => {
    if (open && task) {
      // 标题/描述:本仓把标题塞 content 首行;编辑只取首行作 title(对齐 detail drawer 语义)
      const titleLine = (task.title ?? "").split("\n\n")[0] ?? "";
      form.setFieldsValue({
        title: titleLine,
        status: task.status ?? "未开始",
        endTime: task.deadline ? dayjs(task.deadline) : undefined,
        estimateHours: task.estimate_hours ?? 8,
      });
    }
  }, [open, task, form]);

  const handleSubmit = async () => {
    if (!task) return;
    try {
      const values = await form.validateFields();
      setSubmitting(true);

      await updateKanbanTask({
        task_id: task.id,
        content: values.title.trim(),
        status: values.status,
        end_time: values.endTime ? values.endTime.toISOString() : null,
        work_load:
          values.estimateHours != null ? String(values.estimateHours) : null,
      });

      void message.success("任务更新成功");
      onSuccess?.();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        void message.error(err.message || "更新任务失败");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="编辑任务"
      open={open}
      onOk={handleSubmit}
      onCancel={onClose}
      confirmLoading={submitting}
      okText="保存"
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

        <Form.Item name="status" label="状态" rules={[{ required: true }]}>
          <Select options={STATUS_OPTIONS} placeholder="请选择状态" />
        </Form.Item>

        <Form.Item name="endTime" label="截止时间">
          <DatePicker
            showTime
            style={{ width: "100%" }}
            format="YYYY-MM-DD HH:mm"
            placeholder="请选择截止时间"
          />
        </Form.Item>

        <Form.Item name="estimateHours" label="预估工时(人天)">
          <InputNumber min={0.5} max={100} step={0.5} style={{ width: "100%" }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default KanbanEditTaskDialog;

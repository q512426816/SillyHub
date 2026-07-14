"use client";

/**
 * WorkbenchTaskTable — 个人工作台任务操作表。
 *
 * 中栏「我的任务」:复用 personal-task-plan 接口数据(lib/ppm/task.ts)。
 * **不重写任务接口(D-005@v1)**,数据由 task-08 page.tsx 调 listPersonalPlanTasks
 * 装配后 props 下传,本组件只渲染 + 操作。
 *
 * 列(参照原型 + task-plans/page.tsx columns 范式):
 *   序号 / 项目名(project_name) / 模块(module_name) / 任务内容(content) /
 *   状态(taskStatusTag) / 操作
 *
 * 「执行」按钮打开任务执行表单(共享 ExecuteTaskDialog),填写本次耗时 +
 * 执行情况说明 + 是否提交到已完成,确认后调 executePlanTask。**不走一键直接
 * 完成** —— 必须经执行表单留下执行记录(耗时/说明),对齐 task-plans 交互与
 * 生产要求。已完成(status==="已完成")任务禁用按钮。
 */
import { useState } from "react";
import { Tag, type TableProps } from "antd";

import { DataTable } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { executePlanTask } from "@/lib/ppm/task";
import type { PlanTask } from "@/lib/ppm/types";
import {
  ExecuteTaskDialog,
  type ExecuteTaskState,
} from "../../_components/execute-task-dialog";
import { Toast, taskStatusTag, useToast } from "../../shared";

export interface WorkbenchTaskTableProps {
  /** 当前人任务列表(由 page.tsx 调 listPersonalPlanTasks 装配后下传)。 */
  tasks: PlanTask[];
  /** 加载态。 */
  loading?: boolean;
  /** 操作完成后回调(page.tsx 重载任务列表)。 */
  onChanged: () => void;
}

export function WorkbenchTaskTable({
  tasks,
  loading,
  onChanged,
}: WorkbenchTaskTableProps) {
  // 执行表单目标 + 提交中态
  const [execute, setExecute] = useState<ExecuteTaskState | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast, showToast } = useToast();

  const handleExecute = async () => {
    if (!execute) return;
    setBusy(true);
    try {
      const timeSpent = execute.timeSpent
        ? Number(execute.timeSpent)
        : undefined;
      // 经执行表单提交:携带 execute_info + time_spent,submit 由用户勾选
      // (参照 task-plans/page.tsx handleExecute)。
      await executePlanTask({
        plan_task_id: execute.task.id,
        submit: execute.submit,
        execute_info: execute.executeInfo || undefined,
        time_spent:
          timeSpent !== undefined && !Number.isNaN(timeSpent)
            ? timeSpent
            : undefined,
      });
      showToast(
        true,
        execute.submit ? "任务已标记当日完成" : "执行进度已保存",
      );
      setExecute(null);
      onChanged();
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "执行失败");
    } finally {
      setBusy(false);
    }
  };

  const columns: TableProps<PlanTask>["columns"] = [
    {
      title: "序号",
      key: "no",
      width: 50,
      render: (_v: unknown, _t: PlanTask, idx: number) => idx + 1,
    },
    {
      title: "项目",
      dataIndex: "project_name",
      key: "project_name",
      width: 120,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "模块",
      dataIndex: "module_name",
      key: "module_name",
      width: 120,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "任务内容",
      dataIndex: "content",
      key: "content",
      width: 240,
      ellipsis: true,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 90,
      render: (v: string) => {
        const t = taskStatusTag(v);
        return <Tag color={t.color}>{t.text}</Tag>;
      },
    },
    {
      title: "操作",
      key: "action",
      width: 100,
      render: (_v: unknown, t: PlanTask) => (
        <Button
          size="sm"
          variant="default"
          // 已完成任务禁用(PlanTask.status 存中文:未开始/进行中/已完成)
          disabled={t.status === "已完成"}
          onClick={() =>
            setExecute({
              task: t,
              executeInfo: "",
              timeSpent: t.time_spent ? String(t.time_spent) : "",
              submit: false,
            })
          }
        >
          执行
        </Button>
      ),
    },
  ];

  return (
    <>
      <DataTable<PlanTask>
        rowKey="id"
        size="small"
        bordered
        scroll={{ x: "max-content" }}
        columns={columns}
        dataSource={tasks}
        loading={loading}
        emptyText="暂无任务"
      />

      {/* 执行表单(共享 ExecuteTaskDialog,填耗时/说明/提交) */}
      {execute && (
        <ExecuteTaskDialog
          state={execute}
          onChange={setExecute}
          onConfirm={() => void handleExecute()}
          onCancel={() => setExecute(null)}
          busy={busy}
        />
      )}

      <Toast toast={toast} />
    </>
  );
}

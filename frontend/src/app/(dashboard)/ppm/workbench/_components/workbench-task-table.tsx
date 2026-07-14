"use client";

/**
 * WorkbenchTaskTable — 个人工作台任务操作表 (task-10 / FR-07 / D-005@v1)。
 *
 * 中栏「我的任务」:复用 personal-task-plan 接口数据(lib/ppm/task.ts) +
 * execute-plan 完成动作。**不重写任务接口(D-005@v1)**,数据由 task-08
 * page.tsx 调 listPersonalPlanTasks 装配后 props 下传,本组件只渲染 + 操作
 * (constraints:避免双重请求)。
 *
 * 列(参照原型 + task-plans/page.tsx:286 columns 范式,**不依赖 PlanTask
 * 不存在的 project_code/plan_type**,D-005@v1:project_name 兼作项目列,
 * module_name 近似平台/计划类型列):
 *   序号 / 项目名(project_name) / 模块(module_name) / 任务内容(content) /
 *   状态(taskStatusTag) / 操作
 *
 * 「当日完成」二次确认用 ui/dialog(不自造遮罩),确认后调 executePlanTask
 * (submit=true 推进到待验证),成功 Toast + 触发 onChanged 重载;失败 Toast。
 * 已完成(status=40)/已关闭(status=50)禁用按钮。
 */
import { useState } from "react";
import { Tag, type TableProps } from "antd";

import { DataTable } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError } from "@/lib/api";
import { executePlanTask } from "@/lib/ppm/task";
import type { PlanTask } from "@/lib/ppm/types";
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
  // 二次确认目标 + 提交中态
  const [confirmTask, setConfirmTask] = useState<PlanTask | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast, showToast } = useToast();

  const handleComplete = async () => {
    if (!confirmTask) return;
    setBusy(true);
    try {
      // submit=true → 状态机推进到待验证(参照 task-plans/page.tsx:256 handleExecute)
      await executePlanTask({
        plan_task_id: confirmTask.id,
        submit: true,
      });
      showToast(true, "任务已标记当日完成");
      setConfirmTask(null);
      onChanged();
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "完成失败");
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
          // 已完成(40)/已关闭(50)禁用
          disabled={t.status === "40" || t.status === "50"}
          onClick={() => setConfirmTask(t)}
        >
          当日完成
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

      {/* 二次确认弹窗(ui/dialog,不自造遮罩) */}
      <Dialog
        open={confirmTask !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmTask(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认完成当前任务？</DialogTitle>
            <DialogDescription>
              该操作会把任务标记为当日完成，将同步执行记录（execute-plan）。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmTask(null)}
              disabled={busy}
            >
              取消
            </Button>
            <Button
              variant="default"
              disabled={busy}
              onClick={() => void handleComplete()}
            >
              确认完成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Toast toast={toast} />
    </>
  );
}

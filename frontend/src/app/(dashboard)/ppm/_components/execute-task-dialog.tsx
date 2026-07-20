"use client";

/**
 * ExecuteTaskDialog — 任务执行表单(共享组件)。
 *
 * 「执行任务」弹窗:填写 本次耗时 + 执行情况说明 + 是否提交到待验证,
 * 确认后由父组件调 executePlanTask({plan_task_id, submit, execute_info,
 * time_spent})。**不直接标记完成** —— 必须经此表单留下执行记录(耗时/说明),
 * 对齐生产要求。
 *
 * 抽自 task-plans/page.tsx 的 ExecuteDialog,供 task-plans 与个人工作台
 * (workbench-task-table)共用,消除重复 + 统一交互。用 ui/dialog(规范),
 * 取代旧的自造遮罩。
 *
 * 父组件持有 ExecuteTaskState | null:非 null 时渲染本组件,
 * onChange 回写状态,onConfirm/onCancel 关闭。
 */
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PlanTask } from "@/lib/ppm/types";
import { fmtDay, inputCls, taskStatusTag } from "../shared";

export interface ExecuteTaskState {
  task: PlanTask;
  executeInfo: string;
  timeSpent: string;
  /** start 端点返回的 in-flight 执行记录 id(execute 时必填) */
  taskExecuteId?: string;
}

/** 详情只读项:label + value(空显示 —)。 */
function DetailItem({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-foreground">{value || "—"}</span>
    </div>
  );
}

/** 执行弹窗顶部任务详情区:核心字段 + 备注/附件(只读,复用 taskStatusTag/fmtDay)。 */
function TaskDetail({ task }: { task: PlanTask }) {
  const status = taskStatusTag(task.status);
  const planRange = [task.start_time, task.end_time]
    .map((t) => (t ? fmtDay(t) : ""))
    .filter(Boolean)
    .join(" ~ ");
  const files = Array.isArray(task.file_urls) ? task.file_urls : [];
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div className="col-span-2"><DetailItem label="任务内容" value={task.content} /></div>
        {task.task_description ? (
          <div className="col-span-2"><DetailItem label="任务描述" value={task.task_description} /></div>
        ) : null}
        <DetailItem label="项目" value={task.project_name} />
        <DetailItem label="模块" value={task.module_name} />
        <DetailItem label="计划时间" value={planRange} />
        <DetailItem label="状态" value={status.text} />
        <DetailItem label="负责人" value={task.user_name} />
        <DetailItem label="配合人员" value={task.work_partner} />
        <DetailItem label="预估工时" value={task.work_load} />
      </div>
      {task.remarks ? <DetailItem label="备注" value={task.remarks} /> : null}
      {files.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">附件</span>
          <span className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <a
                key={i}
                href={f}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline"
              >
                附件{i + 1}
              </a>
            ))}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function ExecuteTaskDialog({
  state,
  onChange,
  onConfirm,
  onCancel,
  busy = false,
}: {
  state: ExecuteTaskState;
  onChange: (_s: ExecuteTaskState) => void;
  /** action: submit(保存本次+任务回未开始, 可再次填报) / complete(保存本次+任务已完成) */
  onConfirm: (action: "submit" | "complete") => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const task = state.task;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>执行任务</DialogTitle>
          <DialogDescription>
            {task.content ?? "（未填写）"}
          </DialogDescription>
        </DialogHeader>

        <TaskDetail task={task} />

        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-muted-foreground">
              本次耗时(人天)
            </label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={state.timeSpent}
              onChange={(e) =>
                onChange({ ...state, timeSpent: e.target.value })
              }
              className={`mt-0.5 ${inputCls}`}
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">
              执行情况说明
            </label>
            <textarea
              value={state.executeInfo}
              onChange={(e) =>
                onChange({ ...state, executeInfo: e.target.value })
              }
              rows={3}
              className="mt-0.5 w-full rounded border border-input bg-background px-2.5 py-1.5 text-sm focus:border-ring focus:outline-none"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              注: 执行起止不可跨天, 跨天请分多次「启动 → 提交」填报(D-004)。
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={busy}
          >
            取消
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onConfirm("submit")}
            title="保存本次执行记录, 任务回未开始(可再次填报)"
          >
            {busy ? "提交中…" : "提交"}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => onConfirm("complete")}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
import { inputCls } from "../shared";

export interface ExecuteTaskState {
  task: PlanTask;
  executeInfo: string;
  timeSpent: string;
  submit: boolean;
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
  onConfirm: () => void;
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
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={state.submit}
              onChange={(e) => onChange({ ...state, submit: e.target.checked })}
            />
            <span>提交到「已完成」（勾选则推进状态机为已完成）</span>
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
          <Button size="sm" disabled={busy} onClick={onConfirm}>
            {busy ? "提交中…" : "确认执行"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

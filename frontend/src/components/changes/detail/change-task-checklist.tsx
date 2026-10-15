"use client";

/**
 * 任务进度清单（2026-10-15-change-detail-redesign / FR-10 / D-014@v1 / D-016@v1）。
 *
 * 任务面（`tasks[]`）由本清单独家承载——统一时间线据此把 tasks 域的 task-done 事件
 * 折叠掉（同一份数据，勾选时刻本就由这些事件推断而来，见 merge-change-timeline.ts）。
 *
 * 时刻三态（`TaskTimeStatus`，由 task-02 的 `inferTaskTimeStatus` 判定）：
 * - `checked`：已勾选且有推断时刻 → 显示 `≈MM-DD HH:mm`（`≈` 表推断值，与后端「勾选时间
 *   ≈ 为推断值」口径一致）；
 * - `unchecked`：未勾选 → 不显示时刻；
 * - `broken`：已勾选但时刻不可推断（观测断链）→ 显示「时刻不可推断（观测断链）」，
 *   **MUST NOT** 显示裸问号（D-016：不让信息无声消失）。
 */
import { Counter } from "@/components/primer";
import type {
  TaskTimeStatus,
  TimelineTask,
} from "@/components/changes/detail/merge-change-timeline";

export interface ChangeTaskChecklistProps {
  tasks: TimelineTask[];
  /** 与 `tasks` 同序的时刻状态（长度一致；由 `inferTaskTimeStatus` 产出）。 */
  timeStatus: TaskTimeStatus[];
}

/** 推断时刻展示：ISO → 本地 `MM-DD HH:mm`；不可解析保留原文。 */
function formatInferredTime(at: string | null): string {
  if (!at) return "";
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return at;
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ChangeTaskChecklist({ tasks, timeStatus }: ChangeTaskChecklistProps) {
  if (tasks.length === 0) return null;
  const checked = tasks.filter((t) => t.checked).length;

  return (
    <section className="rounded-md border bg-card" data-testid="change-task-checklist">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3.5 py-2.5">
        <h2 className="flex items-center gap-1.5 text-xs font-medium">
          任务进度 <Counter count={checked} />
          <span className="text-[10px] text-muted-foreground">/ {tasks.length}</span>
        </h2>
        <span className="text-[11px] text-muted-foreground">
          勾选 {checked}/{tasks.length} · 勾选时间 ≈ 为推断值
        </span>
      </div>
      <div className="flex flex-col px-3.5 py-1.5">
        {tasks.map((task, i) => {
          const status = timeStatus[i];
          const inferred = status?.status === "checked" ? formatInferredTime(status.at) : "";
          return (
            <div
              key={task.id}
              data-testid="change-task-row"
              className="flex items-center gap-2 border-b border-dashed py-1.5 last:border-b-0"
            >
              <span className="w-4 shrink-0 text-center text-xs">
                {task.checked ? "☑" : "☐"}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {task.id}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs" title={task.desc}>
                {task.desc}
              </span>
              {task.commit_sha ? (
                <span className="shrink-0 font-mono text-[11px] text-brand-600">
                  {task.commit_sha}
                </span>
              ) : null}
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {status?.status === "broken" ? "时刻不可推断（观测断链）" : inferred
                  ? `≈${inferred}`
                  : ""}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

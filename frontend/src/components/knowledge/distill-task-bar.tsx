"use client";

/**
 * DistillTaskBar — 知识库页蒸馏任务条（task-08 / 2026-09-17-knowledge-precipitation
 * / FR-01 / FR-03 / D-002@v1）。
 *
 * 依据：
 *   - tasks/task-08.md implementation / acceptance + design Wave 4「蒸馏任务条
 *     （进行中显示，完成即消失）」；视觉对照原型 .distill-bar 位（挂知识库页
 *     列表上方：spinner + 「蒸馏进行中」标签 + 来源摘要文案）。
 *   - 数据链：useQuery 轮询 listDistillTasks（GET /knowledge/distill/tasks，
 *     task-07 端点，distill 状态以该端点返回为准不新增独立状态机）。
 *   - 轮询节奏复用 platform-sync-section 先例（MACHINES_POLL_MS / 快慢双档
 *     refetchInterval 写法）：存在 pending/running 任务走 5s 快档，否则 15s
 *     常规档（react-query 随选项值变化重排轮询定时器）。
 *   - 终态反馈（acceptance）：观测到「进行中 → completed」转移时 toast
 *     「提炼完成，候选已进入待审核」并经 onCompleted 刷新知识列表（候选出现在
 *     待审核区）；转 failed 时 toast 失败文案。DistillTaskRead 列表投影不含
 *     error_code / 错误信息（task-07 契约字段仅 agent_run_id / source_type /
 *     source_ref / status / created_at），前端无法区分 no_online_daemon 与
 *     其它失败——失败文案统一覆盖「daemon 离线或执行中断」（R-05 主因透出）。
 *   - D-009/D-010 增量（task-08 扩展）：进行中/终态行展示 degraded_reason
 *     降级提示（resume 被降级守卫改写 fresh）；completed 且 merged_to 非空的
 *     终态行渲染「已合并到 <目标小节>」反链按钮，点击经 onJumpToEntry 跳
 *     目标知识文件（merged_to 为「文件#小节」双键，防锚点漂移）。
 *   - 终态短暂停留后消失（卡片原话）：完成 / 失败行自转移观测时刻起
 *     DISTILL_TERMINAL_LINGER_MS 窗内继续渲染，到期由 timer 主动清除（不依赖
 *     下一轮轮询——react-query 结构共享对内容不变的重拉保持旧数组引用，
 *     数据流不会触发重渲染）；页面首开时已在列表里的历史终态任务从未被观测
 *     为进行中，不渲染也不补 toast。
 */

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { useNotify } from "@/lib/errors";
import { listDistillTasks, type DistillTaskRead } from "@/lib/knowledge";
import { cn } from "@/lib/utils";

/** 有进行中任务的快档轮询间隔（platform-sync-section ECHO_FAST_POLL_MS 同款）。 */
export const DISTILL_ACTIVE_POLL_MS = 5_000;

/** 无进行中任务的常规轮询间隔（platform-sync-section MACHINES_POLL_MS 同款）。 */
export const DISTILL_IDLE_POLL_MS = 15_000;

/** 终态行短暂停留时长（完成后 / 失败后展示一会儿，过期随下次轮询消失）。 */
export const DISTILL_TERMINAL_LINGER_MS = 8_000;

/**
 * 任务列表查询键（导出供派发成功方 invalidateQueries——沉淀弹层派发后任务条
 * 立即刷新，不必等下一个轮询到点；platform-sync-section QUERY_KEY_ROOT 同款
 * 「allowed_paths 只允许本文件，就地常量」惯例）。
 */
export function distillTasksQueryKey(workspaceId: string) {
  return ["knowledge", "distill-tasks", workspaceId] as const;
}

/** 进行中口径（AgentRun 状态机：pending 排队 / running 执行中）。 */
function isActiveTask(task: DistillTaskRead): boolean {
  return task.status === "pending" || task.status === "running";
}

/** 终态口径（与进行中互补：completed / failed / killed 及未知状态均按终态兜底）。 */
function isTerminalStatus(status: string): boolean {
  return status !== "pending" && status !== "running";
}

/** 来源摘要（原型 .meta 文案）：会话引用是 UUID 取前 8 位，变更引用即 change_key；
 *  quick 多选的 source_ref 为 list 投影（JSON 串或单条），按条数摘要（D-010②）。 */
function sourceSummary(task: DistillTaskRead): string {
  if (task.source_type === "change") {
    return `正在从变更归档「${task.source_ref}」提炼知识`;
  }
  if (task.source_type === "quick") {
    let count = 1;
    const raw = task.source_ref;
    if (raw && raw.trim().startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) count = parsed.length;
      } catch {
        /* 非 JSON 按单条兜底 */
      }
    }
    return count > 1
      ? `正在从 ${count} 条快速修复记录提炼知识`
      : "正在从快速修复记录提炼知识";
  }
  const ref = task.source_ref ? task.source_ref.slice(0, 8) : "—";
  return `正在从会话记录（${ref}…）提炼知识`;
}

/** 失败文案（含 daemon 离线，acceptance「失败态可见 daemon 离线对应文案」）。 */
export const DISTILL_FAILURE_TEXT = "提炼任务失败：daemon 离线或执行中断，可重新派发";

/**
 * resume 降级文案（D-009/D-010，后端 degraded_reason 字面量 → 中文提示；
 * 未知原因按「已降级：<原值>」兜底，宁宽勿断）。resume 请求被降级守卫改写为
 * fresh 时任务自创建起即带该字段，进行中行与终态行都会展示。
 */
const DEGRADED_REASON_TEXT: Record<string, string> = {
  provider_no_resume: "已降级：引擎不支持续接，已改为新建 agent",
  session_status_not_reopenable: "已降级：会话状态不可续接，已改为新建 agent",
  resume_only_for_session_source: "已降级：仅会话来源支持续接，已改为新建 agent",
};

export function distillDegradedText(reason: string): string {
  return DEGRADED_REASON_TEXT[reason] ?? `已降级：${reason}`;
}

/**
 * merged_to 双键拆分（D-010①）：「目标文件#小节标题」→ 文件段用于反链跳转
 * （父级选中并加载该知识条目）；小节段仅展示。无 `#` 时整串当文件段。
 */
export function splitMergedTo(mergedTo: string): { file: string; section: string | null } {
  const idx = mergedTo.indexOf("#");
  if (idx < 0) return { file: mergedTo, section: null };
  return { file: mergedTo.slice(0, idx), section: mergedTo.slice(idx + 1) || null };
}

/** 终态行停留条目（任务快照 + 转移观测时刻）。 */
interface TerminalLinger {
  task: DistillTaskRead;
  observedAt: number;
}

export interface DistillTaskBarProps {
  workspaceId: string;
  /** 任务转 completed 后的回调（父级刷新知识列表，蒸馏产物出现在待审核区）。 */
  onCompleted: () => void;
  /**
   * merged_to 反链跳转（D-010①）：点击终态行「已合并到 <目标小节>」时回父级，
   * 入参为 merged_to 的文件段（目标知识文件名），父级选中并加载该条目。
   */
  onJumpToEntry?: (filename: string) => void;
  className?: string;
}

export function DistillTaskBar({ workspaceId, onCompleted, onJumpToEntry, className }: DistillTaskBarProps) {
  const notify = useNotify();

  const tasksQ = useQuery({
    queryKey: distillTasksQueryKey(workspaceId),
    queryFn: () => listDistillTasks(workspaceId),
    // 节奏复用 platform-sync-section 先例（changes/page.tsx 函数式写法）：有
    // pending/running 任务 5s 快档，否则 15s 常规档。
    refetchInterval: (query) =>
      (query.state.data ?? []).some(isActiveTask)
        ? DISTILL_ACTIVE_POLL_MS
        : DISTILL_IDLE_POLL_MS,
  });
  const tasks = tasksQ.data ?? [];
  const hasActive = tasks.some(isActiveTask);

  // ── 转移检测 + 终态停留（ref 持有跨渲染集合，避免 effect 闭包过期）──────────
  const seenActiveRef = useRef<Set<string>>(new Set());
  const notifiedRef = useRef<Set<string>>(new Set());
  const [lingering, setLingering] = useState<Record<string, TerminalLinger>>({});
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;
  const lingeringRef = useRef(lingering);
  lingeringRef.current = lingering;

  /**
   * 终态行定时清除：停留到期由 timer 驱动（而非等下一轮轮询的数据变化触发
   * ——react-query 结构共享对内容不变的重拉保持旧数组引用，effect 不会重跑，
   * 单靠轮询数据流清不掉终态行）。每任务一个 timer，卸载时统一清理。
   */
  const pruneTimersRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const timers = pruneTimersRef.current;
    return () => {
      for (const t of timers.values()) window.clearTimeout(t);
      timers.clear();
    };
  }, []);

  const scheduleTerminalPrune = (id: string, delayMs: number) => {
    if (pruneTimersRef.current.has(id)) return;
    const timer = window.setTimeout(() => {
      pruneTimersRef.current.delete(id);
      const next = { ...lingeringRef.current };
      if (next[id] === undefined) return;
      delete next[id];
      lingeringRef.current = next;
      setLingering(next);
    }, delayMs);
    pruneTimersRef.current.set(id, timer);
  };

  useEffect(() => {
    const now = Date.now();
    const next: Record<string, TerminalLinger> = {};
    for (const task of tasks) {
      if (isActiveTask(task)) {
        seenActiveRef.current.add(task.agent_run_id);
        continue;
      }
      // 仅观测过「进行中」的任务参与终态反馈与停留（历史终态任务静默跳过）。
      if (!isTerminalStatus(task.status) || !seenActiveRef.current.has(task.agent_run_id)) {
        continue;
      }
      if (!notifiedRef.current.has(task.agent_run_id)) {
        notifiedRef.current.add(task.agent_run_id);
        if (task.status === "completed") {
          notifyRef.current.success("提炼完成，候选已进入待审核");
          onCompletedRef.current();
        } else {
          notifyRef.current.error(new Error(DISTILL_FAILURE_TEXT));
        }
      }
      const prev = lingeringRef.current[task.agent_run_id];
      if (prev) {
        next[task.agent_run_id] = prev;
      } else {
        next[task.agent_run_id] = { task, observedAt: now };
        scheduleTerminalPrune(task.agent_run_id, DISTILL_TERMINAL_LINGER_MS);
      }
    }
    const nextKeys = Object.keys(next);
    const prevKeys = Object.keys(lingeringRef.current);
    if (
      nextKeys.length !== prevKeys.length ||
      nextKeys.some((k) => lingeringRef.current[k] !== next[k])
    ) {
      lingeringRef.current = next;
      setLingering(next);
    }
  }, [tasks]);

  const activeTasks = tasks.filter(isActiveTask);
  const terminalRows = Object.values(lingering);
  if (activeTasks.length === 0 && terminalRows.length === 0) return null;

  return (
    <div
      data-testid="distill-task-bar"
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border bg-card px-3.5 py-2.5 text-xs shadow-sm",
        className,
      )}
    >
      {/* 进行中行（原型 .distill-bar：spinner + 「蒸馏进行中」标签 + 来源摘要；
          D-009：resume 被降级守卫改写 fresh 的任务行内展示降级原因） */}
      {activeTasks.map((task) => (
        <div
          key={task.agent_run_id}
          data-testid="distill-task-row-active"
          className="flex min-w-0 items-center gap-2.5"
        >
          <span
            aria-hidden
            className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600"
          />
          <span className="shrink-0 rounded-full bg-brand-100 px-2 py-0.5 text-[10.5px] font-medium leading-4 text-brand-700">
            {task.status === "pending" ? "排队中" : "蒸馏进行中"}
          </span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {sourceSummary(task)}，完成后候选进入「待审核」
          </span>
          {task.degraded_reason && (
            <span
              data-testid="distill-row-degraded"
              className="shrink-0 rounded-full bg-warning/10 px-2 py-0.5 text-[10.5px] font-medium leading-4 text-warning"
            >
              {distillDegradedText(task.degraded_reason)}
            </span>
          )}
        </div>
      ))}

      {/* 终态停留行（完成/失败短暂展示，随轮询消失）；D-010①：completed 且
          merged_to 非空时展示「已合并到 <目标小节>」反链，点击跳目标文件 */}
      {terminalRows.map(({ task }) => (
        <div
          key={`terminal-${task.agent_run_id}`}
          data-testid="distill-task-row-terminal"
          className="flex min-w-0 items-center gap-2.5"
        >
          {task.status === "completed" ? (
            <>
              <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-[10.5px] font-medium leading-4 text-success">
                提炼完成
              </span>
              {task.merged_to ? (
                <button
                  type="button"
                  data-testid="distill-merged-link"
                  title={`已合并到 ${task.merged_to}，点击跳转`}
                  onClick={() => onJumpToEntry?.(splitMergedTo(task.merged_to as string).file)}
                  className="min-w-0 flex-1 truncate text-left text-brand-600 hover:underline"
                >
                  已合并到 {task.merged_to}
                </button>
              ) : (
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  候选知识已进入「待审核」区，请前往审核合并。
                </span>
              )}
              {task.degraded_reason && (
                <span className="shrink-0 rounded-full bg-warning/10 px-2 py-0.5 text-[10.5px] font-medium leading-4 text-warning">
                  {distillDegradedText(task.degraded_reason)}
                </span>
              )}
            </>
          ) : (
            <>
              <span className="shrink-0 rounded-full bg-error/10 px-2 py-0.5 text-[10.5px] font-medium leading-4 text-error">
                提炼失败
              </span>
              <span className="min-w-0 flex-1 truncate text-error">{DISTILL_FAILURE_TEXT}</span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

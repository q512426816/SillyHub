/**
 * task-05（2026-09-04-session-task-execution-panel / FR-02 / D-001@v1）：后台
 * Agent 任务状态归约共享模块（纯函数，无 React 依赖，时间锚点取 Date.now）。
 *
 * applyAgentTaskStatusEvent 自 session-panel.tsx 等值搬入（函数名 / 签名 /
 * 归约逻辑 / 注释逐字不变），为任务面板提供统一归约入口；类型定义留原处
 * （AgentTaskEntry → activity-catalog.tsx；AgentTaskStatusEvent → lib/daemon.ts）。
 * session-panel.tsx 保留 re-export，既有 import 路径零变化
 * （__tests__/agent-task-card-lifecycle.test.tsx 直接从 session-panel import）。
 */

import type { AgentTaskEntry } from "@/components/daemon/activity-catalog";
import type { AgentTaskStatusEvent } from "@/lib/daemon";

/* ── 后台 Agent 任务状态归约（task-12 / 2026-08-27-background-subagent-progress）── */

/**
 * agent_task_status 归约（page / dialog 两模式共用，对齐 bash 先例收口到底部）：
 * 按 task_id upsert，扩展字段（工具名 / summary / tokens / 走秒锚点）事件未带
 * （null）时保留旧值——服务端累计量只增不减，心跳缺字段不回退；running 心跳
 * 推进「最后活跃」锚点；终态事件到达即定格（记 terminalAt + 服务端 elapsed），
 * 此后迟到的 running 心跳不复活转圈（终态为吸收态，后到终态允许覆盖定格数据）；
 * 最近 6 条截断语义与原实现一致（终态保留供回看，会话结束由调用方清空）。
 */
export function applyAgentTaskStatusEvent(
  prev: AgentTaskEntry[],
  event: AgentTaskStatusEvent,
): AgentTaskEntry[] {
  const now = Date.now();
  const idx = prev.findIndex((t) => t.taskId === event.task_id);
  const existing = idx >= 0 ? (prev[idx] ?? null) : null;
  // 终态定格：已定格（completed / failed / stopped）的卡片忽略迟到 running 心跳。
  if (existing && existing.status !== "running" && event.status === "running") {
    return prev;
  }
  const next: AgentTaskEntry = {
    taskId: event.task_id,
    taskName: event.task_name,
    status: event.status,
    progress: event.progress,
    message: event.message,
    // FR-04 扩展字段：事件缺省（null / undefined）时沿用旧值（首见任务为 null）。
    isAsync: event.async ?? existing?.isAsync ?? null,
    lastToolName: event.last_tool_name ?? existing?.lastToolName ?? null,
    summary: event.summary ?? existing?.summary ?? null,
    elapsedMs: event.elapsed_ms ?? existing?.elapsedMs ?? null,
    totalTokens: event.total_tokens ?? existing?.totalTokens ?? null,
    toolUses: event.tool_uses ?? existing?.toolUses ?? null,
    // 走秒校准锚点：elapsed_ms 到达即重置；首见任务记 startedAt 兜底（无服务端
    // 时长时卡片走 startedAt 起本地走秒）。
    elapsedSyncedAt:
      event.elapsed_ms != null ? now : existing?.elapsedSyncedAt ?? null,
    startedAt: existing?.startedAt ?? now,
    // 「最后活跃」锚点：running 心跳推进，终态定格后不再更新（卡片据此判 >5min
    // 沉默；终态本身不触发警示）。
    lastActivityAt:
      event.status === "running" ? now : existing?.lastActivityAt ?? null,
    terminalAt: event.status === "running" ? existing?.terminalAt ?? null : now,
  };
  if (idx === -1) return [...prev, next].slice(-6);
  const copy = [...prev];
  copy[idx] = next;
  return copy;
}

"use client";

/**
 * ql-20260826-010：后台活动目录（会话头部下拉）。
 *
 * 背景：Bash 命令进度卡 / 后台 Agent 任务卡（子代理派发）/ 团队任务块此前常驻
 * 渲染在消息流与输入区之间，挤占聊天窗口（用户反馈「进度 tab 中 bash 和子
 * agent 太占位置」）。本组件把它们收编进头部下拉（与 SubagentCatalog 同款
 * 交互形态——触发按钮 + 点击展开 + 外部点击/Escape 收起），默认零占位，
 * 点击后才展示详情。
 *
 * 职责边界：
 *   - 纯展示编排：三类卡片（BashProgressCard / AgentTaskCard / TeamTaskBlock）
 *     原样复用，不做数据请求；
 *   - 内容为空（无 bash、无后台任务、无 mission）→ 整体不渲染（返回 null）；
 *   - 运行中（bash running / 后台任务 running / 活跃 mission）触发按钮带
 *     脉冲点提示；
 *   - TeamTaskBlock 交互（取消/重拉/分身子会话）经 props 透传回父层，本组件
 *     不持有状态。
 */

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

import { AgentTaskCard } from "@/components/daemon/agent-task-card";
import { BashProgressCard } from "@/components/daemon/bash-progress-card";
import { TeamTaskBlock, isActiveTeamMission } from "@/components/daemon/team-task-block";
import type { TeamMissionSummary } from "@/lib/daemon";

/** 后台 Agent 任务条目（session-panel 两模式的 agentTasks state 同构形状）。 */
export interface AgentTaskEntry {
  taskId: string;
  taskName: string;
  status: "running" | "completed" | "failed";
  progress: number | null;
  message: string | null;
}

/** bash 进度（BashProgressState 子集——runId 仅归约用，展示不需要）。 */
export interface ActivityBashProgress {
  command: string;
  status: "running" | "completed" | "failed";
  exitCode?: number | null;
  elapsedMs?: number | null;
  chunks: { channel: "stdout" | "stderr"; content: string; is_final?: boolean }[];
}

export interface ActivityCatalogProps {
  /** bash 命令进度（无则 null）。 */
  bashProgress: ActivityBashProgress | null;
  /** 后台 Agent 任务列表。 */
  agentTasks: AgentTaskEntry[];
  /** 会话团队任务列表（活跃在前由本组件排序）。 */
  missions: TeamMissionSummary[];
  /** 会话绑定工作区 ID（TeamTaskBlock 分身日志/产物查询鉴权透传）。 */
  workspaceId?: string | null;
  /** TeamTaskBlock 取消等操作成功后的重拉回调。 */
  onRefreshMissions: () => void;
  /** 分身行点击 → 父层开分身子会话浮层。 */
  onOpenWorkerSession: (subSessionId: string) => void;
}

/**
 * 后台活动目录：触发按钮「后台 ▾」+ 计数徽标（运行中脉冲点），下拉展开
 * bash / 后台任务 / 团队任务三类卡片。全空返回 null。
 */
export function ActivityCatalog({
  bashProgress,
  agentTasks,
  missions,
  workspaceId,
  onRefreshMissions,
  onOpenWorkerSession,
}: ActivityCatalogProps) {
  const [open, setOpen] = useState(false);

  const sortedMissions = useMemo(
    () =>
      [...missions].sort(
        (a, b) =>
          Number(isActiveTeamMission(b.status)) - Number(isActiveTeamMission(a.status)),
      ),
    [missions],
  );

  const totalCount =
    agentTasks.length + sortedMissions.length + (bashProgress ? 1 : 0);
  const hasRunning =
    bashProgress?.status === "running" ||
    agentTasks.some((t) => t.status === "running") ||
    sortedMissions.some((m) => isActiveTeamMission(m.status));

  // 开合：点击组件外区域收起 + Escape 收起（同 SubagentCatalog 交互契约）。
  useEffect(() => {
    if (!open) return;
    const onDocClick = () => setOpen(false);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (totalCount === 0) return null;

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`后台任务目录，共 ${totalCount} 项${hasRunning ? "，有运行中" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title="后台任务：bash 命令 / 后台 Agent 任务 / 团队任务，点击展开"
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-[3px] text-xs text-foreground hover:bg-muted"
      >
        {hasRunning && (
          <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-600" />
        )}
        <span>后台</span>
        <span className="rounded-full bg-brand-100 px-1.5 text-[10.5px] font-semibold leading-4 text-brand-700">
          {totalCount}
        </span>
        <ChevronDown aria-hidden className="h-3 w-3 text-muted-foreground" />
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full z-30 mt-1.5 flex w-[440px] max-w-[min(440px,calc(100vw-32px))] flex-col gap-2 overflow-y-auto rounded-xl border border-border bg-card p-2.5 shadow-md max-h-[min(480px,60vh)]"
        >
          {bashProgress && (
            <section aria-label="bash 命令进度">
              <BashProgressCard
                command={bashProgress.command}
                status={bashProgress.status}
                exitCode={bashProgress.exitCode}
                elapsedMs={bashProgress.elapsedMs}
                chunks={bashProgress.chunks}
              />
            </section>
          )}
          {agentTasks.length > 0 && (
            <section aria-label="后台任务列表" className="space-y-2">
              {agentTasks.map((task) => (
                <AgentTaskCard
                  key={task.taskId}
                  taskId={task.taskId}
                  taskName={task.taskName}
                  status={task.status}
                  progress={task.progress}
                  message={task.message}
                />
              ))}
            </section>
          )}
          {sortedMissions.length > 0 && (
            <section aria-label="会话团队任务列表" className="space-y-1.5">
              {sortedMissions.map((m) => (
                <TeamTaskBlock
                  key={m.mission_id}
                  summary={m}
                  workspaceId={workspaceId}
                  onRefresh={onRefreshMissions}
                  onOpenWorkerSession={onOpenWorkerSession}
                />
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

/**
 * 会话团队任务列表 hook + /team 指令解析（task-11 / 2026-08-22-team-session-unify；
 * 自 session-panel.tsx 拆出，task-14 / 2026-09-07-arch-large-file-split，原样搬移）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { isActiveTeamMission } from "@/components/daemon/team-task-block";
import { listSessionTeamMissions, type TeamMissionSummary } from "@/lib/daemon";


/* ────────────────────── task-11（2026-08-22-team-session-unify）：会话内团队触发（page/dialog 共用） ────────────────────── */

/** 活跃 mission 轮询间隔（design §5 Phase 3：活跃 5s 轮询、终态停止）。 */
const TEAM_MISSION_POLL_MS = 5000;

/**
 * /team 指令前缀解析（D-004 四路等价）：命中返回去前缀目标文本（可空串），
 * 未命中返回 null（普通消息原路发送）。仅匹配整条指令——"/teams" 之类不误伤。
 */
export function parseTeamCommand(prompt: string): string | null {
  const m = /^\/team(?:\s+([\s\S]*))?$/.exec(prompt);
  return m ? (m[1] ?? "").trim() : null;
}

/** triggerSessionTeamMission 错误 → 中文文案（409 单活跃冲突 / 403 项目维度权限 / 422 参数）。 */
export function teamTriggerErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return "已有进行中的团队任务，等它完成或取消后再派";
    if (err.status === 403) return "无权限派发团队（项目维度仅项目经理可用）";
    if (err.status === 422) return `派发参数有误：${err.message}`;
    return err.message;
  }
  return "派团队失败，请稍后重试";
}

/**
 * task-11：会话团队任务列表（GET /sessions/{id}/team-missions）+ 活跃 5s 轮询。
 * 纯 fetch + setInterval（不用 react-query——R4：团队入口在 dialog 渲染路径同样
 * 挂载，dialog 分支零 react-query 铁律覆盖至此）；拉取失败静默（任务块非关键
 * 路径，不阻断会话主流程，下轮轮询/取消刷新自愈）。
 *
 * ql-20260828-009-4a13：轮询条件扩展 hasRunningTurn——原仅 hasActive 时轮询，
 * mission 迟到场景（主控轮运行中 dispatch 建 mission / 弹层确认晚于面板挂载
 * 首拉）下 hasActive=false 轮询不启动，chip 永不出现（用户实测首次派团队无
 * 标签的根因）；会话有进行中轮时主控随时可能建 mission，纳入轮询消除盲区。
 */
export function useSessionTeamMissions(
  sessionId: string | null,
  hasRunningTurn = false,
) {
  const [missions, setMissions] = useState<TeamMissionSummary[]>([]);
  // F7（2026-08-25）：异步回写守卫——refresh 同时被 effect（挂载/切会话/轮询）与
  // 外部回调（dialog 派团队后手动刷新）调用，effect 作用域 cancelled 覆盖不全，
  // 用 hook 级 aliveRef 等价守卫：卸载后迟到的列表响应不再 setState。
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  const refresh = useCallback(async () => {
    if (!sessionId) return;
    try {
      const items = await listSessionTeamMissions(sessionId);
      if (!aliveRef.current) return;
      setMissions(items);
    } catch {
      /* 列表拉取失败不阻断 */
    }
  }, [sessionId]);
  useEffect(() => {
    setMissions([]);
    if (sessionId) void refresh();
  }, [sessionId, refresh]);
  const hasActive = missions.some((m) => isActiveTeamMission(m.status));
  useEffect(() => {
    if (!sessionId || (!hasActive && !hasRunningTurn)) return;
    const timer = window.setInterval(() => {
      // ql-20260904-009：后台标签页跳过 tick（回前台下一拍即恢复拉取；切走
      // 后 5s 轮询照打后端纯耗电耗请求）。
      if (typeof document !== "undefined" && document.hidden) return;
      void refresh();
    }, TEAM_MISSION_POLL_MS);
    return () => window.clearInterval(timer);
  }, [sessionId, hasActive, hasRunningTurn, refresh]);
  return { missions, refresh };
}

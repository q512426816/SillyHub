/**
 * useSessionTasks —— 会话任务清单数据源 Hook
 * （2026-09-04-session-task-execution-panel task-06 / FR-02 / FR-07 /
 * D-001@v1 / D-003@v1 / D-006@v1）。
 *
 * 任务执行面板「任务清单」页签的持久化 + 实时合一数据源，三链路：
 *   - 快照链路：mount / sessionId 变化 / refreshSignal 递增时调
 *     lib/daemon.listSessionTasks 拉 agent_session_task 持久化行
 *     （updated_at 倒序，最近 200 条），映射为视图行 AgentSessionTaskView
 *     ——刷新 / 切会话再回来清单可恢复（FR-02 集成验收前提）；快照结果
 *     覆盖本地实时合并态，以服务端为准对账。
 *   - 实时链路：applyEvent(e) 按 task_id upsert 合并进 tasks，归约语义复用
 *     agent-task-store 的 applyAgentTaskStatusEvent（缺字段保旧值 / 终态定格
 *     不回退）。**本 hook 不建 SSE 连接**（禁 EventSource / 二条流）：事件
 *     仍走既有 fetch-sse 会话流，由 session-panel SSE 分发处调 applyEvent
 *     接线（task-08，约束见任务卡「禁止 EventSource」）。
 *   - 重连链路：SSE 重连恢复后由调用方递增 opts.refreshSignal 触发快照重拉
 *     （SessionUsageBar refreshSignal 同款模式），补齐断线期间落库的任务行。
 *
 * 实现约束：纯 useState/useEffect，不用 react-query——dialog 模式弹窗渲染路径
 *   无 QueryClientProvider（session-panel 文件头零 react-query 约定，
 *   use-message-queue.ts / session-usage-bar.tsx 同款先例）。
 *
 * 错误口径对齐 use-message-queue ql-20260903-014：404/409/422 已知竞态静默
 *   （会话恰被删除 / 切换中，随后重拉以服务端为准收敛），网络 / 5xx / 权限等
 *   真实失败 toast；空快照（FR-07 引擎不上报任务）tasks=[] 不报错、loading
 *   正常收敛。
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { applyAgentTaskStatusEvent } from "@/components/daemon/agent-task-store";
import type { AgentTaskEntry } from "@/components/daemon/activity-catalog";
import { ApiError } from "@/lib/api";
import {
  listSessionTasks,
  type AgentSessionTaskRead,
  type AgentTaskStatusEvent,
} from "@/lib/daemon";
import { useNotify } from "@/lib/errors";

/* ── 任务状态受控词表（事件契约四值；running 之外的终态定格，D-006@v1）── */

const TASK_STATUS_VALUES = ["running", "completed", "failed", "stopped"] as const;

type TaskStatus = (typeof TASK_STATUS_VALUES)[number];

/**
 * AgentSessionTaskRead.status 生成类型为 string（后端列 str），收窄为四值
 * 受控词表；未知值按 stopped 定格展示（持久化清单不转圈，区别于实时事件
 * parseAgentTaskStatusEvent 的 running 兜底）。
 */
function narrowTaskStatus(raw: string): TaskStatus {
  return (TASK_STATUS_VALUES as readonly string[]).includes(raw)
    ? (raw as TaskStatus)
    : "stopped";
}

/**
 * 任务清单视图行（design「接口定义」AgentSessionTaskView）：AgentTaskEntry
 * （AgentTaskCard 可直接渲染的展示形状）+ 快照侧元数据。快照行与实时事件
 * 行同构合并，终态行定格显示（终态后再收 running 心跳不回退）。
 */
export interface AgentSessionTaskView extends AgentTaskEntry {
  /**
   * 归属轮次 id（快照 run_id / 事件 run_id 透传）。本期不做按 run 分组 /
   * 关联消费（design 非目标 5），仅透传供后续增强，避免再动本 hook 签名。
   */
  runId?: string | null;
  /**
   * 服务端最近更新时刻（ISO）。快照行回填（列表排序基准——服务端按
   * updated_at 倒序返回）；纯实时合并行（快照未见、事件先行到达）事件载荷
   * 无该字段故为 null，下次快照重拉回填。
   */
  updatedAt?: string | null;
}

/**
 * 快照行 → 视图行映射（AgentSessionTaskRead → AgentSessionTaskView）：
 * 展示字段对齐 AgentTaskEntry（task-07 面板行可直接喂 AgentTaskCard，无需
 * 适配层）；走秒 / 最后活跃 / 终态锚点以服务端时刻回填（Date.parse 失败 →
 * null），供后续 applyEvent 归约沿用「缺字段保旧值」语义继续合并。
 */
function snapshotRowToView(
  row: AgentSessionTaskRead,
  receivedAt: number,
): AgentSessionTaskView {
  return {
    taskId: row.task_id,
    taskName: row.task_name,
    status: narrowTaskStatus(row.status),
    progress: row.progress ?? null,
    message: row.message ?? null,
    isAsync: row.is_async,
    lastToolName: row.last_tool_name ?? null,
    summary: row.summary ?? null,
    elapsedMs: row.elapsed_ms ?? null,
    // 服务端 elapsed 到达即校准走秒锚点（对齐归约函数 elapsedSyncedAt 语义，
    // 锚点取快照抵达本地时刻）。
    elapsedSyncedAt: row.elapsed_ms != null ? receivedAt : null,
    startedAt: row.started_at ? (Date.parse(row.started_at) || null) : null,
    // 快照 updated_at 是服务端最近一次心跳 / 终态落库时刻，作「最后活跃」锚点
    //（running 行 >5min 沉默警示沿用卡片判定）。
    lastActivityAt: Date.parse(row.updated_at) || null,
    terminalAt: row.finished_at ? (Date.parse(row.finished_at) || null) : null,
    totalTokens: row.total_tokens ?? null,
    toolUses: row.tool_uses ?? null,
    runId: row.run_id,
    updatedAt: row.updated_at,
  };
}

/**
 * 实时事件 → 视图行列表合并（按 task_id upsert，applyEvent 内部调用）：
 *   - 既有行：抽成单元素数组过 applyAgentTaskStatusEvent 归约（缺字段保旧值 /
 *     终态定格不回退——终态行归约函数原样退回，列表不动），结果回填原位。
 *     **整表不可直接过归约函数**：其内置 slice(-6) 截断是 ActivityCatalog
 *     实时卡「最近 6 条」语义，任务清单是持久化列表（服务端最近 200 条）；
 *   - 首见行：空表播种取唯一结果行，插到队首（服务端序 = updated_at 倒序，
 *     最新行在前）；既有行更新不重排位置（心跳不跳动列表，快照重拉恢复
 *     服务端序），updatedAt/runId 元数据沿用旧行（事件载荷无 updated_at）。
 */
function mergeAgentTaskEvent(
  rows: AgentSessionTaskView[],
  event: AgentTaskStatusEvent,
): AgentSessionTaskView[] {
  const idx = rows.findIndex((t) => t.taskId === event.task_id);
  const existing = idx >= 0 ? (rows[idx] ?? null) : null;
  if (existing) {
    const [reduced] = applyAgentTaskStatusEvent([existing], event);
    // 终态定格：归约函数对迟到 running 心跳原样退回旧行（同引用），列表不动。
    if (!reduced || reduced === existing) return rows;
    const copy = [...rows];
    copy[idx] = {
      ...reduced,
      runId: event.run_id ?? existing.runId,
      updatedAt: existing.updatedAt,
    };
    return copy;
  }
  const [seed] = applyAgentTaskStatusEvent([], event);
  if (!seed) return rows;
  return [{ ...seed, runId: event.run_id, updatedAt: null }, ...rows];
}

/** 已知竞态状态码：catch 后静默（会话恰被删 / 切换中，重拉以服务端为准收敛），
 *  其余真实失败 toast（ql-20260903-014 口径）。 */
const RECONCILE_SILENT_STATUSES = new Set([404, 409, 422]);

export interface UseSessionTasksOptions {
  /**
   * 快照重拉信号（SessionUsageBar refreshSignal 同款模式）：每次递增触发
   * 一次快照重拉。接线点（task-08）：session-panel 在 SSE 会话流重连恢复
   * （SessionStreamStatus 转为 "reconnected"）后递增计数，对账断线期间
   * 落库的任务行（FR-02 刷新 / 重连恢复集成验收前提）；其余需要以服务端
   * 为准对账的时机亦可复用。缺省不额外触发（mount / sessionId 变化必拉）。
   */
  refreshSignal?: number;
}

export interface UseSessionTasksReturn {
  /**
   * 任务清单视图行（快照序 = 服务端 updated_at 倒序 + 实时新行插队首；
   * 空快照为 []，FR-07 不报错）。
   */
  tasks: AgentSessionTaskView[];
  /**
   * 实时事件入口：session-panel SSE 分发处调用（task-08 接线，本 hook 不建
   * SSE 连接）。入参为归一化后的 AgentTaskStatusEvent，按 task_id upsert 合并
   * 进 tasks（缺字段保旧值 / 终态定格不回退）；session_id 与当前会话不符的
   * 事件静默丢弃（防切会话后迟到事件串台）。
   */
  applyEvent: (_event: AgentTaskStatusEvent) => void;
  /** 快照拉取中（mount / 重拉期间 true；空快照正常收敛 false）。 */
  loading: boolean;
}

export function useSessionTasks(
  sessionId: string,
  opts?: UseSessionTasksOptions,
): UseSessionTasksReturn {
  const { refreshSignal } = opts ?? {};
  const [tasks, setTasks] = useState<AgentSessionTaskView[]>([]);
  // 首挂即有会话时直接进入拉取中（避免一帧空态闪烁）；预会话态（""）不拉。
  const [loading, setLoading] = useState(() => sessionId !== "");
  const notify = useNotify();
  // useNotify 每次渲染返回新对象字面量（lib/errors.ts），若直接进 load 的
  // useCallback 依赖会使 load 每渲染重建 → 快照 effect 无限重拉（loading
  // 真假乒乓循环，task-10 在 session-panel 回归中实证）——经 ref 稳定化。
  const notifyRef = useRef(notify);
  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);
  /** 卸载 / 换会话后迟到的响应丢弃（epoch 单调递增，响应携带发起时的 epoch）。 */
  const epochRef = useRef(0);
  const mountedRef = useRef(true);
  /** applyEvent 会话守卫读当前 sessionId（回调保持稳定引用，守卫值随会话更新）。 */
  const sessionIdRef = useRef(sessionId);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (targetSessionId: string): Promise<void> => {
      if (targetSessionId === "") {
        // 预会话态：无快照可拉，清空旧行 + 收敛 loading（不报错）。
        epochRef.current += 1;
        setTasks([]);
        setLoading(false);
        return;
      }
      const epoch = ++epochRef.current;
      setLoading(true);
      try {
        const rows = await listSessionTasks(targetSessionId);
        if (!mountedRef.current || epoch !== epochRef.current) return;
        const receivedAt = Date.now();
        setTasks(rows.map((row) => snapshotRowToView(row, receivedAt)));
        setLoading(false); // 空快照（FR-07 引擎不上报任务）也正常收敛，tasks=[]。
      } catch (err) {
        if (!mountedRef.current || epoch !== epochRef.current) return; // 迟到 / 已切换：静默
        setLoading(false);
        // 已知竞态（404 会话恰被删等）静默；网络 / 5xx / 权限等真实失败 toast
        //（ql-20260903-014 口径）。
        if (err instanceof ApiError && RECONCILE_SILENT_STATUSES.has(err.status)) {
          return;
        }
        notifyRef.current.error(err, "加载任务清单失败");
      }
    },
    [],
  );

  // 会话切换：先清旧清单（新快照到达前不显示上个会话的任务行）。
  useEffect(() => {
    setTasks([]);
  }, [sessionId]);

  // mount / 会话切换 / 重连信号：立即拉快照（快照行覆盖本地实时合并态，
  // 以服务端为准对账）。
  useEffect(() => {
    void load(sessionId);
  }, [sessionId, load, refreshSignal]);

  const applyEvent = useCallback((event: AgentTaskStatusEvent): void => {
    if (event.session_id !== sessionIdRef.current) return;
    setTasks((prev) => mergeAgentTaskEvent(prev, event));
  }, []);

  return { tasks, applyEvent, loading };
}

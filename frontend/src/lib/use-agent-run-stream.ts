import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AgentRunStreamClient,
  type StreamStatus,
} from "./agent-stream";
import {
  type AgentRunLogEntry,
  type AgentRunStatus,
  getAgentRun,
  getAgentRunLogs,
  submitAgentRunInput,
} from "./agent";
import { type SessionPermissionRequest, fetchPendingDialogs } from "./daemon";
import { useSession } from "@/stores/session";

// ────────────────────────────────────────────────────────────────────────────
// useAgentRunStream — 统一 Agent Run SSE 客户端的 React 封装
//
// 依据：.sillyspec/changes/2026-06-22-unify-agent-run-sse-hook/design.md §7.1
//       .sillyspec/changes/2026-06-22-unify-agent-run-sse-hook/tasks/task-01.md
//
// 生命周期复刻 page.tsx:284-342 connectBootstrapStream：
//   构造 client → 注册 5 回调 → token 判空 → connect。
// 差异：
//   - D-001：isActive=false 只 prefetch 历史、不连 SSE。
//   - FR-07：isActive=true 时 getAgentRun → session_id → fetchPendingDialogs 恢复。
//   - D-003：dismissPerm 仅本地移除 perms，决策 API 由卡片自调。
// ────────────────────────────────────────────────────────────────────────────

/**
 * AgentRunStatus 运行时白名单：done 事件的 status 是裸 string，
 * setStatus 前校验，避免后端脏值污染 status state（P3.2）。
 */
const AGENT_RUN_STATUSES: ReadonlySet<AgentRunStatus> = new Set([
  "pending",
  "running",
  "completed",
  "failed",
  "killed",
]);

export interface UseAgentRunStreamOptions {
  /** run 状态 pending/running → 连 SSE；否则仅 prefetch 历史（D-001） */
  isActive: boolean;
  /** run 结束（done 事件）通知父组件 */
  onDone?: (status: string) => void;
  // 注：不设 enabled —— runId=null 已表达"不连接"（useEffect guard），避免 YAGNI（Grill X-001）。
}

export interface AgentRunInputStream {
  values: Record<string, string>;
  submitting: Record<string, boolean>;
  errors: Record<string, string>;
  replied: Set<string>;
  set: (logId: string, value: string) => void;
  /** 调 submitAgentRunInput(workspaceId, runId, {content})，成功标记 replied */
  submit: (logId: string) => Promise<void>;
}

export interface UseAgentRunStreamResult {
  logs: AgentRunLogEntry[];
  status: AgentRunStatus | null;
  streaming: boolean;
  loading: boolean; // prefetch 历史 / 建立连接中（Grill X-004，喂给 AgentLogViewer.loading）
  error: string | null;
  perms: SessionPermissionRequest[];
  /** 本地移除 perm（卡片 onResolved 与 SSE permission_resolved 均调，D-003） */
  dismissPerm: (requestId: string) => void;
  input: AgentRunInputStream;
  clear: () => void;
}

export function useAgentRunStream(
  workspaceId: string,
  runId: string | null,
  options: UseAgentRunStreamOptions,
): UseAgentRunStreamResult {
  const { isActive, onDone } = options;
  // —— 状态声明 ——
  const [logs, setLogs] = useState<AgentRunLogEntry[]>([]);
  const [status, setStatus] = useState<AgentRunStatus | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [perms, setPerms] = useState<SessionPermissionRequest[]>([]);

  // pending_input 控件状态（FR-05，hook 持有，panel 负责字段映射）
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [submittingInputs, setSubmittingInputs] = useState<Record<string, boolean>>({});
  const [inputErrors, setInputErrors] = useState<Record<string, string>>({});
  const [repliedInputs, setRepliedInputs] = useState<Set<string>>(new Set());

  // 底层客户端 ref：cleanup 时 disconnect
  const clientRef = useRef<AgentRunStreamClient | null>(null);

  // —— dismissPerm（D-003：仅本地 perms 移除，决策 API 由卡片自调）——
  const dismissPerm = useCallback((requestId: string) => {
    setPerms((prev) => prev.filter((r) => r.request_id !== requestId));
  }, []);

  // —— pending_input 控件 ——
  const setInputValue = useCallback((logId: string, value: string) => {
    setInputValues((prev) => ({ ...prev, [logId]: value }));
  }, []);

  const submitInput = useCallback(
    async (logId: string) => {
      const value = inputValues[logId] ?? "";
      if (!value.trim()) {
        setInputErrors((prev) => ({ ...prev, [logId]: "内容不能为空" }));
        return;
      }
      setSubmittingInputs((prev) => ({ ...prev, [logId]: true }));
      setInputErrors((prev) => {
        const next = { ...prev };
        delete next[logId];
        return next;
      });
      try {
        // runId 非空：调用点保证 UI 存在即 runId 已绑（task-03 panel 保证）
        await submitAgentRunInput(workspaceId, runId!, { content: value });
        setRepliedInputs((prev) => {
          const next = new Set(prev);
          next.add(logId);
          return next;
        });
      } catch (err) {
        setInputErrors((prev) => ({
          ...prev,
          [logId]: err instanceof Error ? err.message : "提交失败",
        }));
      } finally {
        setSubmittingInputs((prev) => {
          const next = { ...prev };
          delete next[logId];
          return next;
        });
      }
    },
    [inputValues, workspaceId, runId],
  );

  // —— clear（状态重置，调用点切 runId 时用）——
  const clear = useCallback(() => {
    setLogs([]);
    setStatus(null);
    setStreaming(false);
    setLoading(false);
    setError(null);
    setPerms([]);
    setInputValues({});
    setSubmittingInputs({});
    setInputErrors({});
    setRepliedInputs(new Set());
  }, []);

  // —— useEffect 生命周期（复刻 page.tsx:284-342 connectBootstrapStream）——
  useEffect(() => {
    // Guard 1：runId=null 不连接，直接返回 no-op cleanup（保留组件上次 logs）
    if (!runId) {
      clientRef.current = null;
      return;
    }

    // Guard 2：token 缺失 → setError 不连（复刻 page.tsx:335-341）
    const { accessToken } = useSession.getState();
    if (!accessToken) {
      setError("会话已失效，请重新登录后查看实时日志");
      setLoading(false);
      setStreaming(false);
      return;
    }

    setError(null);
    setLoading(true);

    // P2.1 cancelled flag：unmount / 依赖变化后旧 effect 闭包不再写 state，
    // 防止 SSE 回调与 prefetch / FR-07 的 async 写入落到已卸载组件（StrictMode 双调用）。
    let cancelled = false;

    // 构造底层客户端（每次 runId/isActive 变化都 new 新实例）
    const client = new AgentRunStreamClient(workspaceId, runId);
    clientRef.current = client;

    // (a) status：connected/connecting → streaming=true；error → setError
    client.onStatusChange((s: StreamStatus) => {
      if (cancelled) return;
      setStreaming(s === "connecting" || s === "connected");
      if (s === "error") setError("连接失败，请重试");
      if (s === "connected") setLoading(false);
    });

    // (b) message：log 追加（按 log_id 去重；client 已去重，hook 侧再保险）
    client.onMessage((event) => {
      if (cancelled) return;
      setLogs((prev) => {
        if (event.log_id != null && prev.some((l) => l.id === event.log_id)) {
          return prev;
        }
        return [
          ...prev,
          {
            id: event.log_id ?? _safeRuntimeId(),
            run_id: runId,
            timestamp: event.timestamp,
            channel: event.channel,
            content_redacted: event.content ?? "",
            // 2026-06-28-daemon-subagent-transcript task-10 / FR-08：SSE 实时流归属
            // 透传（backend published_logs / session payload 带，task-09）。让实时流
            // log 与 DB 查询路径都有归属，viewer 统一渲染子代理徽标 + depth 缩进
            //（task-11）。历史/主 agent → null（与 backend nullable 一致，design §9）。
            parent_tool_use_id: event.parent_tool_use_id ?? null,
            subagent_type: event.subagent_type ?? null,
            depth: event.depth ?? null,
          },
        ];
      });
    });

    // (c) permission_request：perms 增（按 request_id 去重，FR-04）
    client.onPermissionRequest((req) => {
      if (cancelled) return;
      setPerms((prev) =>
        prev.some((r) => r.request_id === req.request_id)
          ? prev
          : [...prev, req],
      );
    });

    // (d) permission_resolved：dismissPerm（D-003，与卡片 onResolved 收敛）
    client.onPermissionResolved((resolved) => {
      if (cancelled) return;
      dismissPerm(resolved.request_id);
    });

    // (e) done：终态 status + 通知父 + disconnect
    client.onDone((data) => {
      if (cancelled) return;
      // P3.2：status 是裸 string，按白名单校验后再入库，过滤后端脏值。
      const statusStr = typeof data.status === "string" ? data.status : "";
      if (statusStr && AGENT_RUN_STATUSES.has(statusStr as AgentRunStatus)) {
        setStatus(statusStr as AgentRunStatus);
      }
      // P2.2：显式置 false，不依赖 disconnect → onStatusChange("disconnected") 间接链路。
      setStreaming(false);
      onDone?.(data.status ?? "");
      client.disconnect();
    });

    // FR-07：getAgentRun → agent_session_id → fetchPendingDialogs 恢复未答 dialog，
    // 合并进 perms（按 request_id 去重）。失败静默，不阻断主流程。
    //
    // ql-20260623：无论 isActive 与否都执行——askuser pending 的 run 可能因
    // status 轮询延迟或边界情况导致 isActive=false（走下方 D-001 prefetch），
    // 此时仍需恢复审批卡片让用户能回答。dialog 恢复走 REST，不依赖 SSE 连接。
    // ⚠️ 用 agent_session_id（AgentSession 表 id），非 session_id（daemon 内部 id）——
    // fetchPendingDialogs 查 agent_sessions/session_dialog_requests 表，需 AgentSession.id。
    getAgentRun(workspaceId, runId)
      .then((run) => {
        if (cancelled) return undefined;
        if (!run.agent_session_id) return undefined;
        return fetchPendingDialogs(run.agent_session_id);
      })
      .then((dialogs) => {
        if (cancelled || !dialogs || dialogs.length === 0) return;
        setPerms((prev) => {
          const existing = new Set(prev.map((r) => r.request_id));
          const merged = [...prev];
          for (const d of dialogs) {
            if (!existing.has(d.request_id)) {
              merged.push(d);
              existing.add(d.request_id);
            }
          }
          return merged;
        });
      })
      .catch(() => {
        /* FR-07 失败不影响主流程 */
      });

    // D-001 分叉：isActive=false 只 prefetch 历史、不连 SSE
    if (!isActive) {
      // 底层 connect 会建 EventSource，违背 D-001 —— 改为手动调 getAgentRunLogs。
      // callbacks 仍注册（防御性，实际 isActive=false 不连不会被触发）。
      getAgentRunLogs(workspaceId, runId)
        .then((history) => {
          if (cancelled) return;
          setLogs(history);
          setLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          // prefetch 失败不阻断 UI，清 loading 让面板展示空态
          setLoading(false);
        });
      return; // ← 不调 client.connect
    }

    // 连 SSE（非阻塞，底层内部已先 prefetch 再建 EventSource）
    void client.connect(accessToken);

    // cleanup：runId/isActive/workspaceId 变化或组件卸载时 disconnect（R-01）
    return () => {
      cancelled = true;
      client.disconnect();
      clientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, runId, isActive, onDone, dismissPerm]);

  // —— 返回值组装 ——
  // P2.3：input 用 useMemo 稳定引用，set/submit 已 useCallback 稳定，
  // 仅在底层 values/submitting/errors/replied 变化时才产生新对象，
  // 避免消费 input 的子组件（AgentRunPanel）每次 render 都拿到新引用而失效 memo。
  const input = useMemo<AgentRunInputStream>(
    () => ({
      values: inputValues,
      submitting: submittingInputs,
      errors: inputErrors,
      replied: repliedInputs,
      set: setInputValue,
      submit: submitInput,
    }),
    [inputValues, submittingInputs, inputErrors, repliedInputs, setInputValue, submitInput],
  );

  return {
    logs,
    status,
    streaming,
    loading,
    error,
    perms,
    dismissPerm,
    input,
    clear,
  };
}

/**
 * 生成运行时 id 兜底（event.log_id 缺失时）。
 * 浏览器优先 crypto.randomUUID；否则时间戳+随机数（与 page.tsx safeUUID 同义）。
 */
function _safeRuntimeId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

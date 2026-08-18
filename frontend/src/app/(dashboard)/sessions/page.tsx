"use client";

/**
 * 智能体会话总入口页 /sessions（2026-08-14-sessions-portal task-10）。
 *
 * 依据：
 *   - tasks/task-10.md（allowed_paths / implementation / acceptance）
 *   - design.md §2 FR-01/FR-02、§5 Wave3 页面骨架段、§9（/runtimes 弹窗零回归 D-002）
 *   - prototype-sessions-portal.html（两栏布局 / 两态面板 / 横幅语义，视觉基准）
 *   - FRONTEND_PAGE_STYLE.md（PageContainer/PageHeader + antd 组件 + tailwind token）
 *
 * 结构（原型 .main-grid）：
 *   左 320px SessionListPanel（task-11：筛选 + 虚拟滚动 + 紧凑两行条目）；
 *   右两态——未选会话 = NewSessionForm（task-12 四选择器），选中会话 = SessionPanel
 *   （本页组装：TurnTimeline + SessionInputBar（task-13 共享子组件）+ CtxUsageBar
 *   （task-15）+ SessionConfigBar（task-14），SSE/attach 模式参照
 *   interactive-session-panel.tsx，弹窗组件不动）。
 *
 * 数据流：
 *   - 选中会话详情 = getAgentSession（react-query，pending/reconnecting 1.5s 轮询，
 *     切换配置 / 结束 / 重新开启后 invalidate 刷新）；
 *   - 历史 turn = attach 预取 getAgentSessionLogs → logsToTurns（防 SSE 订阅前丢事件）；
 *   - 实时 turn = streamSession 单条 SSE 贯穿（turn_started/log/turn_completed/tokens/
 *     session_ended/permission_*，处理逻辑对齐 interactive-session-panel）；
 *   - 发送 = injectSession（新会话创建走 NewSessionForm → onCreated 切入选中态）；
 *   - CtxUsageBar 累计 = 实时 turn input_tokens 前端求和（design R-06）；
 *   - whoLine（gap-fix / FR-07 / D-008@v1）：attach 时并发拉 listSessionRuns
 *     （run 级轮次快照），渲染时按 realRunId??runId 匹配注入——profileName 取
 *     agent_profile_snapshot.name、providerName 对照供应商列表（llm_provider_id
 *     null = 本机默认）、agentName 取 config_snapshot.agent_name / runtime 名兜底；
 *     快照缺键如实显示未指定，不编造。每轮 turn_completed 后刷新 runs 快照，
 *     切换配置后的新轮 whoLine 跟随新快照，历史轮不跟随（D-008）。
 *   - 历史 usage（gap-fix / FR-08 / R-06）：SSE 未覆盖的历史轮 inputTokens 由
 *     run.input_tokens 回填（?? 链保序，实时 SSE 值优先），CtxUsageBar 累计含历史。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Square } from "lucide-react";
import { Badge, Button, Spin, message } from "antd";

import { buildErrorLogItem } from "@/components/agent-log/normalize";
import { TurnTimeline, type SessionTurnView, type TurnUiStatus } from "@/components/daemon/turn-timeline";
import { SessionInputBar } from "@/components/daemon/session-input-bar";
import {
  classifySessionLog,
  isToolResultDenied,
  statusFromToolUseRaw,
} from "@/components/daemon/session-log-sanitize";
import { logsToTurns } from "@/components/daemon/runtime-session-helpers";
import { CtxUsageBar } from "@/components/sessions/ctx-usage-bar";
import { NewSessionForm } from "@/components/sessions/new-session-form";
import { SessionConfigBar } from "@/components/sessions/session-config-bar";
import { SessionListPanel } from "@/components/sessions/session-list-panel";
import { PageContainer, PageHeader } from "@/components/layout";
import { ApiError } from "@/lib/api";
import {
  listProviders,
  type LlmProviderRead,
  type LlmProviderRoleMapping,
} from "@/lib/api/llm-providers";
import { useDaemonMachines } from "@/lib/use-daemon-machines";
import {
  endSession,
  fetchPendingDialogs,
  fetchSessionDialogHistory,
  getAgentSession,
  getAgentSessionLogs,
  injectSession,
  interruptSession,
  listSessionRuns,
  PROVIDER_META,
  reopenSession,
  streamSession,
  type DaemonMachineRead,
  type SessionDialogRead,
  type SessionPermissionRequest,
  type SessionRunRead,
  type SessionStreamConnection,
  type SessionStreamEnvelope,
} from "@/lib/daemon";
import { cn } from "@/lib/utils";

const MAX_PROMPT_LEN = 8000;

/* ────────────────────── 页面 ────────────────────── */

export default function SessionsPortalPage() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const qc = useQueryClient();

  // 机器列表：SessionPanel 离线判定用（列表/表单/控件条各自另有数据源）。
  const { items: machines } = useDaemonMachines({ limit: 100 });

  // 供应商列表：CtxUsageRing 分母派生（role mapping one_m / fallback model）。
  const providersQ = useQuery({
    queryKey: ["llmProviders", "sessions-portal"],
    queryFn: listProviders,
    staleTime: 30_000,
  });
  const providers = useMemo(() => providersQ.data ?? [], [providersQ.data]);

  /** 会话配置/状态变化后刷新左侧列表（含 useDaemonMachines 的 sessions 旁路）。 */
  const refreshSessionLists = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["agentSessions"] });
  }, [qc]);

  return (
    <PageContainer
      size="full"
      className="h-[calc(100vh-56px)] gap-3 py-4"
      aria-label="智能体会话"
    >
      <PageHeader
        title="智能体会话"
        subtitle="跨机器、跨智能体的统一会话入口：左侧选择会话，右侧继续对话或新建"
        actions={
          selectedSessionId ? (
            <Button onClick={() => setSelectedSessionId(null)}>新建会话</Button>
          ) : null
        }
      />
      {/* 原型 .main-grid：左 320px 列表 + 右面板 */}
      <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] gap-3.5">
        <SessionListPanel
          selectedSessionId={selectedSessionId}
          onSelect={(s) => setSelectedSessionId(s.id)}
        />
        {selectedSessionId ? (
          <SessionPanel
            key={selectedSessionId}
            sessionId={selectedSessionId}
            machines={machines}
            providers={providers}
            onSessionListRefresh={refreshSessionLists}
          />
        ) : (
          <div className="min-h-0 overflow-y-auto rounded-lg border border-border bg-card px-6 py-6">
            <NewSessionForm
              onCreated={(resp) => {
                setSelectedSessionId(resp.session_id);
                refreshSessionLists();
              }}
            />
          </div>
        )}
      </div>
    </PageContainer>
  );
}

/* ────────────────────── SessionPanel：右侧会话态组装 ────────────────────── */

interface SessionPanelProps {
  sessionId: string;
  machines: DaemonMachineRead[];
  providers: LlmProviderRead[];
  /** 会话终态 / 配置切换后刷新左侧列表。 */
  onSessionListRefresh?: () => void;
}

/** turn 状态（currentRunId 只指向 pending/running/interrupting turn）。 */
interface TurnState {
  turns: SessionTurnView[];
  currentRunId: string | null;
}

const INITIAL_TURN_STATE: TurnState = { turns: [], currentRunId: null };

function SessionPanel({
  sessionId,
  machines,
  providers,
  onSessionListRefresh,
}: SessionPanelProps) {
  const qc = useQueryClient();

  // ── 会话详情（配置三列 + 状态 + current_run_id）────────────────────────
  const detailQuery = useQuery({
    queryKey: ["agentSessionDetail", sessionId],
    queryFn: () => getAgentSession(sessionId),
    // pending/reconnecting 期间轮询直到 active/终态（attach 恢复语义）。
    refetchInterval: (query) => {
      const st = query.state.data?.status;
      return st === "pending" || st === "reconnecting" ? 1500 : false;
    },
  });
  const session = detailQuery.data ?? null;

  // ── 实时 turn 状态机（对齐 interactive-session-panel 的 SSE 处理）───────
  const [turnState, setTurnState] = useState<TurnState>(INITIAL_TURN_STATE);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingRequests, setPendingRequests] = useState<
    SessionPermissionRequest[]
  >([]);
  const [dialogHistory, setDialogHistory] = useState<SessionDialogRead[]>([]);
  // gap-fix（FR-07 / FR-08）：run 级轮次快照（id → SessionRunRead），attach 时
  // 预取 + 每轮 turn_completed 后刷新，供 whoLine 注入与历史 usage 回填。
  const [runsMeta, setRunsMeta] = useState<Map<string, SessionRunRead>>(new Map());
  const [viewMode, setViewMode] = useState<"conversation" | "all">("conversation");
  const [input, setInput] = useState("");
  const [reopening, setReopening] = useState(false);

  const streamRef = useRef<SessionStreamConnection | null>(null);
  // partial 段起点（reply→outputStart / thinking→itemIndex），override 撤回用。
  const partialSegmentsRef = useRef<
    Map<
      string,
      { outputStart: number; length: number } | { itemIndex: number }
    >
  >(new Map());
  // 已拉取过 error_detail 的 failed run_id 集合（防 SSE 重连重复拉取）。
  const fetchedErrorRunIdsRef = useRef<Set<string>>(new Set());

  // ── SSE 建流 + 历史预取（sessionId 驱动，切换会话即重建）────────────────
  // gap-fix（FR-07/FR-08）：runs 快照拉取失败不阻断——whoLine 不注入、历史
  // usage 走实时 SSE 路径，与 logs 预取同一容错语义。
  const refreshRunsMeta = useCallback((id: string) => {
    void listSessionRuns(id)
      .then((runs) => {
        setRunsMeta(new Map(runs.map((r) => [r.id, r])));
      })
      .catch(() => {
        /* 快照拉取失败不阻断主流程 */
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setTurnState(INITIAL_TURN_STATE);
    setErrorMsg(null);
    setPendingRequests([]);
    setRunsMeta(new Map());
    partialSegmentsRef.current.clear();
    fetchedErrorRunIdsRef.current.clear();

    // 预取历史 logs 回灌（防 SSE 订阅前 daemon publish 丢事件）；已有实时
    // turn 时不覆盖（SSE 先到时保留）。
    void getAgentSessionLogs(sessionId)
      .then((logs) => {
        if (cancelled) return;
        const restored = logsToTurns(logs);
        setTurnState((prev) => (prev.turns.length > 0 ? prev : { ...prev, turns: restored }));
      })
      .catch(() => {
        /* 历史拉取失败不阻断 SSE */
      });

    // gap-fix：attach 并发拉 run 级轮次快照（whoLine + 历史 usage 数据源）。
    void listSessionRuns(sessionId)
      .then((runs) => {
        if (cancelled) return;
        setRunsMeta(new Map(runs.map((r) => [r.id, r])));
      })
      .catch(() => {
        /* 快照拉取失败不阻断 SSE */
      });

    streamRef.current = streamSession(sessionId, {
      onTurnStarted: (env) => {
        setTurnState((prev) =>
          upsertTurn(
            prev,
            env,
            (turn) => ({
              ...turn,
              turn: env.turn ?? turn.turn,
              status: turn.status === "pending" ? "running" : turn.status,
            }),
            { setCurrentRun: env.run_id! },
          ),
        );
      },
      onLog: (env) => {
        // user_input 是用户消息（attach 历史/占位 turn 已作 prompt），不进 output。
        if (env.channel === "user_input") return;
        setTurnState((prev) =>
          upsertTurn(
            prev,
            env,
            (turn) => applyLogToTurn(turn, env, partialSegmentsRef.current),
            {},
          ),
        );
      },
      onTurnCompleted: (env) => {
        const terminal = deriveTurnTerminalStatus(env);
        setTurnState((prev) =>
          upsertTurn(
            prev,
            env,
            (turn) => ({
              ...turn,
              status: terminal,
              inputTokens: env.input_tokens ?? turn.inputTokens,
              outputTokens: env.output_tokens ?? turn.outputTokens,
            }),
            { clearCurrentRun: env.run_id! },
          ),
        );
        // turn 边界清空 partial 段 Map（防跨 turn segmentId 复用误撤回）。
        partialSegmentsRef.current.clear();

        // gap-fix（D-008@v1）：每轮终态后刷新 run 快照——本轮 whoLine/usage 由
        // run 行（dispatch 冻结）注入，切换配置后的下一轮跟随新快照。
        refreshRunsMeta(sessionId);

        // 失败轮拉取结构化错误详情（同 run 只拉一次，供 RunErrorItem 渲染）。
        if (
          terminal === "failed" &&
          env.run_id &&
          !fetchedErrorRunIdsRef.current.has(env.run_id)
        ) {
          const failedRunId = env.run_id;
          fetchedErrorRunIdsRef.current.add(failedRunId);
          void (async () => {
            try {
              const runs = await listSessionRuns(sessionId);
              const matched = runs.find((r) => r.id === failedRunId);
              const item = buildErrorLogItem(matched?.error_detail ?? null);
              if (!item) return;
              setTurnState((prev) => ({
                ...prev,
                turns: prev.turns.map((t) =>
                  t.runId === failedRunId && !t.errorDetail
                    ? { ...t, errorDetail: item }
                    : t,
                ),
              }));
            } catch {
              /* 拉取失败不阻塞：失败 turn 仍有状态徽标 */
            }
          })();
        }
      },
      onTokens: (env) => {
        setTurnState((prev) =>
          upsertTurn(
            prev,
            env,
            (turn) => ({
              ...turn,
              inputTokens: env.input_tokens ?? turn.inputTokens,
              outputTokens: env.output_tokens ?? turn.outputTokens,
            }),
            {},
          ),
        );
      },
      onSessionEnded: () => {
        // streamSession 内部已 close；收口本地态 + 刷新详情/列表。
        setTurnState((prev) => ({ ...prev, currentRunId: null }));
        setPendingRequests([]);
        streamRef.current = null;
        void qc.invalidateQueries({ queryKey: ["agentSessionDetail", sessionId] });
        onSessionListRefresh?.();
      },
      onError: () => {
        // 不伪造终态；浏览器携 Last-Event-ID 自动重连。
      },
      onPermissionRequest: (req) => {
        if (!req.dialog_kind) return;
        setPendingRequests((prev) =>
          prev.some((r) => r.request_id === req.request_id)
            ? prev
            : [...prev, req],
        );
      },
      onPermissionResolved: (resolved) => {
        setPendingRequests((prev) =>
          prev.filter((r) => r.request_id !== resolved.request_id),
        );
      },
    });

    return () => {
      cancelled = true;
      streamRef.current?.close();
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ── pending AskUser 对话 + 问答历史恢复（REST，SSE 只推实时增量）────────
  useEffect(() => {
    let cancelled = false;
    void fetchPendingDialogs(sessionId)
      .then((dialogs) => {
        if (cancelled || !dialogs || dialogs.length === 0) return;
        setPendingRequests((prev) => {
          const existing = new Set(prev.map((r) => r.request_id));
          const merged = [...prev];
          for (const d of dialogs) {
            if (d.dialog_kind && !existing.has(d.request_id)) merged.push(d);
          }
          return merged.length === prev.length ? prev : merged;
        });
      })
      .catch(() => {
        /* 恢复失败不阻塞 SSE */
      });
    void fetchSessionDialogHistory(sessionId)
      .then((history) => {
        if (cancelled || !history) return;
        setDialogHistory(history);
      })
      .catch(() => {
        /* 历史拉取失败不阻塞主流程 */
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // ── attach 恢复运行中轮：detail.current_run_id 回填（SSE 只推新事件）────
  useEffect(() => {
    if (!session || session.status !== "active" || !session.current_run_id) return;
    const runId = session.current_run_id;
    setTurnState((prev) => {
      if (prev.currentRunId) return prev;
      return {
        currentRunId: runId,
        // logsToTurns 把历史 turn 一律标 completed；运行中的真实 run 修正为 running。
        turns: prev.turns.map((t) =>
          t.realRunId === runId && t.status === "completed"
            ? { ...t, status: "running" }
            : t,
        ),
      };
    });
  }, [session]);

  // ── 派生态 ─────────────────────────────────────────────────────────────
  const machineHit = useMemo(() => {
    if (!session?.runtime_id) return null;
    return (
      machines.find((m) => (m.runtimes ?? []).some((r) => r.id === session.runtime_id)) ??
      null
    );
  }, [machines, session?.runtime_id]);
  // 找不到所属机器（列表分页外/已删除）不武断判离线。
  const machineOnline = machineHit ? machineHit.status === "online" : true;
  const machineName = machineHit
    ? machineHit.display_alias?.trim() || machineHit.hostname
    : session?.config_snapshot?.machine_name ?? null;

  const status = session?.status ?? null;
  const ended = status === "ended" || status === "failed";
  const restoring = status === "pending" || status === "reconnecting";
  const running = turnState.currentRunId != null;

  // ── gap-fix（FR-07 / FR-08）：whoLine 注入 + 历史 usage 回填（渲染时派生）──
  // agentName：AgentRun 不存 runtime 展示名，按 config_snapshot.agent_name →
  // runtime 别名/名称 → 引擎 label 链兜底；快照缺键如实显示，不编造。
  const runtimeHit = useMemo(
    () =>
      machines.flatMap((m) => m.runtimes ?? []).find(
        (r) => r.id === session?.runtime_id,
      ) ?? null,
    [machines, session?.runtime_id],
  );
  const agentDisplayName = useMemo(() => {
    const fromSnapshot = session?.config_snapshot?.agent_name?.trim();
    if (fromSnapshot) return fromSnapshot;
    const fromRuntime =
      runtimeHit?.display_alias?.trim() || runtimeHit?.name?.trim() || null;
    if (fromRuntime) return fromRuntime;
    return session
      ? (PROVIDER_META[session.provider]?.label ?? session.provider)
      : "";
  }, [session, runtimeHit]);

  // 按 run 快照补 whoLine / 历史 usage：只补缺（?? 链），实时 SSE 值优先；
  // run 快照缺失（拉取失败 / 占位 turn）原样返回——whoLine 不渲染（零回归）。
  const displayTurns = useMemo(() => {
    if (runsMeta.size === 0) return turnState.turns;
    return turnState.turns.map((t) => {
      const meta = runsMeta.get(t.realRunId ?? t.runId);
      if (!meta) return t;
      return {
        ...t,
        // ql-20260817-003：轮次发送者（run.user_id + sender_name；旧 run NULL 不显示）。
        sender:
          t.sender ?? (meta.user_id && meta.sender_name
            ? {
                name: meta.sender_name,
                // 会话属主 = 当前用户时显示「我」；其它用户显示真实名（共享守护进程场景）。
                me: meta.user_id === session?.user_id,
                at: meta.started_at ?? null,
              }
            : undefined),
        whoLine: t.whoLine ?? {
          // 快照缺 name / 无快照 = 该轮未指定档案 → null（TurnTimeline 显「未指定」）
          profileName: meta.agent_profile_snapshot?.name ?? null,
          agentName: agentDisplayName,
          // llm_provider_id null（未选/已删 SET NULL）= 本机默认；有 id 但列表
          // 未命中（列表未加载完）暂 null，memo 随 providers 到位自愈。
          providerName: meta.llm_provider_id
            ? (providers.find((p) => p.id === meta.llm_provider_id)?.name ?? null)
            : null,
        },
        inputTokens: t.inputTokens ?? meta.input_tokens ?? null,
        outputTokens: t.outputTokens ?? meta.output_tokens ?? null,
        // ql-20260817-004：答复完成时间（finished_at 优先；运行中/旧数据 null 不显示）。
        replyAt: t.replyAt ?? meta.finished_at ?? meta.started_at ?? null,
      };
    });
  }, [turnState.turns, runsMeta, providers, agentDisplayName, session?.user_id]);

  // CtxUsageBar：累计 usage（实时 turn input_tokens 求和 + 历史轮回填，R-06 前端累计）
  // + 分母派生（会话供应商 role mapping one_m → fallback model，D-014）。
  const ctxProvider = useMemo(
    () => providers.find((p) => p.id === session?.llm_provider_id) ?? null,
    [providers, session?.llm_provider_id],
  );
  const ctxRoleMapping = useMemo<LlmProviderRoleMapping | null>(() => {
    const mrm = ctxProvider?.model_role_mappings;
    if (!mrm) return null;
    return mrm["sonnet"] ?? Object.values(mrm)[0] ?? null;
  }, [ctxProvider]);
  const ctxFallbackModel =
    ctxProvider?.default_fallback_model ?? ctxProvider?.model ?? null;
  const usedTokens = useMemo(
    () => displayTurns.reduce((n, t) => n + (t.inputTokens ?? 0), 0),
    [displayTurns],
  );

  // ── 操作 ───────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || prompt.length > MAX_PROMPT_LEN) return;
    if (!session || ended || restoring || !machineOnline) return;
    if (turnState.currentRunId) return; // turn 级串行
    setInput("");
    const placeholderId = `__pending_inject_${Date.now()}__`;
    setTurnState((prev) => ({
      currentRunId: placeholderId,
      turns: [
        ...prev.turns,
        {
          runId: placeholderId,
          turn: null,
          prompt,
          output: "",
          status: "pending",
          seenLogIds: new Set(),
          inputTokens: null,
          outputTokens: null,
          errorDetail: null,
          processItems: [],
        },
      ],
    }));
    try {
      const resp = await injectSession(sessionId, prompt);
      setTurnState((prev) => ({
        currentRunId: resp.run_id,
        turns: prev.turns.map((t) =>
          t.runId === placeholderId
            ? { ...t, runId: resp.run_id, status: "running" }
            : t,
        ),
      }));
      setErrorMsg(null);
    } catch (err) {
      const apiErr = err as ApiError;
      const isTurnConflict =
        apiErr instanceof ApiError &&
        apiErr.status === 409 &&
        apiErr.code === "DAEMON_SESSION_TURN_CONFLICT";
      setTurnState((prev) => ({
        currentRunId: null,
        turns: prev.turns.filter((t) => t.runId !== placeholderId),
      }));
      setErrorMsg(apiErr instanceof ApiError ? apiErr.message : "发送失败");
      if (isTurnConflict) setInput(prompt); // 保留 prompt 供重试
    }
  }, [input, session, ended, restoring, machineOnline, turnState.currentRunId, sessionId]);

  const handleInterrupt = useCallback(async () => {
    if (!session || session.status !== "active" || !turnState.currentRunId) return;
    const localRunId = turnState.currentRunId;
    setTurnState((prev) => ({
      ...prev,
      turns: prev.turns.map((t) =>
        t.runId === localRunId ? { ...t, status: "interrupting" } : t,
      ),
    }));
    try {
      await interruptSession(sessionId);
      // turn 终态由 SSE turn_completed 决定；session 仍 active。
    } catch (err) {
      const apiErr = err as ApiError;
      const isNoCurrentRun =
        apiErr instanceof ApiError &&
        apiErr.status === 409 &&
        apiErr.code === "DAEMON_SESSION_NO_CURRENT_RUN";
      if (isNoCurrentRun) {
        setTurnState((prev) => ({
          currentRunId: null,
          turns: prev.turns.map((t) =>
            t.runId === localRunId && (t.status === "interrupting" || t.status === "running")
              ? { ...t, status: "killed" }
              : t,
          ),
        }));
      } else {
        setTurnState((prev) => ({
          ...prev,
          turns: prev.turns.map((t) =>
            t.runId === localRunId && t.status === "interrupting"
              ? { ...t, status: "running" }
              : t,
          ),
        }));
        setErrorMsg(apiErr instanceof ApiError ? apiErr.message : "打断失败");
      }
    }
  }, [session, turnState.currentRunId, sessionId]);

  const handleEnd = useCallback(async () => {
    if (!session || session.status !== "active") return;
    try {
      await endSession(sessionId);
      streamRef.current?.close();
      streamRef.current = null;
      setTurnState((prev) => ({ ...prev, currentRunId: null }));
      await qc.invalidateQueries({ queryKey: ["agentSessionDetail", sessionId] });
      onSessionListRefresh?.();
    } catch (err) {
      const apiErr = err as ApiError;
      setErrorMsg(
        apiErr instanceof ApiError ? apiErr.message : "结束会话失败，请重试",
      );
    }
  }, [session, sessionId, qc, onSessionListRefresh]);

  const handleReopen = useCallback(async () => {
    setReopening(true);
    try {
      await reopenSession(sessionId);
      await qc.invalidateQueries({ queryKey: ["agentSessionDetail", sessionId] });
      onSessionListRefresh?.();
    } catch (err) {
      const apiErr = err as ApiError;
      message.error(apiErr instanceof ApiError ? apiErr.message : "重新开启失败");
    } finally {
      setReopening(false);
    }
  }, [sessionId, qc, onSessionListRefresh]);

  const handleResend = useCallback(
    async (prompt: string) => {
      if (!session || session.status !== "active") return;
      if (!machineOnline || turnState.currentRunId) return;
      const trimmed = prompt.trim();
      if (!trimmed || trimmed.length > MAX_PROMPT_LEN) return;
      const placeholderId = `__pending_inject_${Date.now()}__`;
      setTurnState((prev) => ({
        currentRunId: placeholderId,
        turns: [
          ...prev.turns,
          {
            runId: placeholderId,
            turn: null,
            prompt: trimmed,
            output: "",
            status: "pending",
            seenLogIds: new Set(),
            inputTokens: null,
            outputTokens: null,
            errorDetail: null,
            processItems: [],
          },
        ],
      }));
      try {
        const resp = await injectSession(sessionId, trimmed);
        setTurnState((prev) => ({
          currentRunId: resp.run_id,
          turns: prev.turns.map((t) =>
            t.runId === placeholderId
              ? { ...t, runId: resp.run_id, status: "running" }
              : t,
          ),
        }));
        setErrorMsg(null);
      } catch (err) {
        const apiErr = err as ApiError;
        setTurnState((prev) => ({
          currentRunId: null,
          turns: prev.turns.filter((t) => t.runId !== placeholderId),
        }));
        setErrorMsg(apiErr instanceof ApiError ? apiErr.message : "重新发送失败");
      }
    },
    [session, machineOnline, turnState.currentRunId, sessionId],
  );

  const handleDialogResolved = useCallback((requestId: string) => {
    setPendingRequests((prev) => prev.filter((r) => r.request_id !== requestId));
  }, []);

  // ── 渲染 ───────────────────────────────────────────────────────────────
  if (detailQuery.isError) {
    return (
      <div className="m-6 rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive" aria-label="会话详情加载失败">
        加载会话详情失败：{detailQuery.error?.message ?? "未知错误"}
        <Button
          size="small"
          className="ml-3"
          onClick={() => void detailQuery.refetch()}
        >
          重新加载
        </Button>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="flex h-full items-center justify-center" data-testid="session-detail-loading">
        <Spin />
      </div>
    );
  }

  const sendingDisabled = ended || restoring || running || !machineOnline;
  const placeholder = ended
    ? "会话已结束，请新建会话"
    : !machineOnline
      ? "机器离线，输入不可用…"
      : restoring
        ? "恢复会话中…"
        : running
          ? "等待本轮完成..."
          : "继续追问…（Enter 发送 · Shift+Enter 换行）";

  const interruptDisabled =
    session.status !== "active" || !turnState.currentRunId || !machineOnline;
  const endDisabled = session.status !== "active" || !machineOnline;

  // ql-20260815-011：无真实标题不渲染占位「未命名会话」，只留 id 短码。
  const title = session.title?.trim() || "";
  const statusBadge =
    session.status === "active"
      ? { status: "processing" as const, text: "活跃" }
      : session.status === "ended"
        ? { status: "default" as const, text: "已结束" }
        : session.status === "failed"
          ? { status: "error" as const, text: "已失败" }
          : { status: "warning" as const, text: "恢复中" };

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card"
      aria-label="会话面板"
    >
      {/* 面板头：标题 + 会话 id 短码（点击复制，ql-20260815-010）+ 状态 + 视图切换 + 打断/结束 */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {title && (
            <span className="truncate text-sm font-semibold text-foreground">
              {title}
            </span>
          )}
          {/* 会话 id 短码：点击复制完整 id（排障/引用入口），message 反馈。 */}
          <button
            type="button"
            aria-label="复制会话 ID"
            title={`点击复制会话 ID：${session.id}`}
            onClick={() => {
              void navigator.clipboard
                ?.writeText(session.id)
                .then(() => message.success("已复制会话 ID"))
                .catch(() => message.error("复制失败"));
            }}
            className="shrink-0 cursor-pointer rounded px-1 py-0.5 font-mono text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            #{session.id.slice(0, 8)}
          </button>
          <Badge status={statusBadge.status} text={statusBadge.text} />
          {machineName && (
            <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
              🖥 {machineName}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {turnState.turns.length > 0 && (
            <div
              role="tablist"
              aria-label="消息显示范围"
              className="inline-flex items-center rounded-full border bg-muted/50 p-0.5"
            >
              {(["conversation", "all"] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={viewMode === m}
                  onClick={() => setViewMode(m)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] leading-none transition-colors",
                    viewMode === m
                      ? "bg-card font-medium text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m === "conversation" ? "对话" : "全部"}
                </button>
              ))}
            </div>
          )}
          <Button
            size="small"
            icon={<Ban className="h-3 w-3" />}
            disabled={interruptDisabled}
            onClick={() => void handleInterrupt()}
            title="打断本轮（session 保持 active）"
          >
            打断本轮
          </Button>
          <Button
            size="small"
            danger
            icon={<Square className="h-3 w-3" />}
            disabled={endDisabled}
            onClick={() => void handleEnd()}
            title="结束整个会话"
          >
            结束会话
          </Button>
        </div>
      </header>

      {/* 离线只读横幅（2026-07-31-offline-session-readonly 语义） */}
      {!machineOnline && (
        <div className="flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-5 py-2 text-xs text-amber-800">
          <span aria-hidden>⚠️</span>
          <span>
            会话所属机器{machineName ? `（${machineName}）` : ""}当前离线 —— 可浏览历史消息，暂不能继续对话；机器恢复在线后可继续。
          </span>
        </div>
      )}
      {/* 已结束/失败横幅 + 重新开启（原型 .ended-banner） */}
      {ended && (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-5 py-2 text-xs text-muted-foreground">
          <span>
            会话已{session.status === "failed" ? "失败" : "结束"} —— 可浏览历史消息
          </span>
          <Button size="small" loading={reopening} onClick={() => void handleReopen()}>
            重新开启
          </Button>
        </div>
      )}

      {/* 消息流（task-13 共享子组件；弹窗与新页面同构复用）。
          gap-fix：turns 用 displayTurns（whoLine + 历史 usage 注入后的派生视图）。 */}
      <TurnTimeline
        turns={displayTurns}
        viewMode={viewMode}
        errorMsg={errorMsg}
        sessionStatus={
          ended
            ? session.status === "failed"
              ? "failed"
              : "ended"
            : restoring
              ? "reconnecting"
              : "active"
        }
        pendingRequests={pendingRequests}
        dialogHistory={dialogHistory}
        onDialogResolved={handleDialogResolved}
        onResend={(prompt) => {
          void handleResend(prompt);
        }}
        onSwitchProvider={() => {
          if (typeof window !== "undefined") {
            window.location.assign("/settings");
          }
        }}
        hasOnlineProvider={machineOnline}
        emptyProviderLabel={
          PROVIDER_META[session.provider]?.label ?? session.provider
        }
      />

      {/* 输入区：ctx 用量行 + 输入框 + 配置控件条（原型 .input-zone） */}
      <div className="flex shrink-0 flex-col bg-card">
        <div className="px-5 pt-3">
          <CtxUsageBar
            usedTokens={usedTokens}
            roleMapping={ctxRoleMapping}
            fallbackModel={ctxFallbackModel}
            providerId={session.llm_provider_id ?? null}
          />
        </div>
        <SessionInputBar
          value={input}
          onChange={setInput}
          onSend={() => {
            void handleSend();
          }}
          disabled={sendingDisabled}
          placeholder={placeholder}
          creating={false}
        />
        <div className="px-5 pb-3">
          <SessionConfigBar
            sessionId={sessionId}
            running={running}
            ended={ended || !machineOnline}
            agentProfileId={session.agent_profile_id ?? null}
            llmProviderId={session.llm_provider_id ?? null}
            configSnapshot={session.config_snapshot ?? null}
            runtimeId={session.runtime_id ?? null}
            engine={session.provider ?? null}
            onSwitched={() => {
              // 切换成功 → 刷新会话详情（三列快照）+ 左侧列表 chips + runsMeta
              // （立即显示新 whoLine，不等重进页面）。
              void qc.invalidateQueries({ queryKey: ["agentSessionDetail", sessionId] });
              onSessionListRefresh?.();
              void listSessionRuns(sessionId)
                .then((runs) => setRunsMeta(new Map(runs.map((r) => [r.id, r]))))
                .catch(() => {});
            }}
          />
        </div>
      </div>
    </section>
  );
}

/* ────────────────────── SSE turn 状态机辅助（对齐 interactive-session-panel） ────────────────────── */

const TERMINAL_TURN_STATUSES: ReadonlySet<TurnUiStatus> = new Set([
  "completed",
  "failed",
  "killed",
]);

interface UpsertOpts {
  setCurrentRun?: string;
  clearCurrentRun?: string;
}

/**
 * 按 env.run_id upsert turn；unknown run id 先建无 prompt turn。
 * 终态幂等：已终态的 turn 不被后续事件覆盖（log 事件例外——turn_completed 可能
 * 先于 log 到达，output 尚未追加）。
 */
function upsertTurn(
  prev: TurnState,
  env: SessionStreamEnvelope,
  apply: (_turn: SessionTurnView) => SessionTurnView,
  opts: UpsertOpts,
): TurnState {
  const runId = env.run_id;
  if (!runId) return prev;
  // ql-20260817-007：attach 历史 turn 的 key 是伪 id（__attach_history_N__），
  // 真实 id 在 realRunId——SSE 事件按两者匹配，命中即合并到既有 turn，
  // 否则同一 run 会渲染出第二个「正在思考…」空块（新建会话输入后复现）。
  const idx = prev.turns.findIndex(
    (t) => t.runId === runId || t.realRunId === runId,
  );
  let turns: SessionTurnView[];
  if (idx === -1) {
    const newTurn: SessionTurnView = {
      runId,
      turn: env.turn ?? null,
      prompt: "",
      output: "",
      status: "running",
      seenLogIds: new Set(),
      inputTokens: env.input_tokens ?? null,
      outputTokens: env.output_tokens ?? null,
      errorDetail: null,
      processItems: [],
    };
    turns = [...prev.turns, apply(newTurn)];
  } else {
    turns = prev.turns.map((t, i) => {
      if (i !== idx) return t;
      if (env.event !== "log" && TERMINAL_TURN_STATUSES.has(t.status)) return t;
      return apply(t);
    });
  }
  let currentRunId = prev.currentRunId;
  if (opts.setCurrentRun) currentRunId = opts.setCurrentRun;
  if (opts.clearCurrentRun && currentRunId === opts.clearCurrentRun) {
    currentRunId = null;
  }
  return { turns, currentRunId };
}

/**
 * 单条 log 事件落到 turn：分类分流（thinking/tool/stderr/reply/override），
 * log_id 去重、tool use/result 配对、partial 段起点记录与 override 撤回
 * （2026-08-03-session-stream-partial-revoke 语义，对齐 interactive-session-panel onLog）。
 */
function applyLogToTurn(
  turn: SessionTurnView,
  env: SessionStreamEnvelope,
  partialSegments: Map<
    string,
    { outputStart: number; length: number } | { itemIndex: number }
  >,
): SessionTurnView {
  if (env.log_id && turn.seenLogIds.has(env.log_id)) return turn;
  const nextSeen = new Set(turn.seenLogIds);
  if (env.log_id) nextSeen.add(env.log_id);

  const seg = classifySessionLog(env.content ?? "", env.channel);
  if (!seg) return turn;

  // override 撤回令箭：按 segmentId 精确撤回已渲染的半截（Map 无此 id 静默 no-op）。
  if (seg.kind === "override" && seg.segmentId) {
    const start = partialSegments.get(seg.segmentId);
    if (!start) return turn;
    partialSegments.delete(seg.segmentId);
    if (seg.variant === "assistant" && "outputStart" in start) {
      const end = start.outputStart + (start.length ?? 0);
      return {
        ...turn,
        seenLogIds: nextSeen,
        output: turn.output.slice(0, start.outputStart) + turn.output.slice(end),
      };
    }
    if (seg.variant === "thinking" && "itemIndex" in start) {
      return {
        ...turn,
        seenLogIds: nextSeen,
        processItems: (turn.processItems ?? []).filter(
          (_, i) => i !== start.itemIndex,
        ),
      };
    }
    return turn;
  }

  const ts = env.timestamp ? Date.parse(env.timestamp) : undefined;
  if (seg.kind === "tool_use") {
    return {
      ...turn,
      seenLogIds: nextSeen,
      processItems: [
        ...(turn.processItems ?? []),
        { kind: "tool", raw: seg.text, status: statusFromToolUseRaw(seg.text), ts },
      ],
    };
  }
  if (seg.kind === "tool_result") {
    const items = [...(turn.processItems ?? [])];
    let paired = false;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const it = items[i];
      if (it && it.kind === "tool" && it.result === undefined) {
        const status = isToolResultDenied(seg.text)
          ? "deny"
          : it.status === "running"
            ? "ok"
            : it.status;
        items[i] = { kind: "tool", raw: it.raw, result: seg.text, status, ts: it.ts };
        paired = true;
        break;
      }
    }
    if (!paired) {
      items.push({
        kind: "tool",
        raw: "",
        result: seg.text,
        status: isToolResultDenied(seg.text) ? "deny" : "ok",
        ts,
      });
    }
    return { ...turn, seenLogIds: nextSeen, processItems: items };
  }
  if (seg.kind === "reply") {
    // partial reply 先记半截起点（concat 前 output 长度），override 到达时截断撤回。
    if (env.segment_id) {
      const existing = partialSegments.get(env.segment_id);
      if (existing && "outputStart" in existing) {
        existing.length += seg.text.length;
      } else {
        partialSegments.set(env.segment_id, {
          outputStart: turn.output.length,
          length: seg.text.length,
        });
      }
    }
    return {
      ...turn,
      seenLogIds: nextSeen,
      // 流式 delta 直接 concat（不加 \n，保留 markdown 连续结构）。
      output: turn.output + seg.text,
    };
  }
  // partial thinking 先记即将 append 的项索引，override 到达时按索引移除。
  if (seg.kind === "thinking" && env.segment_id) {
    partialSegments.set(env.segment_id, {
      itemIndex: (turn.processItems ?? []).length,
    });
  }
  return {
    ...turn,
    seenLogIds: nextSeen,
    processItems: [
      ...(turn.processItems ?? []),
      seg.kind === "thinking"
        ? { kind: "thinking", text: seg.text, ts }
        : { kind: "stderr", text: seg.text, ts },
    ],
  };
}

/** turn_completed 的 status/exit_code → TurnUiStatus 终态。 */
function deriveTurnTerminalStatus(env: SessionStreamEnvelope): TurnUiStatus {
  const status = env.status;
  if (status === "failed") return "failed";
  if (status === "killed" || status === "cancelled") return "killed";
  if (env.exit_code !== null && env.exit_code !== 0 && env.status === null) {
    return env.exit_code === 130 || env.exit_code === 143 ? "killed" : "failed";
  }
  return "completed";
}

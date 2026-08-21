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
 *     session_ended/permission_*）。task-09（2026-08-19-session-stream-ux / FR-05）：
 *     onLog 统一归一为 AssemblerLogInput 喂共享装配器 applyLogToSegments
 *     （session-log-assembler），本文件不再保留 applyLogToTurn 副本与
 *     partialSegmentsRef——分类 / override 撤回 / tool 配对 / 子代理归属一律依赖
 *     装配器导出；头部挂子代理目录（SubagentCatalog，FR-04，点击切「进度」视图并
 *     定位对应子代理块）；viewMode「全部」文案改「进度」；计时锚点接线（FR-02）：
 *     live = 发送占位 Date.now()，displayTurns 按 ?? 链补 run 快照 started_at
 *     （已有值优先，run 快照次之，首条 log timestamp 由装配器兜底写入）；
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
import { Ban } from "lucide-react";
import { Badge, Button, Spin } from "antd";

import { buildErrorLogItem } from "@/components/agent-log/normalize";
import {
  applyLogToSegments,
  createEmptyAssembledTurn,
  finishTurn,
  type AssembledTurn,
  type AssemblerLogInput,
  type TurnSegment,
} from "@/components/daemon/session-log-assembler";
import { TurnTimeline, type SessionTurnView, type TurnUiStatus } from "@/components/daemon/turn-timeline";
import type { AttachmentRead } from "@/lib/api/session-attachments";
import { parseAttachmentMarkers } from "@/components/daemon/runtime-session-helpers";
import { SessionInputBar } from "@/components/daemon/session-input-bar";
import { logsToTurns } from "@/components/daemon/runtime-session-helpers";
import { CtxUsageBar } from "@/components/sessions/ctx-usage-bar";
import { NewSessionForm } from "@/components/sessions/new-session-form";
import { SessionConfigBar } from "@/components/sessions/session-config-bar";
import { SessionListPanel } from "@/components/sessions/session-list-panel";
import { SubagentCatalog } from "@/components/sessions/subagent-catalog";
import { PageContainer, PageHeader } from "@/components/layout";
import { ApiError } from "@/lib/api";
import { useNotify } from "@/lib/errors";
import {
  listProviders,
  type LlmProviderRead,
  type LlmProviderRoleMapping,
} from "@/lib/api/llm-providers";
import { useDaemonMachines } from "@/lib/use-daemon-machines";
import { listWorkspaces } from "@/lib/workspaces";
import {
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

/**
 * task-08（2026-08-21-session-reopen-resume / FR-09）：重新开启 409 错误码 → 中文
 * 文案映射。后端 reopen 409 的 message 是英文原文（DaemonSessionNotActive 等
 * AppError 子类），errMessage 默认透传 err.message——errors.ts 不在本卡
 * allowed_paths，映射收敛在本页，handleReopen notify 前查表，未命中回退既有行为。
 * 错误码对齐 backend/app/modules/daemon/session/service.py:188-256（含 task-04
 * 新增的空 cwd 码 HTTP_409_DAEMON_SESSION_NO_CWD，DS-7）。
 */
const REOPEN_ERROR_ZH: Record<string, string> = {
  // 窗口内二次重开（后端 180s 恢复窗口内会话尚在恢复）
  HTTP_409_DAEMON_SESSION_NOT_ACTIVE: "会话仍在恢复中，请稍后再试",
  // agent_session_id IS NULL（创建时 SDK 握手未成功，D-004@v1）
  HTTP_409_DAEMON_SESSION_NO_AGENT_SESSION: "该会话缺少恢复凭证，无法重新开启",
  // provider 不支持 resume（非 claude/codex）
  HTTP_409_DAEMON_SESSION_RESUME_UNSUPPORTED: "该会话类型不支持重新开启",
  // 目标 runtime 无活跃 WS 连接
  HTTP_409_DAEMON_OFFLINE: "执行代理当前不在线，请先启动 daemon 后重试",
  // scan/bootstrap 会话不写 cwd，SDK resume 无法定位 transcript（DS-7）
  HTTP_409_DAEMON_SESSION_NO_CWD: "该会话缺少工作目录记录，无法重新开启",
};

/**
 * task-08（DS-5）：reconnecting 本地超时阈值。240s = 后端 180s 重开窗口 + 60s
 * 缓冲——前端按钮出现时后端必已放行 reopen；后端 180s 仍是权威校验。
 */
const RECONNECT_TIMEOUT_MS = 240_000;

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
          onDeleteSessions={async (ids) => {
            // ql-20260818-012：逐条调 deleteAgentSession（后端软删），完成后
            // invalidate 列表 + 清除选中态（若选中被删的会话）。
            const { deleteAgentSession } = await import("@/lib/daemon");
            await Promise.allSettled(ids.map((id) => deleteAgentSession(id)));
            void qc.invalidateQueries({ queryKey: ["agentSessions"] });
            if (ids.includes(selectedSessionId ?? "")) setSelectedSessionId(null);
          }}
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
  const notify = useNotify();

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

  // ── 工作区名称解析（面板头部显示）─────────────────────────────────────────
  const workspacesQuery = useQuery({
    queryKey: ["workspaces", "session-panel"],
    queryFn: () => listWorkspaces({ limit: 100 }),
    staleTime: 60_000,
  });
  const workspaceName = useMemo(() => {
    if (!session?.workspace_id) return null;
    return (
      workspacesQuery.data?.items.find((ws) => ws.id === session.workspace_id)
        ?.name ?? null
    );
  }, [session?.workspace_id, workspacesQuery.data]);

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
  // 2026-08-20 task-12：待发送附件 ids（SessionInputBar 上传产物）与清理句柄。
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentRead[]>([]);
  const clearAttachmentsRef = useRef<(() => void) | null>(null);
  const [reopening, setReopening] = useState(false);

  const streamRef = useRef<SessionStreamConnection | null>(null);
  // 面板根 ref（task-09 / FR-04）：子代理目录跳转的 DOM 定位查询范围（限面板内）。
  const panelRef = useRef<HTMLElement | null>(null);
  // 已拉取过 error_detail 的 failed run_id 集合（防 SSE 重连重复拉取）。
  const fetchedErrorRunIdsRef = useRef<Set<string>>(new Set());
  // attach 竞态修复（ql-20260820-007）：镜像最新 detail.current_run_id。历史 logs
  // 回灌可能晚于 detail 到达——彼时下方 attach 修正 effect 已对空 turns 扫过且其
  // currentRunId 守卫不再重放，回灌时据本 ref 重放同一修正，使两种到达顺序结果一致。
  const currentRunIdRef = useRef<string | null>(null);

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
    fetchedErrorRunIdsRef.current.clear();
    currentRunIdRef.current = null;

    // 预取历史 logs 回灌（防 SSE 订阅前 daemon publish 丢事件）；已有实时
    // turn 时不覆盖（SSE 先到时保留）。
    void getAgentSessionLogs(sessionId)
      .then((logs) => {
        if (cancelled) return;
        const restored = logsToTurns(logs);
        setTurnState((prev) => {
          if (prev.turns.length > 0) return prev;
          // attach 竞态修复（ql-20260820-007）：detail 先到时修正 effect 已扫过空
          // turns——装回后按 currentRunIdRef 重放同一修正，运行中 run 不再被
          // logsToTurns 的「一律 completed」卡成「已完成」（状态条随之恢复挂载）。
          const cur = currentRunIdRef.current;
          return {
            ...prev,
            turns: cur
              ? restored.map((t) =>
                  t.realRunId === cur && t.status === "completed"
                    ? { ...t, status: "running" }
                    : t,
                )
              : restored,
          };
        });
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
        // user_input 是用户消息（attach 历史/占位 turn 已作 prompt），不进 output
        // （装配器内同语义双保险）。task-09（FR-05）：其余日志归一喂共享装配器，
        // 分类 / override 撤回 / tool 配对 / 子代理归属一律依赖装配器导出。
        if (env.channel === "user_input") return;
        setTurnState((prev) =>
          upsertTurn(
            prev,
            env,
            (turn) => applyEnvelopeToTurn(turn, env),
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
            (turn) => {
              // task-09：finishTurn 清全部 text/thinking 段 streaming 标记
              // （流式光标收起，段级状态随终态收敛）；终态与 token 照旧页面胶水写入。
              const finished = finishTurn(asAssembled(turn));
              return {
                ...turn,
                segments: finished.segments,
                output: finished.output,
                processItems: finished.processItems,
                turnStartedAt: finished.turnStartedAt,
                seenLogIds: finished.seenLogIds,
                status: terminal,
                inputTokens: env.input_tokens ?? turn.inputTokens,
                outputTokens: env.output_tokens ?? turn.outputTokens,
              };
            },
            { clearCurrentRun: env.run_id! },
          ),
        );

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

  // ── attach 竞态修复（ql-20260820-007）：镜像 current_run_id 供历史回灌消费 ──
  useEffect(() => {
    currentRunIdRef.current =
      session && session.status === "active"
        ? (session.current_run_id ?? null)
        : null;
  }, [session]);

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

  // ── 2026-08-20 task-12：附件门控派生（D-6 引擎 / FR-10 D-9 多模态降级）────
  const sessionEngine = session?.provider ?? null;
  const attachmentsDisabled = sessionEngine !== "claude";
  // 会话实际生效供应商（会话绑定优先；本机默认/未选 → null = 能力未知）。
  const effectiveProvider = useMemo(
    () =>
      providers.find(
        (p) => p.id === (session?.llm_provider_id ?? null),
      ) ?? null,
    [providers, session?.llm_provider_id],
  );
  const multimodalDowngraded = useMemo(() => {
    if (!effectiveProvider) return false;
    if (effectiveProvider.multimodal === "false") return true;
    if (effectiveProvider.multimodal === "true") return false;
    // auto：前端同源启发式（backend capability.py 权威；此处仅提示条预览）。
    const model = effectiveProvider.model ?? effectiveProvider.default_fallback_model ?? "";
    const lowered = model.toLowerCase();
    return !/(vision|vl|glm-[34]\.\d+v|gpt-4o|gpt-4\.1|gpt-5|claude|gemini|qwen-vl|doubao-seed)/.test(
      lowered,
    );
  }, [effectiveProvider]);

  // ── task-08（FR-09 / DS-5）：reconnecting 本地计时 ───────────────────────
  // 进入 restoring（pending/reconnecting）以 Date.now() 锚定起点；status 离开
  // reconnecting（active/ended/failed）即清零重置（锚点置 null + 超时态复位）。
  // 驱动方式：restoring 期间单个 setTimeout（到期翻超时态），离开/卸载即清理，
  // 不新增常驻定时器；pending→reconnecting 不重锚（effect 依赖 restoring 布尔）。
  const [reconnectTimedOut, setReconnectTimedOut] = useState(false);
  const reconnectAnchorRef = useRef<number | null>(null);
  useEffect(() => {
    if (!restoring) {
      reconnectAnchorRef.current = null;
      setReconnectTimedOut(false);
      return;
    }
    reconnectAnchorRef.current ??= Date.now();
    const remaining = Math.max(
      0,
      RECONNECT_TIMEOUT_MS - (Date.now() - reconnectAnchorRef.current),
    );
    const timer = window.setTimeout(() => setReconnectTimedOut(true), remaining);
    return () => window.clearTimeout(timer);
  }, [restoring]);
  // 显示条件：status === "reconnecting" 且本地计时 >240s（pending 不显示入口）。
  const reconnectTimedOutBanner = status === "reconnecting" && reconnectTimedOut;

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
    const enriched = turnState.turns.map((t) => {
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
        // task-09（FR-02）计时锚点 ?? 链：turn 已有值（live 发送占位 / 首条 log
        // timestamp 兜底）优先，run 快照 started_at 次之——attach 恢复计时不归零
        // 不重计（SSE 流中无 run_started 事件，不覆盖已有锚点）。
        turnStartedAt: t.turnStartedAt ?? parseRunStartedAt(meta.started_at),
      };
    });
    // ql-20260818-011：runsMeta 中的静默切换 run 无 SSE 事件→不在 turnState.turns
    // 中→displayTurns 迭代忽略→重进才可见。补建孤儿 turn（无 prompt/output，
    // 有 whoLine，已完成后台 run），让它们实时出现。
    const knownRunIds = new Set(turnState.turns.map((t) => t.realRunId ?? t.runId));
    const orphanTurns: SessionTurnView[] = [];
    for (const [runId, meta] of runsMeta) {
      if (knownRunIds.has(runId)) continue;
      if (meta.status !== 'completed') continue;
      orphanTurns.push({
        runId,
        turn: null,
        prompt: '',
        output: '',
        status: 'completed',
        seenLogIds: new Set(),
        inputTokens: meta.input_tokens ?? null,
        outputTokens: meta.output_tokens ?? null,
        errorDetail: null,
        processItems: [],
        realRunId: runId,
        whoLine: {
          profileName: meta.agent_profile_snapshot?.name ?? null,
          agentName: agentDisplayName,
          providerName: meta.llm_provider_id
            ? (providers.find((p) => p.id === meta.llm_provider_id)?.name ?? null)
            : null,
        },
        sender: meta.user_id && meta.sender_name
          ? {
              name: meta.sender_name,
              me: meta.user_id === session?.user_id,
              at: meta.started_at ?? null,
            }
          : undefined,
        replyAt: meta.finished_at ?? meta.started_at ?? null,
      });
    }
    // ql-20260818-011-b：按时间戳排序（孤儿 turn 不追加在末尾，与实时 turn 按时间
    // 线正确穿插——重进后 logsToTurns 已是时间序，不排序会导致切换标记堆在底部）。
    // ql-20260818-011-d：运行中轮次无 replyAt（空→0）会跑到最前面——视为「最新」
    // 用 Infinity 排末尾；有 replyAt/sender.at 的按实际时间穿插。
    const ts = (t: SessionTurnView) => {
      const raw = t.replyAt ?? t.sender?.at ?? "";
      const parsed = raw ? Date.parse(raw) : NaN;
      if (Number.isFinite(parsed)) return parsed;
      // 无时间戳：completed 孤儿 turn 排前面（0），运行中/待答排最后（Infinity）。
      return t.status === "completed" ? 0 : Infinity;
    };
    return [...enriched, ...orphanTurns].sort((a, b) => ts(a) - ts(b));
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
    // 2026-08-20 task-12（D-7）：附件非空允许空文本（看图说话）；纯文本仍守卫。
    if ((!prompt && pendingAttachments.length === 0) || prompt.length > MAX_PROMPT_LEN) return;
    if (!session || ended || restoring || !machineOnline) return;
    if (turnState.currentRunId) return; // turn 级串行
    const attachmentIds = pendingAttachments.map((a) => a.id);
    // ql-20260821-002：占位轮合成标记行——自己气泡即时渲染附件 chips（复用
    // 历史回显解析链路；后端落库标记行与此逐字同构，真实日志到达后无感接管）。
    const markerLines = pendingAttachments
      .map((a) => `[附件:${a.id}|${a.kind}|${a.name}]`)
      .join("\n");
    const displayPrompt = prompt
      ? `${markerLines}\n${prompt}`
      : markerLines;
    setInput("");
    const placeholderId = `__pending_inject_${Date.now()}__`;
    setTurnState((prev) => ({
      currentRunId: placeholderId,
      turns: [
        ...prev.turns,
        {
          runId: placeholderId,
          turn: null,
          prompt: displayPrompt,
          output: "",
          status: "pending",
          seenLogIds: new Set(),
          inputTokens: null,
          outputTokens: null,
          errorDetail: null,
          processItems: [],
          // task-09（FR-02）：live 计时锚点 = 本地发送占位时刻（v2 段渲染 + 空段
          // 数组 = 状态条/思考占位立即生效，SSE run_id 到达后原位接管不重计）。
          segments: [],
          turnStartedAt: Date.now(),
        },
      ],
    }));
    try {
      const resp = await injectSession(sessionId, prompt, {
        // 2026-08-20 task-12：附件引用（空数组不进 body，保持既有 payload 形态）。
        ...(attachmentIds.length > 0 ? { attachment_ids: attachmentIds } : {}),
      });
      setPendingAttachments([]);
      clearAttachmentsRef.current?.();
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
  }, [input, session, ended, restoring, machineOnline, turnState.currentRunId, sessionId, pendingAttachments]);

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

  const handleReopen = useCallback(async () => {
    setReopening(true);
    try {
      await reopenSession(sessionId);
      await qc.invalidateQueries({ queryKey: ["agentSessionDetail", sessionId] });
      onSessionListRefresh?.();
    } catch (err) {
      // task-08（FR-09）：reopen 409 先查本页中文映射表，命中不透传后端英文
      // 原文（notify.error 传 Error 才会被 errMessage 取出 message）。
      const apiErr = err as ApiError;
      const zh =
        apiErr instanceof ApiError ? REOPEN_ERROR_ZH[apiErr.code] : undefined;
      if (zh) {
        notify.error(new Error(zh));
      } else {
        notify.error(err, "重新开启失败");
      }
    } finally {
      setReopening(false);
    }
  }, [sessionId, qc, onSessionListRefresh, notify]);

  const handleResend = useCallback(
    async (prompt: string) => {
      if (!session || session.status !== "active") return;
      if (!machineOnline || turnState.currentRunId) return;
      // ql-20260821-002：占位轮/历史轮 prompt 含附件标记行——重发前剥离
      // （附件不随重发复活，仅回填原文）。
      const trimmed = parseAttachmentMarkers(prompt).text.trim();
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
            // task-09（FR-02）：同 handleSend——live 锚点 = 本地重发占位时刻。
            segments: [],
            turnStartedAt: Date.now(),
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

  // ── task-09（FR-04）：子代理目录跳转定位（原型 jumpTo 的页面侧实现）────────
  // 三动作：切「进度」视图（子代理块只在 all 视图渲染）→ 展开对应子代理块 →
  // scrollIntoView 居中。SubagentBlockView（task-05）未暴露 data-segment-id DOM
  // 锚点且不在本卡允许路径——采用最小侵入方案：双 rAF 等「进度」视图段线提交后，
  // 在面板根内按子代理块容器类名（rounded-[10px] + indigo 系）圈定候选，头部
  // 名称归一匹配（规则镜像 SubagentBlockView 名称派生；目录侧 120 字截断按前缀
  // 容忍）。命中：折叠块模拟点击头部展开 + 滚动居中；未命中只完成视图切换不报错。
  const handleJumpToSubagent = useCallback(
    (segmentId: string) => {
      setViewMode("all");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const root = panelRef.current;
          if (!root) return;
          let expected: string | null = null;
          for (const t of displayTurns) {
            const seg = findSegmentById(t.segments, segmentId);
            if (seg) {
              expected = subagentBlockNameOf(seg);
              break;
            }
          }
          if (!expected) return;
          const norm = (s: string) => s.replace(/\s+/g, " ").trim();
          const want = norm(expected);
          const blocks = Array.from(root.querySelectorAll<HTMLElement>("div")).filter(
            (el) =>
              el.classList.contains("rounded-[10px]") &&
              el.classList.contains("border-indigo-200") &&
              el.classList.contains("bg-indigo-50"),
          );
          for (const block of blocks) {
            const nameEl = block.querySelector<HTMLElement>(".truncate.font-semibold");
            if (!nameEl) continue;
            const got = norm(nameEl.textContent ?? "");
            const nameHit =
              got === want || (want.length >= 120 && got.startsWith(want));
            if (!nameHit) continue;
            // 展开折叠块：子代理块首子元素即头部（运行中默认展开，无 aria-expanded=false）。
            const header = block.firstElementChild;
            if (
              header instanceof HTMLElement &&
              header.getAttribute("aria-expanded") === "false"
            ) {
              header.click();
            }
            if (typeof block.scrollIntoView === "function") {
              block.scrollIntoView({ behavior: "smooth", block: "center" });
            }
            return;
          }
        });
      });
    },
    [displayTurns],
  );

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
      ref={panelRef}
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
          {/* 会话 id 短码：点击复制完整 id（排障/引用入口），notify 反馈。 */}
          <button
            type="button"
            aria-label="复制会话 ID"
            title={`点击复制会话 ID：${session.id}`}
            onClick={() => {
              void navigator.clipboard
                ?.writeText(session.id)
                .then(() => notify.success("已复制会话 ID"))
                .catch(() => notify.error(new Error("复制失败")));
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
          {workspaceName && (
            <span className="hidden shrink-0 rounded-sm bg-cyan-50 px-1.5 py-0.5 text-[11px] text-cyan-700 sm:inline">
              📂 {workspaceName}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* task-09（FR-04 / Grill X-09）：子代理目录——仅本页头部挂载（runtimes
              弹窗不挂）；无子代理段时组件返回 null 不占位。 */}
          <SubagentCatalog turns={displayTurns} onJumpTo={handleJumpToSubagent} />
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
                  {/* task-09：「全部」改「进度」（段模型语义：完整段时间线）。 */}
                  {m === "conversation" ? "对话" : "进度"}
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
      {/* 已结束/失败横幅 + 重新开启（原型 .ended-banner）；task-08：reconnecting
          本地计时 >240s（DS-5）复用同位置同款入口，超时场景文案区分，onClick 与
          ended 同一 handleReopen（不复制回调）。 */}
      {(ended || reconnectTimedOutBanner) && (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-5 py-2 text-xs text-muted-foreground">
          <span>
            {ended
              ? `会话已${session.status === "failed" ? "失败" : "结束"} —— 可浏览历史消息`
              : "会话恢复超时 —— 可重新开启，或等待自动恢复"}
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
          // 2026-08-20 task-12：附件门控（D-6 codex 禁用；FR-10 降级提示）与回传。
          attachmentsDisabled={attachmentsDisabled}
          multimodalDowngraded={multimodalDowngraded}
          onAttachmentsChange={setPendingAttachments}
          registerClearAttachments={(fn) => {
            clearAttachmentsRef.current = fn;
          }}
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

/* ────────────────────── SSE turn 状态机辅助（task-09：只留页面胶水，日志内容处理走装配器） ────────────────────── */

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
    // task-09：新建 turn 用装配器空产物初始化（segments/output/processItems/
    // seenLogIds 同源一致）；turnStartedAt 起始 null，由首条 log timestamp 兜底
    // 写入、displayTurns 再按 run 快照 started_at 补（attach 恢复锚点）。
    const empty = createEmptyAssembledTurn();
    const newTurn: SessionTurnView = {
      runId,
      turn: env.turn ?? null,
      prompt: "",
      output: empty.output,
      status: "running",
      seenLogIds: empty.seenLogIds,
      inputTokens: env.input_tokens ?? null,
      outputTokens: env.output_tokens ?? null,
      errorDetail: null,
      processItems: empty.processItems,
      segments: empty.segments,
      turnStartedAt: empty.turnStartedAt,
    };
    turns = [...prev.turns, apply(newTurn)];
  } else {
    // attach 竞态修复（ql-20260820-007）防御分支：主修正位于历史回灌处；若某条
    // 路径仍漏改（当前 run 的日志持续流入而轮卡终态），log 分支自愈翻回 running。
    // 真正完成的 run 其 currentRunId 已被 onTurnCompleted 清空，不会误翻。
    const healToRunning = env.event === "log" && prev.currentRunId === runId;
    turns = prev.turns.map((t, i) => {
      if (i !== idx) return t;
      if (env.event !== "log" && TERMINAL_TURN_STATUSES.has(t.status)) return t;
      const next = apply(t);
      if (healToRunning && TERMINAL_TURN_STATUSES.has(next.status)) {
        return { ...next, status: "running" };
      }
      return next;
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
 * task-09（FR-05）：SessionTurnView → AssembledTurn 收窄视图（页面胶水）。
 * SessionTurnView 的段模型字段可选（task-06 过渡期双路径），装配器要求全量形状
 * ——缺失按空值兜底；装配产物字段与 SessionTurnView 同名，调用方经
 * `{ ...turn, ...next }` 回填（其余 turn 级字段不动）。
 */
function asAssembled(turn: SessionTurnView): AssembledTurn {
  return {
    segments: turn.segments ?? [],
    output: turn.output,
    processItems: turn.processItems ?? [],
    turnStartedAt: turn.turnStartedAt ?? null,
    seenLogIds: turn.seenLogIds,
  };
}

/**
 * task-09（FR-05）：单条 SSE log envelope 归一为 AssemblerLogInput 喂共享装配器
 * applyLogToSegments（替代原 applyLogToTurn 副本——分类 / override 撤回 / tool
 * 配对 / 子代理归属一律依赖装配器导出，本文件不重写；partial 段起点 Map 随副本
 * 一并删除，装配器按段 id 前缀路由撤回）。产出段序列 + 兼容投影（output /
 * processItems）+ 计时锚点兜底（首条 log timestamp）+ log_id 去重集合。
 */
function applyEnvelopeToTurn(
  turn: SessionTurnView,
  env: SessionStreamEnvelope,
): SessionTurnView {
  const input: AssemblerLogInput = {
    logId: env.log_id,
    channel: env.channel,
    content: env.content,
    timestamp: env.timestamp,
    segmentId: env.segment_id ?? null,
    stale: env.stale ?? null,
    parentToolUseId: env.parent_tool_use_id ?? null,
    subagentType: env.subagent_type ?? null,
    depth: env.depth ?? null,
    toolKind: env.tool_kind ?? null,
  };
  return { ...turn, ...applyLogToSegments(asAssembled(turn), input) };
}

/** run 快照 started_at（ISO）→ ms；缺失 / 非法 → null（displayTurns 计时锚点 ?? 链次优源）。 */
function parseRunStartedAt(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** DFS 全 turn 段树找 id 匹配段（子代理目录跳转的名称定位用，嵌套 children 递归）。 */
function findSegmentById(
  segments: TurnSegment[] | undefined,
  id: string,
): TurnSegment | null {
  if (!segments) return null;
  for (const s of segments) {
    if (s.id === id) return s;
    if (s.kind === "tool" || s.kind === "subagent_stub") {
      const inner = findSegmentById(s.children, id);
      if (inner) return inner;
    }
  }
  return null;
}

/**
 * 子代理块头部展示名（DOM 名称匹配用）——规则镜像 turn-segment-views
 * SubagentBlockView：tool 段 primary ?? subagentType ?? 「子代理」；stub 段
 * subagentType ?? 「子代理」（stub 无 primary）。
 */
function subagentBlockNameOf(seg: TurnSegment): string | null {
  if (seg.kind === "tool") {
    return seg.primary?.trim() || seg.subagentType || "子代理";
  }
  if (seg.kind === "subagent_stub") {
    return seg.subagentType || "子代理";
  }
  return null;
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

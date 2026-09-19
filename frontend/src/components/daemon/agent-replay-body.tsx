"use client";

/**
 * AgentReplayBody —— origin=tool_report 且 turn_count===0 会话的回放主体
 * （2026-09-19-tool-report-session-replay task-11 / FR-01 / FR-02 / FR-04 /
 * D-001@v1 / D-002@v1 / D-007@v1；design Phase 3.2-3.5，原型
 * prototype-tool-report-session-replay.html）。task-12 接线后取代已退役的
 * AgentLogSessionBody 作 isToolReportBody 主体——
 * 把纯日志会话从「元数据卡列表」升级为 TurnTimeline 会话时间线：
 *
 *   - 数据链：listAgentLogs(sessionId)（30s 轮询沿用 useSessionAgentLogs
 *     口径）→ 按 log_path / session_id 含 `subagent_agent_` 分主/子（R-04：
 *     主日志按 first_seen_at 新→旧，同秒 id 字典序稳定 tiebreak）→ 最新主
 *     日志为正文、更早主日志 + 子代理归入「工作会话（N）」折叠条；
 *   - 正文：readAgentLogMessages(主 entry.id) 最近窗口 → buildReplayTurns
 *     （task-09 适配器）→ TurnTimeline（11 项必填 props 回放取值见挂载处
 *     逐项注释，design Phase 3.2 清单）；触顶「加载更早」按钮带
 *     beforeSeq=当前最小 seq 前插（对齐 agent-log-card handleLoadEarlier 先例），
 *     truncated=false 到头后不再发起；
 *   - 工作会话折叠条：形态对齐 AgentLogCard 折叠栏（收起一行摘要 / 点击
 *     展开列表），条目点击置本地 focus 直读该 entry 回放，面包屑
 *     「← 返回主会话」回主日志；focusEntryId prop 供父层直读入口复用；
 *   - 不可用三态（FR-04 / D-007）：daemon 离线（404 no-bound-daemon / 504）/
 *     格式不支持（status=unsupported / 409 二进制黑名单，task-13 文案口径）/
 *     文件缺失（404 entry / file not found）→ 顶部中文提示行 + 元数据
 *     （harness / 短码 / 大小 / 调用数 / 时间）保留可见，均不弹错框；
 *     parse_error / too_large / 422 老 daemon / 其余错误沿用
 *     agent-log-card 原文回落语义（黄条原因逐字 + 原文尾部 <pre>）；
 *   - 累计用量：total_usage 由 daemon 返回（前端不求和，D-004@v1），显示在
 *     顶部说明行旁（输入区属 session-panel，此处就近挂载）；缺省不渲染
 *     （不显 0 不伪造）。
 *
 * 容器：非时间线分支（加载 / 空 / 不可用）容器类与对话流同构（沿袭原 AgentLogSessionBody 形态）
 * （min-h-0 flex-1 overflow-y-auto bg-background px-5 py-5）同构；时间线分支
 * 由 TurnTimeline 自带滚动容器承担（flex 列布局，顶部说明行 / 折叠条固定）。
 *
 * 视觉（双主题铁律）：品牌色 brand-* 语义阶；zcode / harness 外部标识与角色
 * 猜测走 cyan 固定阶（对齐 agent-log-card NFR-03 与原型 .role）；警示黄条走
 * amber 状态阶（agent-log-card 回落黄条先例）。不硬编码 hex。
 */

import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot } from "lucide-react";

import {
  listAgentLogs,
  readAgentLogContent,
  readAgentLogMessages,
  type AgentLogListItem,
  type AgentLogMessagesResponse,
} from "@/lib/agent-logs";
import { buildReplayTurns, type AgentLogMessageItem } from "@/lib/agent-log-turns";
import { ApiError } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { TurnTimeline, type SessionViewMode } from "@/components/daemon/turn-timeline";
import { cn } from "@/lib/utils";

/* ───────────────── 回放 no-op 回调（TurnTimeline 必填，回放只读零交互） ───────────────── */

const noopDialogResolved = (_requestId: string) => {};
const noopResend = (_prompt: string) => {};
const noopSwitchProvider = () => {};

/* ───────────────── 纯格式化辅助（agent-log-card 私有同款，跨文件不可 import） ───────────────── */

/**
 * session_id 短码：uuid 取前 8 + … + 后 4；非 uuid 截前 16 + …。
 */
function shortSessionId(id: string): string {
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (isUuid) return `${id.slice(0, 8)}…${id.slice(-4)}`;
  return id.length > 16 ? `${id.slice(0, 16)}…` : id;
}

/** 大小人性化：B → KB → MB（一位小数；null/非数字返回 null 交上层省略）。 */
function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 时间 → 「MM/DD HH:mm」短时间。toLocaleString 显式传 "zh-CN"（CONVENTIONS
 * 类型与数据契约 8：不传则依赖运行环境 locale，CI 上漂移）；null / 非法时间
 * 返回 null 不渲染。
 */
function formatSeenTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return t.toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ───────────────── 主/子分类（D-002@v1 / R-04） ───────────────── */

/** 子代理日志判定：log_path 或 session_id 含 `subagent_agent_`（实证前缀）。 */
function isSubagentEntry(entry: AgentLogListItem): boolean {
  return (
    entry.log_path.includes("subagent_agent_") ||
    (entry.session_id ?? "").includes("subagent_agent_")
  );
}

/** first_seen_at 时间戳（缺失 / 非法 → 0 视为最旧，对齐 SQL NULLS LAST 语义）。 */
function firstSeenTs(entry: AgentLogListItem): number {
  if (!entry.first_seen_at) return 0;
  const t = Date.parse(entry.first_seen_at);
  return Number.isFinite(t) ? t : 0;
}

/** 主/子通用排序键：first_seen_at 新→旧；同值 id 字典序稳定（R-04 tiebreaker）。 */
function byFirstSeenDesc(a: AgentLogListItem, b: AgentLogListItem): number {
  const diff = firstSeenTs(b) - firstSeenTs(a);
  return diff !== 0 ? diff : a.id.localeCompare(b.id);
}

/** 工作会话角色猜测词表（log_path / last_command 命中即标注，否则 harness 名）。 */
const WORKER_ROLE_TOKENS = ["plan", "execute", "verify", "review", "explore"] as const;

function workerRoleLabel(entry: AgentLogListItem): string {
  const hay = `${entry.log_path} ${entry.last_command ?? ""}`.toLowerCase();
  for (const token of WORKER_ROLE_TOKENS) {
    if (hay.includes(token)) return token;
  }
  return entry.harness;
}

/** 工作会话条目短码：子代理取 log_path 文件名（去扩展名）；其余回落 session 短码。 */
function workerShortCode(entry: AgentLogListItem): string {
  const base = entry.log_path.split(/[\\/]/).pop() ?? "";
  const stem = base.replace(/\.[^.]+$/, "");
  if (isSubagentEntry(entry) && stem) return stem;
  if (entry.session_id) return shortSessionId(entry.session_id);
  return stem || entry.id.slice(0, 8);
}

/* ───────────────── 不可用三态 + 原文回落分类（FR-04 / D-007@v1） ───────────────── */

/** 主体不可读原因（三态 + 沿用原文回落的降级态联合）。 */
type ReplayBlockReason =
  | { kind: "offline" }
  | { kind: "missing" }
  | { kind: "binary" }
  | { kind: "unsupported" }
  | { kind: "parse_error" }
  | { kind: "too_large" }
  | { kind: "old_daemon" }
  | { kind: "error"; message: string };

/** 需要原文尾部回落的降级态（三态之外，语义逐字沿用 agent-log-card 回落口径）。 */
const RAW_FALLBACK_KINDS: ReadonlySet<ReplayBlockReason["kind"]> = new Set([
  "unsupported",
  "parse_error",
  "too_large",
  "old_daemon",
  "error",
]);

/**
 * messages 查询结果 → 不可用原因分类：
 *   - 404 code=HTTP_404_AGENT_LOG_NO_BOUND_DAEMON（会话未激活且工作区未绑机）
 *     或 504（RPC 超时 / 离线）→ offline；
 *   - 其余 404（HTTP_404_AGENT_LOG_ENTRY_NOT_FOUND 条目已删 /
 *     HTTP_404_AGENT_LOG_FILE_NOT_FOUND 文件已清理）→ missing；
 *   - 409 code=HTTP_409_AGENT_LOG_BINARY_FORMAT（cursor IDE sqlite 黑名单）→ binary；
 *   - 422（老 daemon 无 read_agent_log_messages 方法）→ old_daemon；
 *   - 200 但 status≠parsed → unsupported / parse_error / too_large。
 */
function classifyBlockReason(
  err: unknown,
  data: AgentLogMessagesResponse | undefined,
): ReplayBlockReason | null {
  if (err != null) {
    if (err instanceof ApiError) {
      if (err.status === 404 && err.code === "HTTP_404_AGENT_LOG_NO_BOUND_DAEMON") {
        return { kind: "offline" };
      }
      if (err.status === 504) return { kind: "offline" };
      if (err.status === 404) return { kind: "missing" };
      if (err.status === 409 && err.code === "HTTP_409_AGENT_LOG_BINARY_FORMAT") {
        return { kind: "binary" };
      }
      if (err.status === 422) return { kind: "old_daemon" };
      return { kind: "error", message: err.message };
    }
    return { kind: "error", message: err instanceof Error ? err.message : "未知错误" };
  }
  if (data != null && data.status !== "parsed") {
    if (data.status === "parse_error") return { kind: "parse_error" };
    if (data.status === "too_large") return { kind: "too_large" };
    return { kind: "unsupported" };
  }
  return null;
}

const RAW_FALLBACK_TAIL = "已回落原文尾部查看（最多 256KB）";

/** 不可用 / 回落提示行文案（三态新口径 + 降级态沿用 agent-log-card 逐字口径）。 */
function blockNoteText(reason: ReplayBlockReason): string {
  switch (reason.kind) {
    case "offline":
      return "机器离线，无法读取日志内容——回放内容存于上报机器本地，守护进程在线后可查看。";
    case "missing":
      return "日志文件已不存在（可能已被本机清理）";
    case "binary":
      // task-13 文案口径逐字（cursor IDE 二进制死胡同说明，不拼原文回落尾巴）。
      return "该日志格式（cursor IDE 聊天库）暂不支持对话化回放，仅保留元数据与活性信息";
    case "unsupported":
      return `该格式暂不支持对话化解析，${RAW_FALLBACK_TAIL}`;
    case "parse_error":
      return `日志解析失败（格式异常或坏行过多），${RAW_FALLBACK_TAIL}`;
    case "too_large":
      return `日志文件超出对话化解析预算，${RAW_FALLBACK_TAIL}`;
    case "old_daemon":
      return `daemon 未升级，暂不支持对话化解析，${RAW_FALLBACK_TAIL}`;
    case "error":
      return `对话化解析请求失败（${reason.message}），${RAW_FALLBACK_TAIL}`;
  }
}

/**
 * 累计用量文案：「累计 in X · out Y · 缓存命中 Z」（toLocaleString zh-CN
 * 千分位，对齐平台 token 显示惯例）；任一字段非空才产出，全缺省返回 null
 * 不渲染（老 daemon / 无数据源不显 0 不伪造）。
 */
function formatTotalUsage(
  total: NonNullable<AgentLogMessagesResponse["total_usage"]>,
): string | null {
  const parts: string[] = [];
  if (total.input_tokens != null) {
    parts.push(`in ${total.input_tokens.toLocaleString("zh-CN")}`);
  }
  if (total.output_tokens != null) {
    parts.push(`out ${total.output_tokens.toLocaleString("zh-CN")}`);
  }
  if (total.cache_read_tokens != null) {
    parts.push(`缓存命中 ${total.cache_read_tokens.toLocaleString("zh-CN")}`);
  }
  return parts.length > 0 ? `累计 ${parts.join(" · ")}` : null;
}

/** 不可用态保留可见的元数据行（harness · 短码 · 大小 · 调用数 · 时间）。 */
function entryMetaLine(entry: AgentLogListItem): string {
  const bits: string[] = [entry.harness];
  if (entry.session_id) bits.push(shortSessionId(entry.session_id));
  const size = formatBytes(entry.size_bytes);
  if (size) bits.push(size);
  if (entry.invocations != null) bits.push(`调用 ${entry.invocations} 次`);
  const seen = formatSeenTime(entry.last_seen_at ?? entry.first_seen_at);
  if (seen) bits.push(seen);
  return bits.join(" · ");
}

/* ───────────────── 工作会话折叠条（形态对齐 AgentLogCard 折叠栏） ───────────────── */

/**
 * 「工作会话（N）」折叠条：收起一行摘要（Bot 图标 + 标题 + 说明 + ▸），
 * 点击展开列表（条目 = 角色猜测 + 短码 + 大小 / 时间，点击进入该日志回放）。
 * 条目为更早主日志 + 子代理日志（子代理完整 I/O 不并入正文，design Phase 3.3）。
 */
function WorkerSessionsStrip({
  entries,
  onPick,
}: {
  entries: AgentLogListItem[];
  onPick: (_entryId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      data-testid="agent-replay-worker-strip"
      className="shrink-0 border-b border-border bg-card"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? "收起工作会话列表" : "展开工作会话列表"}
        onClick={() => setOpen((v) => !v)}
        data-testid="agent-replay-worker-toggle"
        className="flex w-full cursor-pointer items-center gap-2 px-5 py-1.5 text-left transition-colors hover:bg-muted"
      >
        <Bot aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">
          工作会话（{entries.length}）
        </span>
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">
          子代理与更早主日志不并入正文，点击展开
        </span>
        <span
          aria-hidden
          className={cn(
            "ml-auto shrink-0 text-[10px] text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        >
          ▸
        </span>
      </button>
      {open && (
        <ul
          data-testid="agent-replay-worker-list"
          className="flex max-h-[45vh] flex-col gap-1.5 overflow-y-auto border-t border-border px-5 py-2"
        >
          {entries.map((entry) => {
            const size = formatBytes(entry.size_bytes);
            const seen = formatSeenTime(entry.last_seen_at ?? entry.first_seen_at);
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  data-testid="agent-replay-worker-item"
                  data-entry-id={entry.id}
                  title={`查看该日志回放：${entry.log_path}`}
                  onClick={() => onPick(entry.id)}
                  className="flex w-full cursor-pointer flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-left text-[11px] transition-colors hover:bg-brand-50"
                >
                  <span className="shrink-0 font-semibold text-cyan-700">
                    {workerRoleLabel(entry)}
                  </span>
                  <span className="min-w-0 truncate font-mono text-muted-foreground">
                    {workerShortCode(entry)}
                  </span>
                  <span className="ml-auto shrink-0 whitespace-nowrap text-muted-foreground">
                    {[seen, size].filter(Boolean).join(" · ") || "—"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ───────────────── 回放主体组件 ───────────────── */

/**
 * AgentReplayBody —— tool_report 纯日志会话主体（design 接口定义节）：
 *
 * @param sessionId 会话 id（拉日志列表，30s 轮询）
 * @param focusEntryId 工作会话入口进入时直读该 entry（可选；本地可再切换/返回）
 */
export function AgentReplayBody({
  sessionId,
  focusEntryId,
}: {
  sessionId: string;
  focusEntryId?: string;
}): JSX.Element {
  const qc = useQueryClient();

  // 会话关联日志列表（30s 轮询沿用 useSessionAgentLogs 口径，沿袭原 AgentLogSessionBody 节奏）。
  const logsQ = useQuery({
    queryKey: queryKeys.agentLogs.list(sessionId),
    queryFn: () => listAgentLogs(sessionId),
    refetchInterval: 30_000,
    enabled: Boolean(sessionId),
  });

  // 「对话/全部」视图本地 state（与普通会话同款 tablist 控件，形态对齐
  // session-panel-page.tsx:3687 消息显示范围切换）。
  const [viewMode, setViewMode] = useState<SessionViewMode>("conversation");

  // 工作会话焦点（本地态；focusEntryId prop 变化时同步——父层直读入口复用）。
  const [focusId, setFocusId] = useState<string | null>(focusEntryId ?? null);
  useEffect(() => {
    setFocusId(focusEntryId ?? null);
  }, [focusEntryId]);

  const items = useMemo(() => logsQ.data?.items ?? [], [logsQ.data]);

  // 主/子分类 + 主日志挑选（R-04：最新 first_seen_at 为主，更早主日志归折叠条）。
  const sortedMain = useMemo(
    () =>
      items
        .filter((e) => !isSubagentEntry(e))
        .slice()
        .sort(byFirstSeenDesc),
    [items],
  );
  const workerEntries = useMemo(
    () =>
      [...items.filter(isSubagentEntry), ...sortedMain.slice(1)].sort(
        byFirstSeenDesc,
      ),
    [items, sortedMain],
  );

  const focusedEntry =
    focusId != null ? items.find((e) => e.id === focusId) ?? null : null;
  // 无主日志极端兜底（全部条目均为子代理）：最新子代理承正文，避免永久加载态。
  const activeEntry = focusedEntry ?? sortedMain[0] ?? workerEntries[0] ?? null;
  const activeEntryId = activeEntry?.id ?? null;

  // 主体消息最近窗口（queryKey 随条目切换；前缀挂 agentLogs 使「刷新」invalidate
  // 一并覆盖）。仅 status=parsed 进回放（messages 也仅 parsed 非空）。
  const messagesQ = useQuery({
    queryKey: [...queryKeys.agentLogs.all, "replay-messages", activeEntryId],
    queryFn: () => readAgentLogMessages(activeEntryId as string),
    enabled: activeEntryId != null,
  });

  // 触顶「加载更早」分页态：olderPages 累积前插的更早段（基窗口来自 useQuery，
  // 翻页走命令式调用，对齐 agent-log-card handleLoadEarlier 先例）。
  const [olderPages, setOlderPages] = useState<AgentLogMessageItem[]>([]);
  // 翻页后的截断标记（null=未翻页，用基窗口 truncated）。
  const [earlierTruncated, setEarlierTruncated] = useState<boolean | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [loadEarlierNote, setLoadEarlierNote] = useState<string | null>(null);

  // 条目切换清分页态（焦点切换 / 主日志轮换后 seq 域不同）。
  useEffect(() => {
    setOlderPages([]);
    setEarlierTruncated(null);
    setLoadingEarlier(false);
    setLoadEarlierNote(null);
  }, [activeEntryId]);

  const loadedMessages = useMemo(() => {
    const base = messagesQ.data?.messages ?? [];
    if (olderPages.length === 0) return base;
    const existingSeqs = new Set(base.map((m) => m.seq));
    const older = olderPages.filter((m) => !existingSeqs.has(m.seq));
    return [...older, ...base].sort((a, b) => a.seq - b.seq);
  }, [messagesQ.data, olderPages]);

  const truncated = earlierTruncated ?? messagesQ.data?.truncated ?? false;
  const totalSegments = messagesQ.data?.total_segments ?? 0;

  const turns = useMemo(
    () =>
      messagesQ.data?.status === "parsed" ? buildReplayTurns(loadedMessages) : [],
    [messagesQ.data, loadedMessages],
  );

  const handleLoadEarlier = useCallback(() => {
    if (loadingEarlier || activeEntryId == null || loadedMessages.length === 0) return;
    const beforeSeq = Math.min(...loadedMessages.map((m) => m.seq));
    setLoadingEarlier(true);
    setLoadEarlierNote(null);
    readAgentLogMessages(activeEntryId, beforeSeq)
      .then((resp) => {
        setLoadingEarlier(false);
        if (resp.status !== "parsed") {
          // 热文件轮换 / 重解析失败：保持现有内容，静默提示可重试。
          setLoadEarlierNote("更早内容暂时无法解析，请稍后重试");
          return;
        }
        setOlderPages((prev) => {
          const existingSeqs = new Set(prev.map((m) => m.seq));
          const fresh = (resp.messages ?? []).filter(
            (m) => !existingSeqs.has(m.seq),
          );
          return [...prev, ...fresh].sort((a, b) => a.seq - b.seq);
        });
        setEarlierTruncated(resp.truncated);
      })
      .catch(() => {
        setLoadingEarlier(false);
        setLoadEarlierNote("加载更早失败，请重试");
      });
  }, [loadingEarlier, activeEntryId, loadedMessages]);

  // 不可用分类 + 原文回落（三态不拉原文——原文端点同因失败；降级态沿用
  // agent-log-card 回落语义：黄条原因 + content 尾部文本）。
  const blockReason = classifyBlockReason(messagesQ.error, messagesQ.data);
  const needsRawFallback =
    blockReason != null && RAW_FALLBACK_KINDS.has(blockReason.kind);
  const rawQ = useQuery({
    queryKey: [...queryKeys.agentLogs.all, "replay-content", activeEntryId],
    queryFn: () => readAgentLogContent(activeEntryId as string),
    enabled: needsRawFallback && activeEntryId != null,
  });

  // 累计用量（daemon 返回前端不求和；缺省不渲染）。
  const usageText = useMemo(() => {
    const total = messagesQ.data?.total_usage ?? null;
    return total != null ? formatTotalUsage(total) : null;
  }, [messagesQ.data]);

  /* 主体分支（hooks 已全部调用完毕，分支只挑 JSX）。 */
  const body = (() => {
    // 列表加载 / 空 / 失败（文案与容器类沿袭原 AgentLogSessionBody 形态）。
    if (!sessionId || logsQ.isPending) {
      return (
        <div className="min-h-0 flex-1 overflow-y-auto bg-background px-5 py-5">
          <p className="py-6 text-center text-xs text-muted-foreground">
            日志条目加载中…
          </p>
        </div>
      );
    }
    if (logsQ.isError) {
      return (
        <div className="min-h-0 flex-1 overflow-y-auto bg-background px-5 py-5">
          <div
            role="alert"
            className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive"
          >
            加载本地 Agent 日志失败：
            {logsQ.error instanceof Error ? logsQ.error.message : "未知错误"}
            <button
              type="button"
              onClick={() => void logsQ.refetch()}
              className="ml-2 cursor-pointer rounded border border-destructive/40 px-1.5 py-0.5 transition-colors hover:bg-destructive/10"
            >
              重新加载
            </button>
          </div>
        </div>
      );
    }
    if (items.length === 0) {
      return (
        <div className="min-h-0 flex-1 overflow-y-auto bg-background px-5 py-5">
          <p className="py-6 text-center text-xs text-muted-foreground">
            暂无日志上报，等待 SillySpec CLI 下次上报…
          </p>
        </div>
      );
    }

    // 主体消息加载中。
    if (messagesQ.isPending) {
      return (
        <div className="min-h-0 flex-1 overflow-y-auto bg-background px-5 py-5">
          <p className="py-6 text-center text-xs text-muted-foreground">
            日志内容加载中…
          </p>
        </div>
      );
    }

    // 不可用三态 + 原文回落态（FR-04：提示行 + 元数据保留，不弹错框）。
    if (blockReason != null) {
      const offline = blockReason.kind === "offline";
      return (
        <div
          data-testid="agent-replay-unavailable"
          data-kind={blockReason.kind}
          className="min-h-0 flex-1 overflow-y-auto bg-background px-5 py-5"
        >
          <div className="mx-auto max-w-[620px] space-y-2 py-4">
            {offline ? (
              /* 离线：居中中性态（原型 .offline：📴 + 两行说明 + 元数据 chip）。 */
              <div className="flex flex-col items-center gap-1.5 py-4 text-center text-xs text-muted-foreground">
                <span aria-hidden className="text-2xl">
                  📴
                </span>
                <p>{blockNoteText(blockReason)}</p>
              </div>
            ) : (
              /* 其余：警示黄条（agent-log-card 回落黄条 + 原型 .warn 形态）。 */
              <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] leading-5 text-amber-800">
                <span aria-hidden className="shrink-0">
                  ⚠
                </span>
                <span>{blockNoteText(blockReason)}</span>
              </p>
            )}
            {activeEntry && (
              <p
                data-testid="agent-replay-meta"
                className="mx-auto w-fit rounded-md border border-dashed border-border bg-card px-2.5 py-1 font-mono text-[10.5px] text-muted-foreground"
              >
                {entryMetaLine(activeEntry)}
              </p>
            )}
            {needsRawFallback && (
              <div data-testid="agent-replay-raw-fallback">
                {rawQ.isPending && (
                  <p className="px-2.5 py-2 text-[11px] text-muted-foreground">
                    原文加载中…
                  </p>
                )}
                {rawQ.isError && (
                  <p className="px-2.5 py-2 text-[11px] text-muted-foreground">
                    原文读取失败：
                    {rawQ.error instanceof Error ? rawQ.error.message : "未知错误"}
                  </p>
                )}
                {rawQ.data && (
                  <>
                    {rawQ.data.truncated && (
                      <p className="border-b border-border px-2.5 py-1 text-[10.5px] text-muted-foreground">
                        已截断至末尾 256KB
                      </p>
                    )}
                    <pre
                      data-testid="agent-replay-raw-pre"
                      className="max-h-72 overflow-auto whitespace-pre-wrap break-all px-2.5 py-2 font-mono text-[10.5px] leading-4 text-foreground"
                    >
                      {rawQ.data.content}
                    </pre>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    // parsed 但无可展示内容（空日志 / 纯被过滤段）。
    if (turns.length === 0) {
      return (
        <div className="min-h-0 flex-1 overflow-y-auto bg-background px-5 py-5">
          <p className="py-6 text-center text-xs text-muted-foreground">
            解析成功，但没有可展示的对话内容
          </p>
        </div>
      );
    }

    // 正常态：触顶「加载更早」行 + TurnTimeline（自带滚动容器，flex-1 承接）。
    return (
      <>
        {truncated && (
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-b border-border bg-background px-5 py-1.5">
            <button
              type="button"
              onClick={handleLoadEarlier}
              disabled={loadingEarlier}
              data-testid="agent-replay-load-earlier"
              className="rounded-full border border-border bg-card px-3.5 py-1 text-[11.5px] text-brand-700 transition-colors hover:bg-brand-50 disabled:cursor-default disabled:opacity-60"
            >
              {loadingEarlier ? "加载中…" : "加载更早"}
            </button>
            {loadEarlierNote && (
              <p className="text-[11px] text-muted-foreground">{loadEarlierNote}</p>
            )}
            <p className="text-[10.5px] text-muted-foreground">
              已加载 {loadedMessages.length} 段（共 {totalSegments} 段）
            </p>
          </div>
        )}
        {/* TurnTimeline 必填 props 回放取值（design Phase 3.2 清单逐项）：
            errorMsg=null（错误走主体三态提示行不进时间线）；daemonRestartedHint
            =null（无 daemon_restarted 场景）；autoResumeEntries=[]；sessionStatus
            ="idle"（回放只读，不渲染待答卡/恢复卡）；pendingRequests=[]；
            dialogHistory=[]（回放无 AskUser 记录）；onDialogResolved/onResend/
            onSwitchProvider=no-op；hasOnlineProvider=false + emptyProviderLabel
            =""（空态不显示 provider 就绪提示——空 turns 时本组件先于时间线给出
            回放自有空态，不落入组件内置空态文案）；highlightTurnKey=null
            （回放无轮次跳转入口，无选中轮）；suppressFollowBottom=false（无
            跳转翻页，不置位）。 */}
        <TurnTimeline
          turns={turns}
          viewMode={viewMode}
          errorMsg={null}
          daemonRestartedHint={null}
          autoResumeEntries={[]}
          sessionStatus="idle"
          pendingRequests={[]}
          dialogHistory={[]}
          onDialogResolved={noopDialogResolved}
          onResend={noopResend}
          onSwitchProvider={noopSwitchProvider}
          hasOnlineProvider={false}
          emptyProviderLabel=""
          highlightTurnKey={null}
          suppressFollowBottom={false}
        />
      </>
    );
  })();

  return (
    <div data-testid="agent-replay-body" className="flex min-h-0 flex-1 flex-col">
      {/* 顶部说明行（原型 .topbar）：来源说明 + 累计用量 + 视图切换 + 刷新。 */}
      <div
        data-testid="agent-replay-topbar"
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-brand-50 px-5 py-1.5 text-[11px] text-muted-foreground"
      >
        <span>🧾 由 SillySpec CLI 自动上报创建 · 内容从本机日志实时读取</span>
        {usageText && (
          <span data-testid="agent-replay-total-usage" className="font-mono">
            {usageText}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {turns.length > 0 && (
            <div
              role="tablist"
              aria-label="回放显示范围"
              className="inline-flex items-center rounded-full border border-border bg-card/60 p-0.5"
            >
              {(["conversation", "all"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={viewMode === m}
                  data-testid={`agent-replay-tab-${m}`}
                  onClick={() => setViewMode(m)}
                  className={cn(
                    "cursor-pointer rounded-full px-2.5 py-0.5 text-[11px] leading-none transition-colors",
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
          {/* 刷新：invalidate agentLogs 键（列表 + 回放消息共用前缀，一并重取）。 */}
          <button
            type="button"
            title="刷新"
            onClick={() => {
              void qc.invalidateQueries({ queryKey: queryKeys.agentLogs.all });
            }}
            className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
          >
            刷新
          </button>
        </div>
      </div>

      {/* 工作会话折叠条（更早主日志 + 子代理；有才渲染）。 */}
      {workerEntries.length > 0 && (
        <WorkerSessionsStrip
          entries={workerEntries}
          onPick={(entryId) => setFocusId(entryId)}
        />
      )}

      {/* 工作会话焦点面包屑：返回主会话 + 当前条目标识。 */}
      {focusedEntry != null && (
        <div
          data-testid="agent-replay-focus-bar"
          className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-5 py-1.5 text-[11.5px]"
        >
          <button
            type="button"
            data-testid="agent-replay-back-main"
            onClick={() => setFocusId(null)}
            className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-brand-700 transition-colors hover:bg-brand-50"
          >
            ← 返回主会话
          </button>
          <span className="min-w-0 truncate text-muted-foreground">
            工作会话 ·{" "}
            <span className="font-semibold text-cyan-700">
              {workerRoleLabel(focusedEntry)}
            </span>
            <span className="ml-1 font-mono">{workerShortCode(focusedEntry)}</span>
          </span>
        </div>
      )}

      {body}
    </div>
  );
}

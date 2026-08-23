"use client";

/**
 * AgentLogCard / AgentLogSessionBody —— 「本地 Agent 日志」会话化两形态
 * （2026-08-23-agent-activity-sessions task-07 / FR-07 / FR-08 / D-004；
 * 前身 2026-08-23-platform-agent-log-ingest task-04 ql-20260823-002-6a1a）。
 *
 * 依据（design §3.4 + prototype-agent-activity-sessions.html）：
 *   - AgentLogCard：普通会话（chat 或已激活 tool_report）对话流**尾部**的折叠
 *     条目——streamFooter 注入（turn-timeline.tsx），仅关联本会话的上报
 *     （listAgentLogs(sessionId)，GET /api/agent-logs?session_id=…）。
 *     形态沿用：🧾 头像 + 助手答复同款气泡 + 一行摘要「N 个 · 最新 X 前 ▸」
 *     + 展开明细（harness 徽标 / originator / session 短码 / 大小 / 活跃绿点 /
 *     调用次数 / 最近命令 / log_path 复制）。
 *   - AgentLogSessionBody：origin=tool_report 且 turn_count===0 的会话**主体**
 *     ——全量 entries 逐条气泡流（不折叠成 3 条），顶部说明「由 SillySpec CLI
 *     自动上报创建」+ 刷新；底部输入区由 session-panel 保留（首条消息懒激活）。
 *   - 每个条目行尾「查看内容 ▾」（task-05 对话化升级，2026-08-23-agent-log-
 *     conversation-view / FR-01 / FR-03 / FR-05 / D-003@v1 / D-006@v1）：展开先
 *     readAgentLogMessages（GET /api/agent-logs/{id}/messages）——status=parsed
 *     时直构 NormalizedLogMessage 段列表渲染对话流（user_input 用户气泡 /
 *     reply MarkdownText / thinking 折叠 / tool_use+tool_result 按 tool_use_id
 *     配对成 ToolCallPreview 卡片、失配渲染「结果未记录」中性徽章；不走
 *     session-log-assembler、零协议文本合成），「对话 / 原文」tab（原文懒调
 *     readAgentLogContent 复用 <pre>），truncated 时「加载更早」带 before_seq
 *     （当前最小 seq）前插；status≠parsed / ApiError（422 老 daemon / 409 /
 *     404 / 5xx）一律静默回落原文 <pre> + 黄条原因（不弹错框）；仅原文端点
 *     自身失败保留红条（现状语义，design §7.2 / §7.3 / §5.2）。
 *
 * 渲染门控（AgentLogCard）：空列表 / error / loading 一律返回 null——流内
 * 不出现占位块（有上报才出现，避免每条会话尾巴挂空盒）。SessionBody 是
 * 会话主体，loading / error / 空态各有显式中文提示。
 *
 * 视觉（双主题铁律）：harness 徽标走 brand-* 语义阶（bg-brand-50/
 * text-brand-700/border-brand-100，随 html data-theme 换肤）；zcode 用语义
 * info 青（cyan 固定阶，对齐 runtime-card-helpers info 徽标，NFR-03）；
 * 「查看内容」按钮 brand 阶文字色。不硬编码 hex。
 *
 * 相对时间：dayjs relativeTime 插件 + zh-cn locale（X-15），日期渲染显式
 * zh-CN 语境（CONVENTIONS 类型与数据契约 8）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import relativeTime from "dayjs/plugin/relativeTime";
import { Bot, FileText, Wrench } from "lucide-react";

import {
  listAgentLogs,
  readAgentLogContent,
  readAgentLogMessages,
  type AgentLogContentResponse,
  type AgentLogListItem,
  type AgentLogMessagesResponse,
} from "@/lib/agent-logs";
import { ApiError } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import {
  CollapsibleSection,
  ToolCallPreview,
  ToolResultCard,
} from "@/components/agent-log/tool-renderers";
import type { ToolCallEntry } from "@/components/agent-log/types";
import { MarkdownText } from "@/components/ui/markdown-text";

// 全仓首次 extend（X-15）：relativeTime 提供 fromNow；zh-cn 使 fromNow 输出
// 「N 分钟前」中文（antd-providers 只覆盖 antd 组件语境，dayjs 需自设 locale）。
dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

/** 展开态默认展示条数（超出走「展开全部 N 条 / 收起」）——仅 AgentLogCard 折叠形态。 */
const COLLAPSED_COUNT = 3;

/** 「活跃中」判定窗口：last_seen_at 15 分钟内显示绿点（原型 .live-dot）。 */
const ACTIVE_WINDOW_MS = 15 * 60 * 1000;

/** 复制成功反馈驻留时长（原型 copy()：900ms 后还原文案）。 */
const COPY_FEEDBACK_MS = 900;

/** 复制反馈 key 前缀（条目内区分 session_id / log_path 两个复制目标）。 */
type CopyTarget = { key: string; text: string };

/* ───────────────── 纯格式化辅助（null 安全） ───────────────── */

/**
 * session_id 短码：uuid 取前 8 + … + 后 4；非 uuid（如 zcode 的
 * model-io-sess_* 自构 id）截前 16 + …。展示形态 `sess <短码>`。
 */
function shortSessionId(id: string): string {
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (isUuid) return `${id.slice(0, 8)}…${id.slice(-4)}`;
  return id.length > 16 ? `${id.slice(0, 16)}…` : id;
}

/** 大小人性化：B → KB → MB（一位小数；null/非数字返回 null 交由上层「—」兜底）。 */
function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** last_seen_at 是否在活跃窗口内（null/非法时间不活跃，绿点不渲染）。 */
function isRecentlyActive(lastSeenAt: string | null | undefined): boolean {
  if (!lastSeenAt) return false;
  const t = dayjs(lastSeenAt);
  if (!t.isValid()) return false;
  return Date.now() - t.valueOf() < ACTIVE_WINDOW_MS;
}

/* ───────────── 查看内容 · 对话化渲染辅助（task-05，design §7.3 / §5.2） ───────────── */

/** 归一化消息单条（api-types 生成 schema 内层条目，snake_case 原样访问）。 */
type AgentLogMessageItem = NonNullable<
  AgentLogMessagesResponse["messages"]
>[number];

/** messages 端点响应里前端消费的对话流数据 + 窗口截断元信息。 */
interface ConversationData {
  messages: AgentLogMessageItem[];
  truncated: boolean;
  totalSegments: number;
}

/**
 * 段时间戳 → 「MM/DD HH:mm」短时间。toLocaleString 显式传 "zh-CN"（CONVENTIONS
 * 类型与数据契约 8：不传则依赖运行环境 locale，CI 上漂移）；null / 非法时间
 * 返回 null 不渲染。
 */
function formatSegmentTime(ts: string | null): string | null {
  if (!ts) return null;
  const t = new Date(ts);
  if (Number.isNaN(t.getTime())) return null;
  return t.toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** thinking 折叠态单行摘要（agent-log-viewer thinkingSummary 同款：压平 + 截 60 字符）。 */
function thinkingSummary(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length <= 60 ? flat : `${flat.slice(0, 60)}...`;
}

/** 黄条回落文案尾巴（原文端点口径：尾部 256KB）。 */
const FALLBACK_TAIL = "已回落原文尾部查看（最多 256KB）";

/** 200 但 status≠parsed 的回落原因（黄条中文文案，参照原型 .fb-note）。 */
function fallbackNoteForStatus(
  status: AgentLogMessagesResponse["status"],
): string {
  switch (status) {
    case "unsupported":
      return `该格式暂不支持对话化解析，${FALLBACK_TAIL}`;
    case "parse_error":
      return `日志解析失败（格式异常或坏行过多），${FALLBACK_TAIL}`;
    case "too_large":
      return `日志文件超出对话化解析预算，${FALLBACK_TAIL}`;
    default:
      return `对话化解析不可用，${FALLBACK_TAIL}`;
  }
}

/** messages 端点 HTTP 失败（422 老 daemon / 409 / 404 / 5xx）的静默回落原因。 */
function fallbackNoteForError(err: unknown): string {
  if (err instanceof ApiError) {
    // 422 是老 daemon 无 read_agent_log_messages 方法的唯一映射（design §7.2）。
    if (err.status === 422) {
      return `daemon 未升级，暂不支持对话化解析，${FALLBACK_TAIL}`;
    }
    return `对话化解析请求失败（${err.message}），${FALLBACK_TAIL}`;
  }
  return `对话化解析不可用，${FALLBACK_TAIL}`;
}

/** 对话流渲染段（由 AgentLogMessageItem 直构，零协议文本合成——D-006@v1）。 */
type ConversationSegment =
  | { kind: "reply"; seq: number; text: string }
  | { kind: "thinking"; seq: number; text: string }
  | {
      kind: "tool_use";
      seq: number;
      entry: ToolCallEntry;
      mergedResult?: string;
      durationMs?: number;
      hasResult: boolean;
    }
  | { kind: "tool_result"; seq: number; body: string };

/** 渲染回合：user_input 独占一行用户气泡；其余段聚成 assistant 回合（原型 a-row）。 */
type ConversationTurn =
  | { role: "user"; key: string; seq: number; text: string }
  | {
      role: "assistant";
      key: string;
      segments: ConversationSegment[];
      timeText: string | null;
    };

/**
 * 由 NormalizedLogMessage 直接构造 ToolCallEntry 纯展示 DTO（agent-log/types.ts，
 * timestamp/tool/args/status/success/rawArgs/toolUseId 直填）。rawArgs 尽力
 * JSON.parse（Bash/Read 等专用预览从中取 command/file_path 等），失败退化为
 * 原始字符串。已结束会话 status 恒 "allowed"（调用已被放行并执行，非待审批）。
 */
function toToolCallEntry(
  use: AgentLogMessageItem,
  result: AgentLogMessageItem | undefined,
): ToolCallEntry {
  const args = use.tool_input ?? "";
  let rawArgs: unknown = null;
  try {
    rawArgs = JSON.parse(args);
  } catch {
    rawArgs = args;
  }
  return {
    timestamp: use.ts ?? "",
    tool: use.tool_name ?? "unknown",
    args,
    status: "allowed",
    // is_error 着失败红（success=false → StatusBadge ✗）；失配分支不走
    // ToolCallPreview（由「结果未记录」中性徽章承接），此处取值不参与其渲染。
    success: result ? !(result.is_error ?? false) : false,
    rawArgs,
    toolUseId: use.tool_use_id ?? undefined,
  };
}

/**
 * 直构段列表（design §7.3）：tool_use / tool_result 按 tool_use_id 显式 Map
 * 配对（非位置配对）——失配 tool_use 保留 hasResult=false 供「结果未记录」中性
 * 徽章（R-03：已结束会话不得假运行）；未被消费的孤儿 tool_result（use 在更早
 * 窗口外）独立成 ToolResultCard 段。user_input 切回合边界，其余段聚进
 * assistant 回合，回合时间取末段有效 ts。
 */
function buildConversationTurns(
  messages: AgentLogMessageItem[],
): ConversationTurn[] {
  // tool_use_id → 首条 tool_result（seq 升序下最早结果；重复结果按孤儿渲染）。
  const resultById = new Map<string, AgentLogMessageItem>();
  for (const m of messages) {
    if (m.kind === "tool_result" && m.tool_use_id && !resultById.has(m.tool_use_id)) {
      resultById.set(m.tool_use_id, m);
    }
  }
  const consumedResultIds = new Set<string>();
  const turns: ConversationTurn[] = [];
  let current: Extract<ConversationTurn, { role: "assistant" }> | null = null;
  const flushAssistant = () => {
    if (current && current.segments.length > 0) turns.push(current);
    current = null;
  };
  for (const m of messages) {
    if (m.kind === "user_input") {
      flushAssistant();
      turns.push({ role: "user", key: `u-${m.seq}`, seq: m.seq, text: m.text ?? "" });
      continue;
    }
    if (!current) {
      current = { role: "assistant", key: `a-${m.seq}`, segments: [], timeText: null };
    }
    switch (m.kind) {
      case "reply":
        current.segments.push({ kind: "reply", seq: m.seq, text: m.text ?? "" });
        break;
      case "thinking":
        current.segments.push({ kind: "thinking", seq: m.seq, text: m.text ?? "" });
        break;
      case "tool_use": {
        const result = m.tool_use_id ? resultById.get(m.tool_use_id) : undefined;
        if (result?.tool_use_id) consumedResultIds.add(result.tool_use_id);
        const startMs = m.ts ? Date.parse(m.ts) : NaN;
        const endMs = result?.ts ? Date.parse(result.ts) : NaN;
        current.segments.push({
          kind: "tool_use",
          seq: m.seq,
          entry: toToolCallEntry(m, result),
          mergedResult: result?.tool_result ?? undefined,
          durationMs:
            Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
              ? endMs - startMs
              : undefined,
          hasResult: Boolean(result),
        });
        break;
      }
      case "tool_result":
        // 已并入 tool_use 卡片的跳过；孤儿结果独立渲染（不丢信息）。
        if (!(m.tool_use_id && consumedResultIds.has(m.tool_use_id))) {
          current.segments.push({
            kind: "tool_result",
            seq: m.seq,
            body: m.tool_result ?? "",
          });
        }
        break;
    }
    if (m.ts) current.timeText = formatSegmentTime(m.ts);
  }
  flushAssistant();
  return turns;
}

/** 原文视图（「原文」tab 与回落态共用）：truncated 注明 + 尾部文本 <pre>（现状形态）。 */
function RawLogContent({ data }: { data: AgentLogContentResponse }) {
  return (
    <>
      {data.truncated && (
        <p className="border-b border-border px-2.5 py-1 text-[10.5px] text-muted-foreground">
          已截断至末尾 256KB
        </p>
      )}
      <pre
        data-testid="agent-log-raw-pre"
        className="max-h-64 overflow-auto whitespace-pre-wrap break-all px-2.5 py-2 font-mono text-[10.5px] leading-4 text-foreground"
      >
        {data.content}
      </pre>
    </>
  );
}

/** 单段渲染分支（design §7.3：reply→MarkdownText / thinking→折叠 / tool→卡片）。 */
function renderSegment(seg: ConversationSegment) {
  switch (seg.kind) {
    case "reply":
      return (
        <div
          key={seg.seq}
          className="min-w-0 rounded-2xl rounded-tl-sm border border-border bg-card px-3 py-2 text-[12.5px] leading-relaxed text-foreground"
        >
          <MarkdownText content={seg.text} />
        </div>
      );
    case "thinking":
      return (
        <CollapsibleSection
          key={seg.seq}
          title="思考过程"
          defaultOpen={false}
          summary={thinkingSummary(seg.text)}
        >
          <div className="whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-muted-foreground">
            {seg.text}
          </div>
        </CollapsibleSection>
      );
    case "tool_use":
      // 配对成功：复用 ToolCallPreview（agent-log-viewer 同款导出）+ 结果并入
      // 卡片结果区（mergedResult），is_error 经 entry.success 着失败红。
      return seg.hasResult ? (
        <div key={seg.seq} className="min-w-0 font-mono [overflow-wrap:anywhere]">
          <ToolCallPreview
            entry={seg.entry}
            mergedResult={seg.mergedResult}
            durationMs={seg.durationMs}
          />
        </div>
      ) : (
        // 配对失配（窗口截断/中断）：中性「结果未记录」徽章（muted/zinc 阶），
        // 禁止复用「执行中 ⏳」假运行语义（design §7.3 / R-03）。
        <div
          key={seg.seq}
          data-testid="agent-log-tool-no-result"
          className="min-w-0 rounded-md border border-border bg-card px-2.5 py-1.5 font-mono [overflow-wrap:anywhere]"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Wrench aria-hidden className="h-3 w-3 shrink-0 text-cyan-700" />
            <span className="min-w-0 break-words text-[11px] font-semibold text-cyan-700">
              {seg.entry.tool}
            </span>
            <span className="inline-flex items-center rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
              结果未记录
            </span>
          </div>
          {seg.entry.args && (
            <CollapsibleSection title="参数">
              <pre className="max-w-full whitespace-pre-wrap break-words rounded-md border border-border bg-muted px-2 py-1 text-[11px] leading-5 text-foreground [overflow-wrap:anywhere]">
                {seg.entry.args}
              </pre>
            </CollapsibleSection>
          )}
        </div>
      );
    case "tool_result":
      // 孤儿结果（对应 tool_use 在更早窗口外）：独立 ToolResultCard，不丢信息。
      return (
        <div key={seg.seq} className="min-w-0 font-mono [overflow-wrap:anywhere]">
          <ToolResultCard body={seg.body} />
        </div>
      );
  }
}

/* ───────────────── 复制反馈（navigator.clipboard + 瞬时文案） ─────────── */

/**
 * 复制反馈小 hook：writeText 后 900ms 内 copiedKey 命中目标显示「已复制 ✓」；
 * 同一时间只保留最后一个目标的反馈，定时器随卸载清理。
 */
function useCopyFeedback() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const copy = useCallback(({ key, text }: CopyTarget) => {
    // 剪贴板不可用（非安全上下文等）静默失败——反馈文案照常给出，不阻塞排障主路径。
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopiedKey(key);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopiedKey(null), COPY_FEEDBACK_MS);
  }, []);

  return { copiedKey, copy };
}

/* ───────────────── 条目行（两形态共用） ───────────────── */

/**
 * 单条日志元信息行：harness 徽标 / originator / session 短码 / 大小 + 活跃
 * 绿点 / 调用次数 + 最近命令 + format / log_path 复制 /「查看内容」内联展开。
 *
 * 根元素是 div（不带 li/bubble 壳）——AgentLogCard 折叠明细以 <li> 包裹
 * （列表语义），AgentLogSessionBody 以头像 + 气泡包裹（对话流语义）。
 */
function AgentLogEntry({
  entry,
  copiedKey,
  onCopy,
}: {
  entry: AgentLogListItem;
  copiedKey: string | null;
  onCopy: (_target: CopyTarget) => void;
}) {
  // zcode 徽标走语义 info 青（NFR-03：zcode 是外部 harness 标识而非品牌用途，
  // cyan 固定阶对齐 runtime-card-helpers info 徽标）。
  const isZcode = entry.harness.toLowerCase() === "zcode";
  const isDaemon = entry.originator === "sillyhub-daemon";

  const sessionKey = `${entry.id}:session`;
  const pathKey = `${entry.id}:path`;
  const sizeText = formatBytes(entry.size_bytes);
  const timeText = entry.last_seen_at
    ? `${dayjs(entry.last_seen_at).fromNow()}活跃`
    : null;
  const recentlyActive = isRecentlyActive(entry.last_seen_at);

  // 「查看内容」内联展开态（task-05 对话化升级）：展开先调 messages 端点——
  // parsed 直构对话流；status≠parsed / ApiError 一律静默回落 content 原文
  // （黄条注明原因，不弹错框）；仅原文端点自身失败保留红条（现状语义）。
  const [peekOpen, setPeekOpen] = useState(false);
  const [peekLoading, setPeekLoading] = useState(false);
  const [convData, setConvData] = useState<ConversationData | null>(null);
  const [viewTab, setViewTab] = useState<"conversation" | "raw">("conversation");
  const [rawData, setRawData] = useState<AgentLogContentResponse | null>(null);
  const [rawLoading, setRawLoading] = useState(false);
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);
  const [peekError, setPeekError] = useState<string | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [loadEarlierNote, setLoadEarlierNote] = useState<string | null>(null);
  // 展开轮次号：收起 / 重开 / 换条目自增——迟到的异步回调按轮次丢弃陈旧写入。
  const peekEpochRef = useRef(0);

  const turns = useMemo(
    () => (convData ? buildConversationTurns(convData.messages) : []),
    [convData],
  );

  /** 拉原文（回落态立即 / 「原文」tab 懒加载共用）；失败走既有红条语义。 */
  const fetchRawContent = useCallback(
    (epoch: number) => {
      setRawLoading(true);
      setPeekError(null);
      readAgentLogContent(entry.id)
        .then((data) => {
          if (peekEpochRef.current !== epoch) return;
          setRawData(data);
          setRawLoading(false);
        })
        .catch((err: unknown) => {
          if (peekEpochRef.current !== epoch) return;
          // ApiError.message 即后端中文文案（409 二进制 / 404 无归属 / 504 离线）。
          setPeekError(
            err instanceof ApiError ? err.message : "读取日志内容失败",
          );
          setRawLoading(false);
        });
    },
    [entry.id],
  );

  useEffect(() => {
    const epoch = ++peekEpochRef.current;
    // 收起即清态：重开重新拉取，错误/数据不驻留陈旧状态。
    if (!peekOpen) {
      setPeekLoading(false);
      setConvData(null);
      setViewTab("conversation");
      setRawData(null);
      setRawLoading(false);
      setFallbackNote(null);
      setPeekError(null);
      setLoadingEarlier(false);
      setLoadEarlierNote(null);
      return;
    }
    let cancelled = false;
    setPeekLoading(true);
    setPeekError(null);
    readAgentLogMessages(entry.id)
      .then((resp) => {
        if (cancelled || peekEpochRef.current !== epoch) return;
        setPeekLoading(false);
        if (resp.status === "parsed") {
          setConvData({
            messages: resp.messages ?? [],
            truncated: resp.truncated,
            totalSegments: resp.total_segments,
          });
          return;
        }
        // 200 但解析分层失败（unsupported / parse_error / too_large）→ 静默回落。
        setFallbackNote(fallbackNoteForStatus(resp.status));
        fetchRawContent(epoch);
      })
      .catch((err: unknown) => {
        if (cancelled || peekEpochRef.current !== epoch) return;
        setPeekLoading(false);
        // HTTP 非 200（422 老 daemon / 409 / 404 / 5xx）→ 同样静默回落原文。
        setFallbackNote(fallbackNoteForError(err));
        fetchRawContent(epoch);
      });
    return () => {
      cancelled = true;
    };
  }, [peekOpen, entry.id, fetchRawContent]);

  /** 「加载更早」（design §5.2）：携带当前最小 seq 重取，返回段前插并刷新截断标记。 */
  const handleLoadEarlier = useCallback(() => {
    if (!convData || loadingEarlier) return;
    const beforeSeq =
      convData.messages.length > 0
        ? Math.min(...convData.messages.map((m) => m.seq))
        : undefined;
    const epoch = peekEpochRef.current;
    setLoadingEarlier(true);
    setLoadEarlierNote(null);
    readAgentLogMessages(entry.id, beforeSeq)
      .then((resp) => {
        if (peekEpochRef.current !== epoch) return;
        setLoadingEarlier(false);
        if (resp.status !== "parsed") {
          // 热文件轮换 / 重解析失败：保持现有内容，静默提示可重试。
          setLoadEarlierNote("更早内容暂时无法解析，请稍后重试");
          return;
        }
        setConvData((prev) => {
          if (!prev) return prev;
          const existingSeqs = new Set(prev.messages.map((m) => m.seq));
          const older = (resp.messages ?? []).filter(
            (m) => !existingSeqs.has(m.seq),
          );
          return {
            messages: [...older, ...prev.messages].sort((a, b) => a.seq - b.seq),
            truncated: resp.truncated,
            totalSegments: resp.total_segments,
          };
        });
      })
      .catch(() => {
        if (peekEpochRef.current !== epoch) return;
        setLoadingEarlier(false);
        setLoadEarlierNote("加载更早失败，请重试");
      });
  }, [convData, loadingEarlier, entry.id]);

  return (
    <div>
      {/* 第一行：harness / originator / session 短码 · 大小 + 活跃时间（右侧） */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[11px] font-semibold",
            isZcode
              ? "border-cyan-200 bg-cyan-50 text-cyan-700"
              : "border-brand-100 bg-brand-50 text-brand-700",
          )}
        >
          {entry.harness}
        </span>
        {entry.originator && (
          <span
            title={`上报来源：${entry.originator}`}
            className={cn(
              "inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[11px]",
              isDaemon
                ? "border-brand-600 text-brand-700"
                : "border-dashed border-border text-muted-foreground",
            )}
          >
            {entry.originator}
          </span>
        )}
        {entry.session_id && (
          <button
            type="button"
            aria-label={`复制 session_id：${entry.session_id}`}
            title={`点击复制 session_id：${entry.session_id}`}
            onClick={() =>
              onCopy({ key: sessionKey, text: entry.session_id ?? "" })
            }
            className="shrink-0 cursor-pointer rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {copiedKey === sessionKey
              ? "已复制 ✓"
              : `sess ${shortSessionId(entry.session_id)}`}
          </button>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] text-muted-foreground">
          {recentlyActive && (
            <span
              className="h-1.5 w-1.5 rounded-full bg-emerald-500"
              aria-label="最近活跃"
            />
          )}
          {sizeText ?? "—"} · {timeText ?? "—"}
        </span>
      </div>

      {/* 第二行：调用次数（常驻，null → 「—」）/ 最近命令（code 样式）/ 日志格式 */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
        <span>调用 {entry.invocations ?? "—"} 次</span>
        {entry.last_command != null && (
          <span className="flex items-center gap-1">
            最近命令
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
              {entry.last_command}
            </code>
          </span>
        )}
        {entry.format != null && <span>{entry.format}</span>}
      </div>

      {/* 第三行：log_path 截断展示（title 全文 + 点击复制完整路径）+「查看内容」。 */}
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          aria-label={`复制日志路径：${entry.log_path}`}
          title={entry.log_path}
          onClick={() => onCopy({ key: pathKey, text: entry.log_path })}
          className="min-w-0 flex-1 cursor-pointer truncate text-left font-mono text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {copiedKey === pathKey ? "已复制 ✓" : entry.log_path}
        </button>
        <button
          type="button"
          aria-expanded={peekOpen}
          title={
            peekOpen
              ? "收起日志内容"
              : "展开查看日志内容（对话化回显，不支持时回落原文）"
          }
          onClick={() => setPeekOpen((v) => !v)}
          data-testid="agent-log-content-toggle"
          className="shrink-0 cursor-pointer rounded px-1 py-0.5 text-[11px] text-brand-700 transition-colors hover:bg-brand-50"
        >
          {peekOpen ? "收起 ▴" : "查看内容 ▾"}
        </button>
      </div>

      {/* 查看内容内联面板（原型 .dialog 对话化 / .fallback 回落双形态）。 */}
      {peekOpen && (
        <div
          data-testid="agent-log-content-panel"
          className="mt-1.5 overflow-hidden rounded-md border border-border bg-muted/40"
        >
          {peekLoading && (
            <p className="px-2.5 py-2 text-[11px] text-muted-foreground">
              内容加载中…
            </p>
          )}

          {convData && (
            <>
              {/* 头部：会话回放 + 共 N 段 + 「对话 / 原文」tab（原型 .dialog-head）。 */}
              <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-2.5 py-1.5">
                <span className="text-xs font-medium text-foreground">
                  会话回放
                </span>
                <span className="text-[11px] text-muted-foreground">
                  共 {convData.totalSegments} 段
                </span>
                <div className="ml-auto flex items-center gap-1">
                  {(["conversation", "raw"] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      aria-pressed={viewTab === tab}
                      data-testid={`agent-log-tab-${tab}`}
                      onClick={() => {
                        setViewTab(tab);
                        // 原文 tab 懒加载：首次切入才调 content 端点。
                        if (tab === "raw" && rawData == null && !rawLoading) {
                          fetchRawContent(peekEpochRef.current);
                        }
                      }}
                      className={cn(
                        "cursor-pointer rounded border px-2 py-0.5 text-[11px] transition-colors",
                        viewTab === tab
                          ? "border-brand-600 bg-brand-50 font-semibold text-brand-700"
                          : "border-border bg-card text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {tab === "conversation" ? "对话" : "原文"}
                    </button>
                  ))}
                </div>
              </div>

              {viewTab === "conversation" ? (
                <div
                  data-testid="agent-log-conversation-stream"
                  className="flex max-h-80 flex-col gap-3 overflow-y-auto px-2.5 py-2.5"
                >
                  {convData.truncated && (
                    <>
                      <button
                        type="button"
                        onClick={handleLoadEarlier}
                        disabled={loadingEarlier}
                        data-testid="agent-log-load-earlier"
                        className="mx-auto shrink-0 self-center rounded-full border border-border bg-card px-3.5 py-1 text-[11.5px] text-brand-700 transition-colors hover:bg-brand-50 disabled:cursor-default disabled:opacity-60"
                      >
                        {loadingEarlier ? "加载中…" : "加载更早"}
                      </button>
                      {loadEarlierNote && (
                        <p className="mx-auto self-center text-[11px] text-muted-foreground">
                          {loadEarlierNote}
                        </p>
                      )}
                    </>
                  )}
                  {turns.map((turn) =>
                    turn.role === "user" ? (
                      <div key={turn.key} className="flex justify-end">
                        <div className="max-w-[82%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-brand-600 px-3 py-2 text-[12.5px] leading-relaxed text-white">
                          {turn.text}
                        </div>
                      </div>
                    ) : (
                      <div key={turn.key} className="flex items-start gap-2">
                        <span
                          aria-hidden
                          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-card text-muted-foreground"
                        >
                          <Bot className="h-3.5 w-3.5" />
                        </span>
                        <div className="flex min-w-0 max-w-[88%] flex-1 flex-col gap-2">
                          {turn.segments.map(renderSegment)}
                          {turn.timeText && (
                            <span className="text-[10px] text-muted-foreground">
                              {turn.timeText}
                            </span>
                          )}
                        </div>
                      </div>
                    ),
                  )}
                  {convData.truncated && (
                    <p className="mx-auto self-center rounded-lg border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] text-amber-800">
                      仅展示最近 {convData.messages.length} 段（共{" "}
                      {convData.totalSegments} 段）· 点「加载更早」查看更多
                    </p>
                  )}
                  {turns.length === 0 && (
                    <p className="py-3 text-center text-[11px] text-muted-foreground">
                      解析成功，但没有可展示的对话内容
                    </p>
                  )}
                </div>
              ) : (
                <div data-testid="agent-log-raw-view">
                  {rawLoading && (
                    <p className="px-2.5 py-2 text-[11px] text-muted-foreground">
                      原文加载中…
                    </p>
                  )}
                  {peekError && (
                    <p
                      role="alert"
                      className="px-2.5 py-2 text-[11px] text-destructive"
                    >
                      内容读取失败：{peekError}
                    </p>
                  )}
                  {rawData && <RawLogContent data={rawData} />}
                </div>
              )}
            </>
          )}

          {/* 回落态（status≠parsed / HTTP 失败）：黄条原因 + 原文（无对话 tab）。 */}
          {fallbackNote && (
            <div data-testid="agent-log-fallback">
              <p
                data-testid="agent-log-fallback-note"
                className="border-b border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-4 text-amber-800"
              >
                ⚠ {fallbackNote}
              </p>
              {rawLoading && (
                <p className="px-2.5 py-2 text-[11px] text-muted-foreground">
                  内容加载中…
                </p>
              )}
              {peekError && (
                <p
                  role="alert"
                  className="px-2.5 py-2 text-[11px] text-destructive"
                >
                  内容读取失败：{peekError}
                </p>
              )}
              {rawData && <RawLogContent data={rawData} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────────────── 会话关联查询（两形态共用 hook 参数） ───────────────── */

/** 会话关联日志查询选项（30s 轮询跟随上报节奏，design §3.4，X-20：非秒级心跳）。 */
function useSessionAgentLogs(sessionId: string) {
  return useQuery({
    queryKey: queryKeys.agentLogs.list(sessionId),
    queryFn: () => listAgentLogs(sessionId),
    refetchInterval: 30_000,
    enabled: Boolean(sessionId),
  });
}

/* ───────────────── 形态一：对话流尾部折叠条目 ───────────────── */

/**
 * AgentLogCard —— 普通会话（chat / 已激活 tool_report）对话流尾部条目：
 * 默认折叠成一行摘要，点击展开明细（>3 条再折叠一层）。
 * 挂载走 TurnTimeline streamFooter（session-panel.tsx 传 sessionId 关联）。
 */
export function AgentLogCard({ sessionId }: { sessionId: string }) {
  const qc = useQueryClient();
  const { copiedKey, copy } = useCopyFeedback();
  // 外层折叠（会话流内默认收起成一行摘要，点击头部展开）；内层 expanded 管
  // 「展开全部 N 条」（条数超过 COLLAPSED_COUNT 时）。
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const logsQ = useSessionAgentLogs(sessionId);

  // sessionId 空 / error / loading / 空列表 一律不渲染：会话流内不出现占位块
  //（ql-20260823-002-6a1a：有上报才出现；design §4 增强信息不干扰主体验）。
  // 注意先调完 hook 再 return（hooks 规则）。
  if (!sessionId || logsQ.isError || logsQ.isPending) return null;

  const items = logsQ.data?.items ?? [];
  if (items.length === 0) return null;

  const visible = expanded ? items : items.slice(0, COLLAPSED_COUNT);
  // 摘要行的「最新」取首条（列表按 last_seen_at 新→旧排序，首条即最新）。
  const newest = items[0] ?? null;
  const newestText = newest?.last_seen_at
    ? dayjs(newest.last_seen_at).fromNow()
    : null;

  return (
    <div
      aria-label="本地 Agent 日志"
      className="flex items-start gap-2.5"
      data-testid="agent-log-stream-entry"
    >
      {/* 头像：助手答复同款圆形头像（h-7 w-7 rounded-full border bg-muted），
          图标用 FileText 标识「日志条目」身份（Bot 是答复专用）。 */}
      <span
        aria-hidden
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-muted text-muted-foreground"
      >
        <FileText className="h-3.5 w-3.5" />
      </span>
      {/* 气泡：助手答复同款（rounded-2xl rounded-tl-md border bg-card）。 */}
      <div className="min-w-0 max-w-[86%] rounded-2xl rounded-tl-md border bg-card px-4 py-2.5 text-sm shadow-sm">
        {/* 头部（可点击折叠）：标题 + 概要 + 展开箭头。 */}
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "收起本地 Agent 日志" : "展开本地 Agent 日志"}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full cursor-pointer flex-wrap items-center gap-x-2 gap-y-0.5 text-left"
          data-testid="agent-log-toggle"
        >
          <span className="text-xs font-medium text-foreground">
            本地 Agent 日志
          </span>
          <span className="text-[11px] text-muted-foreground">
            {items.length} 个 · {newestText ? `最新 ${newestText}` : "—"}
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
          <>
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
              agent 会话的完整模型 I/O 日志（本机文件），由 SillySpec CLI 自动上报
            </p>
            <ul
              className="mt-2 flex flex-col gap-2"
              data-testid="agent-log-entries"
            >
              {visible.map((entry) => (
                <li
                  key={entry.id}
                  className="rounded-md border border-border px-2.5 py-2"
                >
                  <AgentLogEntry
                    entry={entry}
                    copiedKey={copiedKey}
                    onCopy={copy}
                  />
                </li>
              ))}
            </ul>
            <div className="mt-2 flex items-center justify-between gap-2">
              {items.length > COLLAPSED_COUNT ? (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="cursor-pointer rounded px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {expanded ? "收起" : `展开全部 ${items.length} 条`}
                </button>
              ) : (
                <span />
              )}
              {/* 刷新：invalidate agentLogs 键（30s 轮询之外的手动补偿）。 */}
              <button
                type="button"
                title="刷新"
                onClick={() => {
                  void qc.invalidateQueries({ queryKey: queryKeys.agentLogs.all });
                }}
                className="shrink-0 cursor-pointer rounded px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                刷新
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ───────────────── 形态二：tool_report 会话主体 ───────────────── */

/**
 * AgentLogSessionBody —— origin=tool_report 且 turn_count===0 会话的内容主体：
 * 全量 entries 逐条气泡流（不折叠；条目多时容器自身滚动），条目行复用
 * AgentLogEntry（含复制 + 查看内容交互）。输入区由 session-panel 保留在下方
 * （首条消息懒激活派发，D-002）。
 *
 * 容器与 TurnTimeline 同构（min-h-0 flex-1 overflow-y-auto bg-background
 * px-5 py-5），保证与对话流形态互换时布局零跳动。
 */
export function AgentLogSessionBody({ sessionId }: { sessionId: string }) {
  const qc = useQueryClient();
  const { copiedKey, copy } = useCopyFeedback();
  const logsQ = useSessionAgentLogs(sessionId);

  const items = logsQ.data?.items ?? [];

  return (
    <div
      data-testid="agent-log-session-body"
      className="min-h-0 flex-1 overflow-y-auto bg-background px-5 py-5"
    >
      {/* 顶部说明行 + 刷新（原型 .head .sub「由 SillySpec CLI 自动上报创建」）。 */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          由 SillySpec CLI 自动上报创建 · 点下方输入框即可继续对话
        </p>
        <button
          type="button"
          title="刷新"
          onClick={() => {
            void qc.invalidateQueries({ queryKey: queryKeys.agentLogs.all });
          }}
          className="shrink-0 cursor-pointer rounded px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          刷新
        </button>
      </div>

      {logsQ.isPending ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          日志条目加载中…
        </p>
      ) : logsQ.isError ? (
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
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          暂无日志上报，等待 SillySpec CLI 下次上报…
        </p>
      ) : (
        <ul
          className="flex flex-col gap-2.5"
          data-testid="agent-log-session-entries"
        >
          {items.map((entry) => (
            <li key={entry.id} className="flex items-start gap-2.5">
              {/* 头像 + 气泡：对话流同构（🧾 标识日志条目身份）。 */}
              <span
                aria-hidden
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-muted text-muted-foreground"
              >
                <FileText className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 max-w-[86%] rounded-2xl rounded-tl-md border bg-card px-4 py-2.5 text-sm shadow-sm">
                <AgentLogEntry
                  entry={entry}
                  copiedKey={copiedKey}
                  onCopy={copy}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

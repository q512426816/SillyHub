"use client";

/**
 * AgentLogCard —— 「本地 Agent 日志」会话流条目（2026-08-23-platform-agent-log-ingest
 * task-04 / FR-04 / D-006；ql-20260823-002-6a1a 改会话流内展示）。
 *
 * 依据：
 *   - 用户反馈：独立卡片夹在消息流与输入区之间「很别扭」→ 改为消息流内条目
 *   - design.md §3.4（数据链路不变：listAgentLogs(workspaceId)，GET /api/agent-logs，
 *     类型取 api-types 生成 schema，X-06）/ §4（失败不干扰会话主体验）
 *   - turn-timeline.tsx 视觉语言：助手答复 = 左侧圆形头像 + rounded-tl 气泡
 *     （本组件同构复用该形态，头像换 FileText 图标标识「日志条目」）
 *
 * 形态（ql-20260823-002-6a1a）：挂载改走 TurnTimeline streamFooter 注入口——
 * 渲染在最后一个 turn 之后、同一滚动容器内，是「对话流里的一条消息」而非
 * 面板级独立卡片（session-panel.tsx 不再独立挂载）。默认**折叠成一行摘要**
 * （🧾 本地 Agent 日志 · N 个 · 最新 X 前 + 展开箭头），点击头部切换展开明细。
 *
 * 渲染门控：空列表 / error / loading 一律返回 null——流内不出现占位块
 * （有上报才出现，避免每条会话尾巴挂空盒）。
 *
 * 视觉（双主题铁律）：harness 徽标走 brand-* 语义阶（bg-brand-50/
 * text-brand-700/border-brand-100，随 html data-theme 换肤）；zcode 用语义
 * info 青（cyan 固定阶，对齐 runtime-card-helpers info 徽标，NFR-03）；
 * sillyhub-daemon originator 加 brand 实线边框，其余虚线灰。不硬编码 hex。
 *
 * 相对时间：dayjs relativeTime 插件 + zh-cn locale——全仓首次 extend（X-15），
 * 日期渲染显式 zh-CN 语境（CONVENTIONS 类型与数据契约 8）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import relativeTime from "dayjs/plugin/relativeTime";
import { FileText } from "lucide-react";

import { listAgentLogs, type AgentLogListItem } from "@/lib/agent-logs";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

// 全仓首次 extend（X-15）：relativeTime 提供 fromNow；zh-cn 使 fromNow 输出
// 「N 分钟前」中文（antd-providers 只覆盖 antd 组件语境，dayjs 需自设 locale）。
dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

/** 展开态默认展示条数（超出走「展开全部 N 条 / 收起」）。 */
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

/* ───────────────── 条目行 ───────────────── */

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

  return (
    <li className="rounded-md border border-border px-2.5 py-2">
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

      {/* 第三行：log_path 截断展示（title 全文）+ 点击复制完整路径 */}
      <button
        type="button"
        aria-label={`复制日志路径：${entry.log_path}`}
        title={entry.log_path}
        onClick={() => onCopy({ key: pathKey, text: entry.log_path })}
        className="mt-1 block w-full cursor-pointer truncate text-left font-mono text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
      >
        {copiedKey === pathKey ? "已复制 ✓" : entry.log_path}
      </button>
    </li>
  );
}

/* ───────────────── 会话流条目 ───────────────── */

export function AgentLogCard({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const { copiedKey, copy } = useCopyFeedback();
  // 外层折叠（会话流内默认收起成一行摘要，点击头部展开）；内层 expanded 管
  // 「展开全部 N 条」（条数超过 COLLAPSED_COUNT 时）。
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const logsQ = useQuery({
    queryKey: queryKeys.agentLogs.list(workspaceId),
    queryFn: () => listAgentLogs(workspaceId),
    // 30s 轮询跟随 run 级上报节奏（design §3.4，X-20：非秒级心跳）。
    refetchInterval: 30_000,
    enabled: Boolean(workspaceId),
  });

  // workspaceId 空 / error / loading / 空列表 一律不渲染：会话流内不出现占位块
  //（ql-20260823-002-6a1a：有上报才出现；design §4 增强信息不干扰主体验）。
  // 注意先调完 hook 再 return（hooks 规则）。
  if (!workspaceId || logsQ.isError || logsQ.isPending) return null;

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
                <AgentLogEntry
                  key={entry.id}
                  entry={entry}
                  copiedKey={copiedKey}
                  onCopy={copy}
                />
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

"use client";

/**
 * AgentLogCard —— 「本地 Agent 日志」卡片（2026-08-23-platform-agent-log-ingest
 * task-04 / FR-04 / D-006）。
 *
 * 依据：
 *   - tasks/task-04.md（allowed_paths / implementation / acceptance / constraints）
 *   - design.md §3.4（挂载与轮询）/ §4（GET 失败卡片隐藏，增强信息不干扰主体验）
 *   - 原型 prototype-agent-log-panel.html（卡片结构 / 三态 / 复制交互 / 配色语义）
 *
 * 形态（模式 A 小卡片，先例 change-sessions-card.tsx）：挂在 SessionPanelPage
 * 消息流（TurnTimeline）下方、TeamTaskBlock 上方（挂载归 session-panel.tsx，
 * dialog 模式不涉及）；消费 listAgentLogs(workspaceId)（GET /api/agent-logs，
 * 类型取 api-types 生成 schema，X-06），30s refetchInterval 轮询跟随 run 级
 * 上报节奏（X-20）。
 *
 * 三态：
 *   - loading：轻量「加载中…」文案（同 change-sessions-card 惯例）；
 *   - 空态：虚线框提示（agent 下次执行 sillyspec run 时会自动上报）；
 *   - 列表：默认 3 条 + 「展开全部 N 条 / 收起」；error 静默返回 null
 *     （design §4：卡片是增强信息，失败不干扰会话主体验）。
 *
 * 视觉（双主题铁律）：harness 徽标走 brand-* 语义阶（bg-brand-50/
 * text-brand-700/border-brand-100，随 html data-theme 换肤）；zcode 用语义
 * info 青（cyan 固定阶，对齐 runtime-card-helpers info 徽标与原型 zcode 分支，
 * NFR-03）；sillyhub-daemon originator 加 brand 实线边框，其余虚线灰。不硬编码
 * hex（主题 token / 语义类）。
 *
 * 相对时间：dayjs relativeTime 插件 + zh-cn locale——全仓首次 extend（X-15），
 * 日期渲染显式 zh-CN 语境（CONVENTIONS 类型与数据契约 8）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import relativeTime from "dayjs/plugin/relativeTime";

import { listAgentLogs, type AgentLogListItem } from "@/lib/agent-logs";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

// 全仓首次 extend（X-15）：relativeTime 提供 fromNow；zh-cn 使 fromNow 输出
// 「N 分钟前」中文（antd-providers 只覆盖 antd 组件语境，dayjs 需自设 locale）。
dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

/** 折叠态默认展示条数（原型状态三：默认展示 3 条）。 */
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
 * model-io-sess_* 自构 id）截前 16 + …。展示形态 `sess <短码>`（原型 .sess-id）。
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
 * 复制反馈小 hook：writeText 后 900ms 内 copiedKey 命中目标显示「已复制 ✓」
 * （原型 copy() 行为）；同一时间只保留最后一个目标的反馈，定时器随卸载清理。
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
  // 原型 .harness.zcode 分支；cyan 固定阶对齐 runtime-card-helpers info 徽标）。
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

/* ───────────────── 卡片 ───────────────── */

export function AgentLogCard({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const { copiedKey, copy } = useCopyFeedback();
  const [expanded, setExpanded] = useState(false);

  const logsQ = useQuery({
    queryKey: queryKeys.agentLogs.list(workspaceId),
    queryFn: () => listAgentLogs(workspaceId),
    // 30s 轮询跟随 run 级上报节奏（design §3.4，X-20：非秒级心跳）。
    refetchInterval: 30_000,
    enabled: Boolean(workspaceId),
  });

  // workspaceId 空（挂载点 null 守卫之外的防御）与 error 态同语义：静默不渲染
  //（design §4：增强信息不干扰会话主体验）。注意先调完 hook 再 return（hooks 规则）。
  if (!workspaceId || logsQ.isError) return null;

  const items = logsQ.data?.items ?? [];
  const visible = expanded ? items : items.slice(0, COLLAPSED_COUNT);

  return (
    <section
      aria-label="本地 Agent 日志"
      className="rounded-md border bg-card px-3 py-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-xs font-medium">本地 Agent 日志</h2>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            agent 会话的完整模型 I/O 日志（本机文件），由 SillySpec CLI 自动上报
          </p>
        </div>
        {/* 刷新：invalidate agentLogs 键（原型 .mini-btn「刷新 = react-query invalidate」） */}
        <button
          type="button"
          title="刷新"
          onClick={() => {
            void qc.invalidateQueries({ queryKey: queryKeys.agentLogs.all });
          }}
          className="shrink-0 cursor-pointer rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-brand-300 hover:text-foreground"
        >
          刷新
        </button>
      </div>

      {logsQ.isPending ? (
        <p className="px-1.5 py-1 text-[11px] text-muted-foreground">加载中…</p>
      ) : items.length === 0 ? (
        // 空态（原型状态二）：虚线框说明 + 引导文案。
        <div className="mt-2.5 rounded-md border border-dashed border-border px-3 py-3 text-center text-[11px] leading-5 text-muted-foreground">
          <span>尚未收到该工作区的 agent 日志上报</span>
          <br />
          <span>
            agent 下次执行 <code className="font-mono">sillyspec run</code>{" "}
            时会自动上报本地日志路径
          </span>
        </div>
      ) : (
        <>
          <ul className="mt-2.5 flex flex-col gap-2" data-testid="agent-log-entries">
            {visible.map((entry) => (
              <AgentLogEntry
                key={entry.id}
                entry={entry}
                copiedKey={copiedKey}
                onCopy={copy}
              />
            ))}
          </ul>
          {items.length > COLLAPSED_COUNT && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 w-full cursor-pointer rounded px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {expanded ? "收起" : `展开全部 ${items.length} 条`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

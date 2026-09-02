"use client";

/**
 * ShadowSessionViewer — 影子会话查看器（群聊体验 quick，2026-09-02）。
 *
 * MemberPanel agent 成员卡整卡点击打开（群主 + 普通成员都可看——后端已放行
 * 影子会话 logs 只读端点；群会话本身不可读，仅 logs）。内容 = 影子会话
 * （member.shadow_session_id）时间线：
 *   - 初始 getAgentSessionLogs(shadowSid, { limit: 100 })（最新 100 条，升序）；
 *   - 向上无限滚动：滚到顶自动加载更老（before = 当前最早行 ts，limit=100，
 *     结果 prepend；无更多显示「没有更多了」）；
 *   - 搜索（Drawer 头部）：回车 q= 全量搜索（不带 before/after，limit=100），
 *     结果列表替换 + 清搜索恢复初始浏览；命中内容 <mark> 高亮（首次出现）；
 *   - 行渲染：user_input 行（注入 prompt——截断显示前 200 字 + 展开，标签
 *     「注入」）与 stdout 行（agent 输出，剥前缀走 MarkdownText，标签成员名），
 *     ts 升序（复用群时间线排序纯函数风格 compareShadowLogTs）；
 *   - loading / 错误态：antd Spin / Result。
 *
 * 依据：lib/daemon.ts getAgentSessionLogs quick 扩展参数（before/q/limit）、
 * classifySessionLog 前缀剥除（群时间线同源口径）、ui/markdown-text 安全渲染。
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from "react";
import { Button, Drawer, Input, Result, Spin } from "antd";

import { classifySessionLog } from "@/components/daemon/session-log-assembler";
import { MarkdownText } from "@/components/ui/markdown-text";
import { errMessage } from "@/lib/errors";
import { getAgentSessionLogs } from "@/lib/daemon";
import type { AgentRunLogEntry } from "@/lib/agent";

/* ────────────────────── 常量与纯辅助 ────────────────────── */

/** 初始/向上翻页每页条数（logs 端点 limit 语义：最新 N 条升序）。 */
export const SHADOW_PAGE_SIZE = 100;

/** 注入 prompt 截断展示长度（展开全文可看完整）。 */
const INJECT_PREVIEW_CHARS = 200;

/** 向上无限滚动触发阈值（scrollTop 距顶 ≤ 该值即预取更老一页）。 */
const LOAD_OLDER_THRESHOLD_PX = 48;

/** 时间轴比较：timestamp 升序（解析失败回退字符串比较），同拍按 id 稳定定序（群时间线同风格）。 */
function compareShadowLogTs(a: AgentRunLogEntry, b: AgentRunLogEntry): number {
  const ta = Date.parse(a.timestamp);
  const tb = Date.parse(b.timestamp);
  const na = Number.isNaN(ta) ? null : ta;
  const nb = Number.isNaN(tb) ? null : tb;
  if (na !== null && nb !== null && na !== nb) return na - nb;
  const cmp = a.timestamp.localeCompare(b.timestamp);
  if (cmp !== 0) return cmp;
  return a.id.localeCompare(b.id);
}

/** 影子日志排序（纯函数：后端升序 + 同拍 id 定序兜底）。 */
export function sortShadowLogs(logs: AgentRunLogEntry[]): AgentRunLogEntry[] {
  return [...logs].sort(compareShadowLogTs);
}

/** 命中高亮（简单 <mark>：首次出现、大小写不敏感；未命中原文返回）。 */
export function highlightHit(
  text: string,
  term: string | null,
): ReactNode {
  if (!term) return text;
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark data-testid="shadow-search-hit">
        {text.slice(idx, idx + term.length)}
      </mark>
      {text.slice(idx + term.length)}
    </>
  );
}

/** 时间戳展示（zh-CN 铁律显式 locale）。 */
function formatTime(ts: string): string {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/* ────────────────────── 组件 ────────────────────── */

export interface ShadowSessionViewerProps {
  /** 打开态（Drawer open）。 */
  open: boolean;
  /** 关闭回调。 */
  onClose: () => void;
  /** 影子会话 id（member.shadow_session_id；空 = 未建影子——调用方不开 Drawer）。 */
  shadowSessionId: string;
  /** agent 成员昵称（输出行标签 + 标题）。 */
  memberName: string;
}

export function ShadowSessionViewer({
  open,
  onClose,
  shadowSessionId,
  memberName,
}: ShadowSessionViewerProps) {
  /* ── 浏览态（初始 + 向上翻页） ── */
  const [rows, setRows] = useState<AgentRunLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /* ── 搜索态（term 非空 = 搜索结果模式，替换浏览列表） ── */
  const [searchTerm, setSearchTerm] = useState<string | null>(null);

  /* ── prepend 滚动锚（加载更老后保持视口位置：补回 scrollHeight 增量） ── */
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingAnchorRef = useRef<number | null>(null);
  useEffect(() => {
    if (pendingAnchorRef.current == null || !scrollRef.current) return;
    const el = scrollRef.current;
    el.scrollTop += el.scrollHeight - pendingAnchorRef.current;
    pendingAnchorRef.current = null;
  }, [rows]);

  /** 初始加载（open 时触发；key 语义：每次打开重置）。 */
  const loadInitial = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    setSearchTerm(null);
    try {
      const logs = await getAgentSessionLogs(shadowSessionId, {
        limit: SHADOW_PAGE_SIZE,
      });
      setRows(sortShadowLogs(logs));
      setHasMore(logs.length >= SHADOW_PAGE_SIZE);
    } catch (err) {
      setErrorMsg(errMessage(err, "影子会话记录加载失败"));
    } finally {
      setLoading(false);
    }
  }, [shadowSessionId]);

  useEffect(() => {
    if (!open) return;
    setRows([]);
    setHasMore(true);
    void loadInitial();
  }, [open, loadInitial]);

  /** 向上加载更老（before = 当前行最早 ts；结果 prepend + 推进游标）。 */
  const loadOlder = useCallback(async () => {
    if (loading || loadingOlder || !hasMore || searchTerm != null) return;
    const cursor = rows[0]?.timestamp;
    if (!cursor) return;
    setLoadingOlder(true);
    try {
      const older = await getAgentSessionLogs(shadowSessionId, {
        before: cursor,
        limit: SHADOW_PAGE_SIZE,
      });
      // 滚动锚：记录 prepend 前高度（useEffect 补回增量，视口停在原内容处）。
      if (scrollRef.current) {
        pendingAnchorRef.current = scrollRef.current.scrollHeight;
      }
      setRows((prev) => sortShadowLogs([...older, ...prev]));
      setHasMore(older.length >= SHADOW_PAGE_SIZE);
    } catch (err) {
      setErrorMsg(errMessage(err, "加载更早记录失败"));
    } finally {
      setLoadingOlder(false);
    }
  }, [loading, loadingOlder, hasMore, searchTerm, rows, shadowSessionId]);

  /** 滚到顶触发预取更老（搜索模式不翻页）。 */
  const handleScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      if (searchTerm != null) return;
      if (e.currentTarget.scrollTop <= LOAD_OLDER_THRESHOLD_PX) {
        void loadOlder();
      }
    },
    [searchTerm, loadOlder],
  );

  /** 搜索（回车触发：q= 全量搜索，limit=100，不带 before/after）。 */
  const handleSearch = useCallback(
    async (raw: string) => {
      const q = raw.trim();
      if (!q || loading) return;
      setLoading(true);
      setErrorMsg(null);
      try {
        const hits = await getAgentSessionLogs(shadowSessionId, {
          q,
          limit: SHADOW_PAGE_SIZE,
        });
        setSearchTerm(q);
        setRows(sortShadowLogs(hits));
      } catch (err) {
        setErrorMsg(errMessage(err, "搜索失败"));
      } finally {
        setLoading(false);
      }
    },
    [loading, shadowSessionId],
  );

  /** 清搜索恢复初始浏览（重新拉最新 100 条）。 */
  const clearSearch = useCallback(() => {
    setSearchTerm(null);
    void loadInitial();
  }, [loadInitial]);

  /* ── 行渲染分流（注入 prompt 截断 + agent 输出剥前缀 md） ── */

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="min(920px, 94vw)"
      destroyOnClose
      title={
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span className="truncate text-[15px] font-semibold">
            「{memberName}」影子会话时间线
          </span>
          <span className="w-64 max-w-full">
            {/* onSearch 同时覆盖回车与搜索按钮（antd Search 内建 Enter 触发；
                不再叠 onPressEnter——会双发两次查询）。 */}
            <Input.Search
              data-testid="shadow-session-search"
              aria-label="搜索影子会话记录"
              placeholder="搜索影子会话记录，回车查询"
              size="small"
              allowClear
              disabled={loading}
              onSearch={(v) => void handleSearch(v)}
            />
          </span>
        </div>
      }
    >
      {/* 模式条：搜索结果态显示命中数 + 清除恢复；浏览态显示向上翻页状态。 */}
      {searchTerm != null && (
        <div
          data-testid="shadow-search-mode-bar"
          className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"
        >
          <span>
            「{searchTerm}」命中 {rows.length} 条
            {rows.length >= SHADOW_PAGE_SIZE ? "（仅前 100 条）" : ""}
          </span>
          <Button size="small" onClick={clearSearch}>
            清除搜索
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12" data-testid="shadow-session-loading">
          <Spin tip="加载中…">
            <div className="h-16" />
          </Spin>
        </div>
      ) : errorMsg ? (
        <Result
          status="warning"
          title="记录加载失败"
          subTitle={errorMsg}
          extra={
            <Button type="primary" onClick={() => void loadInitial()}>
              重试
            </Button>
          }
        />
      ) : (
        <div
          ref={scrollRef}
          data-testid="shadow-session-timeline"
          onScroll={handleScroll}
          className="h-full overflow-y-auto pr-1"
        >
          {/* 向上翻页状态位（浏览态）：加载中 spinner / 没有更多了。 */}
          {searchTerm == null &&
            (loadingOlder ? (
              <div className="flex justify-center py-2 text-xs text-muted-foreground">
                <Spin size="small" />
                <span className="ml-2">正在加载更早记录…</span>
              </div>
            ) : !hasMore && rows.length > 0 ? (
              <p
                data-testid="shadow-session-no-more"
                className="py-2 text-center text-xs text-muted-foreground"
              >
                没有更多了
              </p>
            ) : null)}

          {rows.length === 0 && (
            <p
              data-testid="shadow-session-empty"
              className="py-12 text-center text-xs text-muted-foreground"
            >
              {searchTerm != null
                ? `未找到匹配「${searchTerm}」的记录`
                : "暂无记录——该成员还没有影子会话日志"}
            </p>
          )}

          {rows.map((log) => (
            <ShadowLogRow key={log.id} log={log} memberName={memberName} term={searchTerm} />
          ))}
        </div>
      )}
    </Drawer>
  );
}

/* ────────────────────── 行渲染 ────────────────────── */

/** 注入 prompt 截断展示（INJECT_PREVIEW_CHARS + 展开全文/收起）。 */
function ShadowLogRow({
  log,
  memberName,
  term,
}: {
  log: AgentRunLogEntry;
  memberName: string;
  term: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const content = log.content_redacted ?? "";

  if (log.channel === "user_input") {
    // 注入 prompt：截断 200 字 + 展开（全文可能是一大段 dispatch_prompt）。
    const over = content.length > INJECT_PREVIEW_CHARS;
    const shown = over && !expanded ? `${content.slice(0, INJECT_PREVIEW_CHARS)}…` : content;
    return (
      <div
        data-testid="shadow-log-inject"
        className="my-2 flex gap-2.5"
      >
        <div className="min-w-0 flex-1">
          <p className="mb-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="rounded bg-muted px-1.5 py-px text-[10px] font-semibold text-muted-foreground">
              注入
            </span>
            <span>{formatTime(log.timestamp)}</span>
          </p>
          <div className="whitespace-pre-wrap break-words rounded-xl rounded-bl-sm border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-foreground">
            {highlightHit(shown, term)}
            {over && (
              <button
                type="button"
                data-testid="shadow-log-inject-toggle"
                onClick={() => setExpanded((v) => !v)}
                className="ml-1.5 shrink-0 font-medium text-brand-600 transition-colors hover:text-brand-700"
              >
                {expanded ? "收起" : "展开全文"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (log.channel !== "stdout") return null;
  // agent 输出：classifySessionLog 前缀剥除（群时间线同源口径），reply 段才渲染。
  const segment = classifySessionLog(content, log.channel, log.tool_kind);
  if (!segment || segment.kind !== "reply") return null;
  return (
    <div data-testid="shadow-log-output" className="my-2 flex gap-2.5">
      <div className="min-w-0 flex-1">
        <p className="mb-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="rounded bg-brand-100 px-1.5 py-px text-[10px] font-semibold text-brand-700">
            {memberName}
          </span>
          <span>{formatTime(log.timestamp)}</span>
        </p>
        {/* 搜索命中高亮只作用于纯文本注入行；md 输出行 @/标记自然显示（从简，
            与群聊气泡同口径）。 */}
        <div className="break-words rounded-xl rounded-bl-sm border border-border bg-card px-3 py-2 text-xs shadow-sm">
          <MarkdownText content={segment.text} />
        </div>
      </div>
    </div>
  );
}

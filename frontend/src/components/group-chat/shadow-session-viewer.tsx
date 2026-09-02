"use client";

/**
 * ShadowSessionViewer — 影子会话查看器（群聊体验 quick，2026-09-02；同日会话
 * 体验对齐 quick 重做渲染层）。
 *
 * MemberPanel agent 成员卡整卡点击打开（群主 + 普通成员都可看——后端已放行
 * 影子会话 logs 只读端点；群会话本身不可读，仅 logs）。
 *
 * 会话同款体验（对齐 session-panel /sessions 页）：
 *   - 装配：日志行（影子 user_input + stdout/tool_call 等）经 session-log-assembler
 *     装配原语 logsToTurns（单聊从原始 logs 到 turns 的同一入口，runtime-session-
 *     helpers）装配为 SessionTurnView[]——影子注入 prompt = 用户 turn、agent
 *     stdout = 回复段（[ASSISTANT]/[THINKING]/[TOOL_USE] 前缀分类天然兼容）；
 *     user turn 的 sender 统一显示「注入」身份（影子的 user_input 均为群消息
 *     注入产物，不追求真发送者，从简——run.user 恒为群主）；
 *   - 渲染：TurnTimeline（会话消息流共享子组件）——「对话」视图 = 用户消息 +
 *     回复卡片；「进度」视图（viewMode="all"）= 完整段时间线（thinking/工具
 *     调用等过程信息白拿 assembler 分类展示）；AgentLogCard footer 不传；
 *   - 头部 viewMode 胶囊（对话/进度，样式抄 session-panel :3530 按钮组）。
 *
 * 数据层保留（quick 前版口径不变）：
 *   - 初始 getAgentSessionLogs(shadowSid, { limit: 100 })（最新 100 条，升序）；
 *   - 向上无限滚动：滚到顶自动加载更老（before = 当前最早行 ts，limit=100，
 *     结果 prepend + 重装配 turns；无更多显示「没有更多了」；prepend 后按
 *     scrollHeight 增量补回视口位置——经捕获阶段 scroll 监听 TurnTimeline 内部
 *     滚动容器 turn-timeline-scroll）；
 *   - 搜索（Drawer 头部）：回车 q= 全量搜索（不带 before/after，limit=100），
 *     结果替换 + 清搜索恢复初始浏览；命中高亮降级为 TurnTimeline 内文本。
 *
 * 依据：lib/daemon.ts getAgentSessionLogs quick 扩展参数（before/q/limit）、
 * runtime-session-helpers logsToTurns（attach 历史装配入口）、daemon/turn-timeline
 * （会话消息流共享子组件，本文件只消费不改）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Drawer, Input, Result, Spin } from "antd";

import { TurnTimeline } from "@/components/daemon/turn-timeline";
import type {
  SessionTurnView,
  SessionViewMode,
} from "@/components/daemon/turn-timeline";
import { logsToTurns } from "@/components/daemon/runtime-session-helpers";
import { errMessage } from "@/lib/errors";
import { getAgentSessionLogs } from "@/lib/daemon";
import type { AgentRunLogEntry } from "@/lib/agent";
import { cn } from "@/lib/utils";

/* ────────────────────── 常量与纯辅助 ────────────────────── */

/** 初始/向上翻页每页条数（logs 端点 limit 语义：最新 N 条升序）。 */
export const SHADOW_PAGE_SIZE = 100;

/** 向上无限滚动触发阈值（scrollTop 距顶 ≤ 该值即预取更老一页）。 */
const LOAD_OLDER_THRESHOLD_PX = 48;

/** 影子 user turn 统一身份标签（注入产物，不追求真发送者）。 */
const SHADOW_SENDER_LABEL = "注入";

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

/**
 * 装配纯函数（导出供单测推理面）：影子 logs → 会话 turns——logsToTurns 分组
 * 装配（user_input 提取 prompt、stdout 分类为 reply/thinking/tool 段）后给每个
 * turn 附「注入」sender 身份（at = 该 run 组首条日志 ts，用户气泡左侧时间）。
 */
export function assembleShadowTurns(logs: AgentRunLogEntry[]): SessionTurnView[] {
  const firstTsByRun = new Map<string, string>();
  for (const log of logs) {
    if (!firstTsByRun.has(log.run_id)) firstTsByRun.set(log.run_id, log.timestamp);
  }
  return logsToTurns(logs).map((turn) => ({
    ...turn,
    sender: {
      name: SHADOW_SENDER_LABEL,
      me: false,
      at: firstTsByRun.get(turn.realRunId ?? "") ?? null,
    },
  }));
}

/* ────────────────────── 组件 ────────────────────── */

export interface ShadowSessionViewerProps {
  /** 打开态（Drawer open）。 */
  open: boolean;
  /** 关闭回调。 */
  onClose: () => void;
  /** 影子会话 id（member.shadow_session_id；空 = 未建影子——调用方不开 Drawer）。 */
  shadowSessionId: string;
  /** agent 成员昵称（标题）。 */
  memberName: string;
}

const VIEW_MODES: ReadonlyArray<SessionViewMode> = ["conversation", "all"];

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

  /* ── 视图模式（对话/进度，会话页同款胶囊；默认对话。 ── */
  const [viewMode, setViewMode] = useState<SessionViewMode>("conversation");

  /* ── 装配：rows → turns（日志到达/翻页/搜索后重装配，渲染层零胶水。 ── */
  const turns = useMemo<SessionTurnView[]>(
    () => assembleShadowTurns(rows),
    [rows],
  );

  /* ── 滚动接线：捕获阶段监听 TurnTimeline 内部滚动容器（native scroll 不冒泡，
   *    capture 命中全部后代；jsdom fireEvent 派发亦走捕获相位）；
   *    prepend 滚动锚：加载更老后按 scrollHeight 增量补回视口位置。 ── */
  const wrapRef = useRef<HTMLDivElement>(null);
  const pendingAnchorRef = useRef<number | null>(null);
  const timelineScrollEl = useCallback(
    () =>
      wrapRef.current?.querySelector<HTMLElement>(
        '[data-testid="turn-timeline-scroll"]',
      ) ?? null,
    [],
  );
  useEffect(() => {
    if (pendingAnchorRef.current == null) return;
    const el = timelineScrollEl();
    if (el) el.scrollTop += el.scrollHeight - pendingAnchorRef.current;
    pendingAnchorRef.current = null;
  }, [rows, timelineScrollEl]);

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

  /** 向上加载更老（before = 当前行最早 ts；结果 prepend + 重装配 turns）。 */
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
      const el = timelineScrollEl();
      if (el) pendingAnchorRef.current = el.scrollHeight;
      setRows((prev) => sortShadowLogs([...older, ...prev]));
      setHasMore(older.length >= SHADOW_PAGE_SIZE);
    } catch (err) {
      setErrorMsg(errMessage(err, "加载更早记录失败"));
    } finally {
      setLoadingOlder(false);
    }
  }, [loading, loadingOlder, hasMore, searchTerm, rows, shadowSessionId, timelineScrollEl]);

  /** loadOlder 经 ref 供捕获监听闭包读取（监听挂一次不随翻页状态重挂）。 */
  const loadOlderRef = useRef(loadOlder);
  loadOlderRef.current = loadOlder;
  // 时间线外包层是否挂载（loading/错误/空态时不渲染）——监听 effect 的依赖维度。
  const timelineMounted = rows.length > 0;
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (!el || el.getAttribute("data-testid") !== "turn-timeline-scroll") return;
      if (el.scrollTop <= LOAD_OLDER_THRESHOLD_PX) void loadOlderRef.current();
    };
    wrap.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () =>
      wrap.removeEventListener("scroll", onScroll, { capture: true } as AddEventListenerOptions);
    // 依赖面板形态变化重挂监听（翻页内容变化不重挂——只看挂载门控维度）。
  }, [loading, errorMsg, timelineMounted]);

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
          {/* 对话/进度胶囊（样式抄 session-panel 视图切换按钮组）。 */}
          <div
            role="tablist"
            aria-label="消息显示范围"
            className="inline-flex items-center rounded-full border bg-muted/50 p-0.5"
          >
            {VIEW_MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                data-testid={`shadow-viewmode-${m}`}
                aria-selected={viewMode === m}
                onClick={() => setViewMode(m)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] leading-none transition-colors",
                  viewMode === m
                    ? "bg-card font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "conversation" ? "对话" : "进度"}
              </button>
            ))}
          </div>
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
      ) : rows.length === 0 ? (
        <p
          data-testid="shadow-session-empty"
          className="py-12 text-center text-xs text-muted-foreground"
        >
          {searchTerm != null
            ? `未找到匹配「${searchTerm}」的记录`
            : "暂无记录——该成员还没有影子会话日志"}
        </p>
      ) : (
        <div
          ref={wrapRef}
          data-testid="shadow-session-timeline"
          className="flex h-full min-h-0 flex-col"
        >
          {/* 向上翻页状态位（浏览态）：加载中 spinner / 没有更多了。 */}
          {searchTerm == null &&
            (loadingOlder ? (
              <div className="flex justify-center py-2 text-xs text-muted-foreground">
                <Spin size="small" />
                <span className="ml-2">正在加载更早记录…</span>
              </div>
            ) : !hasMore ? (
              <p
                data-testid="shadow-session-no-more"
                className="py-2 text-center text-xs text-muted-foreground"
              >
                没有更多了
              </p>
            ) : null)}

          {/* 会话同款消息流（只消费不改 TurnTimeline）：对话 = 用户消息 + 回复
              卡片；进度 = 完整段时间线（过程信息）。 */}
          <TurnTimeline
            turns={turns}
            viewMode={viewMode}
            errorMsg={null}
            sessionStatus="ended"
            pendingRequests={[]}
            dialogHistory={[]}
            onDialogResolved={() => {
              /* 只读查看器：无待答卡。 */
            }}
            onResend={() => {
              /* 只读查看器：无重发。 */
            }}
            onSwitchProvider={() => {
              /* 只读查看器：无供应商切换。 */
            }}
            hasOnlineProvider={false}
            emptyProviderLabel=""
          />
        </div>
      )}
    </Drawer>
  );
}

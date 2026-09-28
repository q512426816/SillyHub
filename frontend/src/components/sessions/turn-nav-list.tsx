"use client";

/**
 * task-04（2026-09-27-session-fast-replay / FR-06）→ 2026-09-28-turn-nav-hover-flyout：
 * 轮次导航形态调整——「窄轨 + 悬停展开」。
 *
 * 形态演进史：30px 刻度轨（命中区小看不见轮号被用户两轮抱怨）→ 220px 常驻行式列
 * （信息全但常驻占地方，2026-09-28 用户反馈）→ 本版折中：
 * - 平时 44px 窄轨：垂直紧凑刻度 + 当前轮刻度高亮 + 顶部把手（当前轮号 + 展开指示）；
 * - 悬停窄轨 300ms 防抖滑出完整行式列表**浮层**（absolute 覆盖聊天区左缘，不挤压
 *   消息流布局）；窄轨与浮层整体移开 250ms 后收起；
 * - 点击把手 pin 锁定常开（触屏 hover:none 的主通道），再点或点浮层外收起；
 * - 浮层内保留行式列全部能力：轮号+状态点+大纲摘要+相对时间、当前轮高亮滚动
 *   联动、整行命中点击跳转（未加载轮走父层 run_id 直达）；
 * - 窄轨刻度本身也是 button（aria-label 同行式版第N轮·状态·摘要——键盘/读屏
 *   可达性不降级，点击直接跳转该轮）。
 *
 * 受控纯组件（仿 turn-catalog / subagent-catalog 先例）：props 进回调出，不发网络
 * 请求、不操作聊天区 DOM/滚动（active 联动仅滚自身轨内）。短会话 <3 轮整条隐藏
 * （ql-20260909-005 既有口径）。颜色全走主题语义类（brand/muted-foreground 阶，
 * 随 html data-theme 换肤），零硬编码；antd 不用。
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  TurnCatalogEntry,
  TurnCatalogEntryStatus,
} from "@/components/sessions/turn-catalog";
import { cn } from "@/lib/utils";

export type TurnNavEntryStatus = TurnCatalogEntryStatus;
export type TurnNavEntry = TurnCatalogEntry;

export interface TurnNavListProps {
  entries: TurnNavEntry[];
  /** 当前轮 key（聊天滚动/跳转联动）：命中行常亮并 aria-current="true"。 */
  activeTurnKey: string | null;
  /** 历史加载进行中（跳转链路翻页时）：轨标注 aria-busy，无额外视觉。 */
  loadingEarlier?: boolean;
  /** 点击行回调（携带完整条目；跳转/未加载加载链路由父层实现）。 */
  onJump(turn: TurnNavEntry): void;
}

/** 窄轨宽度（px）。 */
const RAIL_WIDTH = 44;
/** 展开浮层宽度（px，固定——浮层不挤压布局，无需拖宽记忆）。 */
const FLYOUT_WIDTH = 272;
/** 悬停展开防抖（ms）：停留超过该时长才滑出（掠过不误触）。 */
const OPEN_HOVER_DELAY_MS = 300;
/** 整体移开关合防抖（ms）：窄轨↔浮层间移动的间隙不闪烁。 */
const CLOSE_DELAY_MS = 250;

/** 短会话隐藏阈值（TurnCatalog ql-20260909-005 同口径：<3 轮整条不渲染）。 */
const MIN_ENTRIES = 3;
/** 长列表阈值（FR-06）：超过则浮层行高固定 + content-visibility:auto 防卡。 */
const LONG_LIST_THRESHOLD = 200;
/** 长列表固定行高（px，≥40 命中区下限；containIntrinsicSize 同值）。 */
const LONG_LIST_ROW_HEIGHT = 44;
/** 密集刻度阈值：超过则窄轨刻度改 mini 尺寸（几百轮不撑爆）。 */
const DENSE_TICK_THRESHOLD = 60;

/** aria-label 内提问摘要截断长度（TurnCatalog task-02 契约：截 30 字）。 */
const ARIA_PROMPT_MAX = 30;

/** 状态文案映射（与 turn-catalog STATUS_LABEL 同词表——轮号/状态/摘要语义保留）。 */
const STATUS_LABEL: Record<TurnNavEntryStatus, string> = {
  completed: "完成",
  failed: "失败",
  running: "运行中",
  stopped: "已停止",
  pending: "已停止",
};

/** 状态点配色（active > running > failed > 默认；全主题 token）。 */
function statusDotCls(entry: TurnNavEntry, isActive: boolean): string {
  if (isActive) return "bg-brand-600";
  switch (entry.status) {
    case "running":
      return "bg-warning animate-pulse";
    case "failed":
      return "bg-destructive/75";
    default:
      return "bg-muted-foreground/45";
  }
}

/** 超长文本截断（省略号收尾）。 */
function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** startedAt → 相对时间（刚刚 / x 分钟前 / x 小时前 / x 天前；跨年回退日期）；
 *  null / 非法值 → "--"。渲染期现算（无计时器——条目随数据刷新重渲）。 */
function formatRelativeTime(startedAt: string | null): string {
  if (!startedAt) return "--";
  const t = new Date(startedAt).getTime();
  if (!Number.isFinite(t)) return "--";
  const age = Math.max(0, Date.now() - t);
  if (age < 60_000) return "刚刚";
  if (age < 3_600_000) return `${Math.floor(age / 60_000)} 分钟前`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)} 小时前`;
  if (age < 30 * 86_400_000) return `${Math.floor(age / 86_400_000)} 天前`;
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 行/刻度 aria-label：第N轮 · 状态（未加载追加「未加载」） · 提问摘要（截 30 字）。
 *  （TurnCatalog buildAriaLabel 同构——既有轮号/状态/摘要语义保留。） */
function buildAriaLabel(entry: TurnNavEntry): string {
  const parts = [
    `第${entry.turnNo}轮`,
    `${STATUS_LABEL[entry.status]}${entry.loaded ? "" : " · 未加载"}`,
  ];
  if (entry.promptSummary) parts.push(truncate(entry.promptSummary, ARIA_PROMPT_MAX));
  return parts.join(" · ");
}

/**
 * 无文本摘要轮的中性占位（2026-09-28-turn-nav-empty-hint）：实证群聊会话存在
 * 仅 1 条空 content user_input 的 run（群聊用户正文在群消息表，agent 日志留空
 * 记录）——大纲如实返回空摘要。旧文案「未加载 — 点击加载…」语义错误（轮次
 * 状态/时间已在大纲中，非未加载）且指令多余；「未加载」状态语义保留在
 * aria-label（buildAriaLabel 后缀）。
 */
const EMPTY_HINT = "（无内容记录）";

export default function TurnNavList({
  entries,
  activeTurnKey,
  loadingEarlier,
  onJump,
}: TurnNavListProps): JSX.Element | null {
  /** 展开态：悬停（防抖）或 pin（把手点击锁定，触屏主通道）。 */
  const [pinned, setPinned] = useState(false);
  const [hoverOpen, setHoverOpen] = useState(false);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const expanded = pinned || hoverOpen;

  const clearTimers = useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  // 评审 P1 修复（2026-09-28）：展开态点击组件外部 → 收起（触屏 pin 后的主要
  // 关闭通道之一；把手✕/再点把手仍可用）。pointerdown 统一鼠标/触屏；卸载解绑。
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!expanded) return;
    const onDocPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) {
        clearTimers();
        setPinned(false);
        setHoverOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [expanded, clearTimers]);

  /** 窄轨/浮层 enter：取消关合计时，300ms 后展开。 */
  const handleEnter = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (openTimerRef.current === null) {
      openTimerRef.current = window.setTimeout(() => {
        openTimerRef.current = null;
        setHoverOpen(true);
      }, OPEN_HOVER_DELAY_MS);
    }
  }, []);

  /** 窄轨/浮层 leave：250ms 防抖收起（pin 态不收）。 */
  const handleLeave = useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current === null) {
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        setHoverOpen(false);
      }, CLOSE_DELAY_MS);
    }
  }, []);

  /** 把手点击：pin 切换（触屏 hover:none 的展开主通道；再点收起）。 */
  const togglePin = useCallback(() => {
    clearTimers();
    setHoverOpen(false);
    setPinned((v) => !v);
  }, [clearTimers]);

  /** 浮层内点行跳转后：非 pin 态自动收起（选完即走，2026-09-28 形态语义）。 */
  const handleRowJump = useCallback(
    (entry: TurnNavEntry) => {
      if (!pinned) {
        clearTimers();
        setHoverOpen(false);
      }
      onJump(entry);
    },
    [pinned, clearTimers, onJump],
  );

  const railRef = useRef<HTMLElement | null>(null);
  const activeTurnNo =
    entries.find((e) => e.key === activeTurnKey)?.turnNo ?? null;

  // active 行变化时滚入可视区（窄轨刻度与浮层行共用 [data-turn-key] 命中，TurnCatalog
  // R-10 同款）；ref 守卫首次渲染不滚。jsdom 无 scrollIntoView 需 typeof 守卫。
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const root = rootRef.current;
    if (!activeTurnKey || !root) return;
    // 评审 medium 修复：窄轨刻度与浮层行共用 [data-turn-key]——两者都滚入各自
    // 可视区（浮层展开时行随 active 联动，与行式列时代行为对齐）。
    for (const row of root.querySelectorAll(
      `[data-turn-key="${CSS.escape(activeTurnKey)}"]`,
    )) {
      if (typeof row.scrollIntoView === "function") {
        row.scrollIntoView({ block: "nearest" });
      }
    }
  }, [activeTurnKey]);

  // 短会话隐藏（early return 在全部 hooks 之后，React 规则）。
  if (entries.length < MIN_ENTRIES) return null;

  const longList = entries.length > LONG_LIST_THRESHOLD;
  const denseTicks = entries.length > DENSE_TICK_THRESHOLD;

  return (
    <div
      ref={rootRef}
      className="relative flex min-h-0 shrink-0 flex-col"
      data-testid="turn-nav-column"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {/* ── 窄轨（常驻 44px）：把手 + 垂直刻度 ── */}
      <div
        className="flex min-h-0 shrink-0 flex-col border-r border-border/60 bg-card/40"
        style={{ width: `${RAIL_WIDTH}px` }}
        data-testid="turn-nav-rail"
      >
        {/* 把手：当前轮号 + 展开指示（点击 pin；触屏主通道）。 */}
        <button
          type="button"
          aria-label={
            pinned ? "收起轮次导航" : "展开轮次导航（悬停亦可滑出）"
          }
          aria-expanded={expanded}
          data-testid="turn-nav-toggle"
          onClick={togglePin}
          className="flex h-9 shrink-0 cursor-pointer flex-col items-center justify-center gap-0.5 border-b border-border/60 text-muted-foreground outline-none transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:bg-muted/70"
        >
          <span className="font-mono text-[10px] font-semibold leading-none">
            {activeTurnNo != null ? `#${activeTurnNo}` : "—"}
          </span>
          <span aria-hidden className="text-[8px] leading-none">
            {expanded ? "◀" : "▶"}
          </span>
        </button>
        {/* 垂直刻度：每轮一段（密集态 mini 尺寸），当前轮高亮；点击直跳该轮。 */}
        <nav
          ref={railRef}
          role="navigation"
          aria-label="轮次导航"
          aria-busy={loadingEarlier || undefined}
          className="flex min-h-0 flex-1 flex-col items-center gap-px overflow-y-auto py-1.5"
          data-testid="turn-nav-rail-ticks"
        >
          {entries.map((entry) => {
            const isActive = entry.key === activeTurnKey;
            return (
              <button
                key={entry.key}
                type="button"
                data-turn-key={entry.key}
                data-testid="turn-nav-tick"
                aria-label={buildAriaLabel(entry)}
                aria-current={isActive ? "true" : undefined}
                title={buildAriaLabel(entry)}
                onClick={() => onJump(entry)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onJump(entry);
                  }
                }}
                className={cn(
                  "group relative flex w-full shrink-0 cursor-pointer items-center justify-center outline-none",
                  denseTicks ? "h-1.5" : "h-2.5",
                  "focus-visible:bg-muted/70",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "rounded-full transition-all",
                    denseTicks ? "h-0.5 w-4" : "h-1 w-5",
                    isActive
                      ? "w-6 bg-brand-600"
                      : cn(
                          "group-hover:bg-muted-foreground/70",
                          statusDotCls(entry, false),
                        ),
                  )}
                />
              </button>
            );
          })}
        </nav>
      </div>

      {/* ── 展开浮层（absolute 覆盖，不挤压聊天区）── */}
      {expanded && (
        <nav
          role="navigation"
          aria-label="轮次导航列表"
          aria-busy={loadingEarlier || undefined}
          data-testid="turn-nav-flyout"
          className="absolute bottom-0 left-[44px] top-0 z-30 flex min-h-0 flex-col overflow-hidden rounded-r-lg border border-l-0 border-border bg-card shadow-lg"
          style={{ width: `${FLYOUT_WIDTH}px` }}
        >
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/60 px-3">
            <span className="text-[11px] font-semibold text-muted-foreground">
              轮次导航 · 共 {entries.length} 轮
            </span>
            {pinned && (
              <button
                type="button"
                aria-label="收起轮次导航"
                onClick={togglePin}
                className="cursor-pointer rounded px-1.5 py-0.5 text-[10px] text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:bg-muted/70"
              >
                收起 ✕
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {entries.map((entry) => {
              const isActive = entry.key === activeTurnKey;
              return (
                <button
                  key={entry.key}
                  type="button"
                  data-turn-key={entry.key}
                  data-testid="turn-nav-row"
                  aria-label={buildAriaLabel(entry)}
                  aria-current={isActive ? "true" : undefined}
                  onClick={() => handleRowJump(entry)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleRowJump(entry);
                    }
                  }}
                  className={cn(
                    "flex w-full shrink-0 cursor-pointer flex-col gap-0.5 rounded-md px-2.5 py-2 text-left outline-none transition-colors",
                    "focus-visible:bg-muted/70 focus-visible:ring-1 focus-visible:ring-brand-400",
                    isActive
                      ? "bg-muted/60 shadow-[inset_2px_0_0_0_var(--color-brand-600)]"
                      : "hover:bg-muted/50",
                    // 长列表：固定行高（≥40px 命中区）+ content-visibility 跳出
                    // 视口的行免渲染（FR-06 >200 轮防卡）。
                    longList && "h-[44px] justify-center overflow-hidden",
                  )}
                  style={
                    longList
                      ? {
                          contentVisibility: "auto",
                          containIntrinsicSize: `${LONG_LIST_ROW_HEIGHT}px`,
                        }
                      : undefined
                  }
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 text-[12px] font-semibold text-foreground">
                      第{entry.turnNo}轮
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        statusDotCls(entry, isActive),
                      )}
                    />
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                      {formatRelativeTime(entry.startedAt)}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "line-clamp-2 text-[11px] leading-4",
                      entry.loaded
                        ? "text-foreground/90"
                        : "text-muted-foreground",
                    )}
                  >
                    {entry.promptSummary ?? EMPTY_HINT}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}

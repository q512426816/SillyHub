"use client";

/**
 * task-04（2026-09-27-session-fast-replay / FR-06）：desktop 常驻行式轮次导航列
 * （TurnCatalog 重做形态）。
 *
 * 形态：左列约 220px（usePanelWidth 记忆 sillyhub.sessions.turnNavWidth，
 * 180-320 拖宽，PanelResizer side 默认 left）+ 每行整行命中区（≥40px 高）：
 * 轮号 + 状态点 + prompt 摘要（大纲 60 字或已加载轮本地摘要覆盖——数据合并归
 * 派生层 session-panel-page mergeTurnNavEntries）+ 相对时间；当前轮高亮 +
 * 滚动联动（scrollIntoView block:nearest，TurnCatalog 同款 ref 守卫首渲不滚）；
 * 未加载轮照常显示大纲摘要（点击走父层 run_id 单轮直达跳转）。
 *
 * 长列表防卡（FR-06）：>200 轮时行高固定 44px + content-visibility:auto
 * （containIntrinsicSize 稳定滚动条估高；先简单方案，实测仍卡再上虚拟化）。
 *
 * 受控纯组件（仿 turn-catalog / subagent-catalog 先例）：props 进回调出，不
 * 发网络请求、不操作聊天区 DOM/滚动（active 联动仅滚自身轨内）。短会话
 * <3 轮整条隐藏（ql-20260909-005 既有口径保留——窄屏回收横向空间）。
 * 约束：颜色全走主题语义类/主题变量（brand 阶 / warning / destructive /
 * muted-foreground，随 html data-theme 换肤），不硬编码色值；antd 不用。
 */

import { useEffect, useRef } from "react";

import type {
  TurnCatalogEntry,
  TurnCatalogEntryStatus,
} from "@/components/sessions/turn-catalog";
import { PanelResizer, usePanelWidth } from "@/components/ui/panel-resizer";
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
  onJump: (entry: TurnNavEntry) => void;
}

/** 列宽记忆键（门户级偏好键同前缀 sillyhub.sessions.*）。 */
const TURN_NAV_WIDTH_LS_KEY = "sillyhub.sessions.turnNavWidth";
/** 列宽默认 / 最小 / 最大（FR-06：约 220px，可拖宽收窄 180-320）。 */
const TURN_NAV_WIDTH_DEFAULT = 220;
const TURN_NAV_WIDTH_MIN = 180;
const TURN_NAV_WIDTH_MAX = 320;

/** 短会话隐藏阈值（TurnCatalog ql-20260909-005 同口径：<3 轮整条不渲染）。 */
const MIN_ENTRIES = 3;
/** 长列表阈值（FR-06）：超过则行高固定 + content-visibility:auto 防卡。 */
const LONG_LIST_THRESHOLD = 200;
/** 长列表固定行高（px，≥40 命中区下限；containIntrinsicSize 同值）。 */
const LONG_LIST_ROW_HEIGHT = 44;

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

/** 行 aria-label：第N轮 · 状态（未加载追加「未加载」） · 提问摘要（截 30 字）。
 *  （TurnCatalog buildAriaLabel 同构——既有轮号/状态/摘要语义保留。） */
function buildAriaLabel(entry: TurnNavEntry): string {
  const parts = [
    `第${entry.turnNo}轮`,
    `${STATUS_LABEL[entry.status]}${entry.loaded ? "" : " · 未加载"}`,
  ];
  if (entry.promptSummary) parts.push(truncate(entry.promptSummary, ARIA_PROMPT_MAX));
  return parts.join(" · ");
}

/** 未加载且大纲也无摘要的占位文案（Drawer TURN_NAV_UNLOADED_HINT 同源语义）。 */
const UNLOADED_HINT = "未加载 — 点击加载该轮并定位";

export default function TurnNavList({
  entries,
  activeTurnKey,
  loadingEarlier,
  onJump,
}: TurnNavListProps): JSX.Element | null {
  /** 列宽拖拽 + localStorage 记忆（门户左栏/详情列同款通用件）。 */
  const [width, setWidth] = usePanelWidth({
    storageKey: TURN_NAV_WIDTH_LS_KEY,
    defaultWidth: TURN_NAV_WIDTH_DEFAULT,
    minWidth: TURN_NAV_WIDTH_MIN,
    maxWidth: TURN_NAV_WIDTH_MAX,
  });

  const railRef = useRef<HTMLElement | null>(null);

  // active 行变化时滚入轨内可视区（TurnCatalog R-10 同款）；ref 守卫首次渲染
  // 不滚。jsdom 无 scrollIntoView 实现需 typeof 守卫（session-mention-popover /
  // turn-catalog 先例）。
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const rail = railRef.current;
    if (!activeTurnKey || !rail) return;
    const row = rail.querySelector(
      `[data-turn-key="${CSS.escape(activeTurnKey)}"]`,
    );
    if (row && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [activeTurnKey]);

  // 短会话隐藏（early return 在全部 hooks 之后，React 规则）。
  if (entries.length < MIN_ENTRIES) return null;

  const longList = entries.length > LONG_LIST_THRESHOLD;

  return (
    <>
      <div
        className="flex min-h-0 shrink-0 flex-col"
        style={{ width: `${width}px` }}
        data-testid="turn-nav-column"
      >
        <nav
          ref={railRef}
          role="navigation"
          aria-label="轮次导航"
          aria-busy={loadingEarlier || undefined}
          className="min-h-0 flex-1 overflow-y-auto py-1.5"
        >
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
                onClick={() => onJump(entry)}
                // 键盘可达（FR-06：整行 role=button + Enter）：原生 button 在真实
                // 浏览器 Enter/Space 自带激活，显式 onKeyDown 兜底（jsdom 不合成
                // key→click；Space 不拦截防页面滚动歧义，走原生语义）。
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onJump(entry);
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
                  {entry.promptSummary ?? UNLOADED_HINT}
                </span>
              </button>
            );
          })}
        </nav>
      </div>
      {/* 右缘拖宽把手（side 默认 left = 把手在列右缘，拖右增宽；双击复位默认）。 */}
      <PanelResizer
        width={width}
        onWidthChange={setWidth}
        defaultWidth={TURN_NAV_WIDTH_DEFAULT}
        minWidth={TURN_NAV_WIDTH_MIN}
        maxWidth={TURN_NAV_WIDTH_MAX}
        ariaLabel="调整轮次导航宽度"
        testId="turn-nav-resizer"
      />
    </>
  );
}

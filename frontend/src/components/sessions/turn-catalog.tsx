"use client";

/**
 * task-02（2026-09-08-session-turn-nav / FR-01 FR-02 FR-08 / D-003@v2 D-007@v1）：
 * TickRail 轮次刻度轨（ZCode 式）。
 *
 * 形态（design §5/§9，视觉基准 prototype-session-turn-nav.html v3 的
 * .tick-rail / .tick / .tick-flyout）：宽 ~30px 垂直细条，每轮一条 2px 细横杠刻度
 * （刻度组垂直居中——上下伪 spacer 撑开；刻度超出面板高度时 spacer 收缩回落顶对齐 +
 * 轨内 overflow-y-auto 隐藏滚动条，R-10）；hover / 键盘 focus 飞出深色摘要卡
 * （垂直随刻度居中、钳制面板上下各 8px，R-09）；点击刻度 onJump 跳转（跳转/加载
 * 链路在父层，task-03/04）。
 *
 * 受控纯组件（仿 subagent-catalog.tsx 先例）：props 进回调出，不直接操作聊天区
 * DOM / 滚动，不发起网络请求；目录数据由 session-panel-page 派生传入（entries 合并
 * displayTurns + runs，key = realRunId ?? runId 与 data-turn-key 同源）。
 *
 * 约束：颜色全部走主题语义类/主题 CSS 变量（brand 阶、destructive、warning、
 * muted-foreground、foreground、background，随 html data-theme 换肤），不硬编码色值；
 * 未加载空心描边用主题变量 hsl(var(--muted-foreground)/.6)（等价 muted-foreground/60）。
 * antd 不用，轻量自绘 tailwind（与 sessions 组件现有风格一致）。
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { cn } from "@/lib/utils";

export type TurnCatalogEntryStatus =
  | "completed"
  | "failed"
  | "running"
  | "stopped"
  | "pending";

export interface TurnCatalogEntry {
  /** realRunId ?? runId，与聊天区 data-turn-key 同源（task-03 派生约定）。 */
  key: string;
  /** 1 基轮号（runs 全时间定序）。 */
  turnNo: number;
  startedAt: string | null;
  status: TurnCatalogEntryStatus;
  senderName?: string | null;
  /** 已加载/已回填：飞出卡提问摘要；未加载 = undefined。 */
  promptSummary?: string;
  /** 已加载/已回填：正文摘要（首个 text 段截 ~120 字）；未加载 = undefined。 */
  answerSummary?: string;
  /** false → 空心刻度（未加载轮次，点击由父层加载历史后定位）。 */
  loaded: boolean;
}

export interface TurnCatalogProps {
  entries: TurnCatalogEntry[];
  /** 当前轮 key（聊天滚动/跳转联动）：命中的刻度常亮并 aria-current="true"。 */
  activeTurnKey: string | null;
  /** 历史加载进行中（跳转链路翻页时）：轨标注 aria-busy，无额外视觉。 */
  loadingEarlier?: boolean;
  /** 点击刻度回调（携带完整条目；跳转/未加载加载链路由父层实现）。 */
  onJump: (entry: TurnCatalogEntry) => void;
}

/** 飞出卡上下安全边距（design §5/R-09：钳制面板可视范围上下各 8px）。 */
const FLYOUT_EDGE_GAP = 8;
/** aria-label 内提问摘要截断长度（task-02 契约：截 30 字）。 */
const ARIA_PROMPT_MAX = 30;

/** 状态文案映射（task-02 契约：completed→完成 failed→失败 running→运行中 stopped/pending→已停止）。 */
const STATUS_LABEL: Record<TurnCatalogEntryStatus, string> = {
  completed: "完成",
  failed: "失败",
  running: "运行中",
  stopped: "已停止",
  pending: "已停止",
};

/** 超长文本截断（省略号收尾）。 */
function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** startedAt → HH:mm（zh-CN 24 小时制）；null/非法值 → "--:--"。 */
function formatHHmm(startedAt: string | null): string {
  if (!startedAt) return "--:--";
  const d = new Date(startedAt);
  if (Number.isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** 刻度 aria-label：第N轮 · 状态文案（未加载追加「未加载」） · 提问摘要（截 30 字）。 */
function buildAriaLabel(entry: TurnCatalogEntry): string {
  const parts = [
    `第${entry.turnNo}轮`,
    `${STATUS_LABEL[entry.status]}${entry.loaded ? "" : " · 未加载"}`,
  ];
  if (entry.promptSummary) parts.push(truncate(entry.promptSummary, ARIA_PROMPT_MAX));
  return parts.join(" · ");
}

/** 飞出卡 meta 行：HH:mm · 状态 · 发送者（未加载追加尾注，D-005）。 */
function flyoutMeta(entry: TurnCatalogEntry): string {
  const base = `${formatHHmm(entry.startedAt)} · ${STATUS_LABEL[entry.status]} · ${
    entry.senderName ?? "我"
  }`;
  return entry.loaded ? base : `${base} · 未加载 — 点击加载该轮并定位`;
}

/**
 * 飞出卡垂直定位（原型 showFlyout 公式抽纯函数便于单测钳制边界）：
 * 随刻度 offsetTop 垂直居中，钳制在轨可视范围内上下各 8px。
 */
export function computeFlyoutTop(
  tickTop: number,
  railHeight: number,
  cardHeight: number,
): number {
  const half = cardHeight / 2;
  return Math.max(
    FLYOUT_EDGE_GAP,
    Math.min(tickTop - half, railHeight - cardHeight - FLYOUT_EDGE_GAP),
  );
}

/** 触屏（hover:none 匹配）不挂飞出卡逻辑（点击直跳）；jsdom 无 matchMedia 按有 hover 处理。 */
function detectHasHover(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }
  return !window.matchMedia("(hover: none)").matches;
}

export default function TurnCatalog({
  entries,
  activeTurnKey,
  loadingEarlier,
  onJump,
}: TurnCatalogProps): JSX.Element | null {
  /** 是否存在 hover 能力（非触屏）：飞出卡仅在此挂载。 */
  const [hasHover] = useState(detectHasHover);
  /** 当前飞出卡条目 + 刻度序号（null = 隐藏）。 */
  const [flyout, setFlyout] = useState<{ entry: TurnCatalogEntry; index: number } | null>(
    null,
  );
  const [flyoutTop, setFlyoutTop] = useState(FLYOUT_EDGE_GAP);
  const railRef = useRef<HTMLElement | null>(null);
  const flyoutRef = useRef<HTMLDivElement | null>(null);

  /** 飞出卡定位：内容渲染后量测（刻度 offsetTop 居中 + 上下 8px 钳制，R-09）。 */
  useLayoutEffect(() => {
    const rail = railRef.current;
    const card = flyoutRef.current;
    if (!flyout || !rail || !card) return;
    const tick = rail.querySelector<HTMLElement>(`[data-tick-index="${flyout.index}"]`);
    if (!tick) return;
    setFlyoutTop(computeFlyoutTop(tick.offsetTop, rail.clientHeight, card.offsetHeight));
  }, [flyout]);

  // active 刻度变化时滚入轨内可视区（R-10/FR-05）；ref 守卫首次渲染不滚（design §5）。
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const rail = railRef.current;
    if (!activeTurnKey || !rail) return;
    // jsdom 无 scrollIntoView 实现，需 typeof 守卫（session-mention-popover.tsx
    // 同款先例）——task-05 起本组件挂进 desktop 面板，既有 jsdom 套件（未 stub
    // 该 API）的滚动联动即触发本 effect，无守卫会在 commit 期抛 TypeError。
    const tick = rail.querySelector(`[data-tick-key="${CSS.escape(activeTurnKey)}"]`);
    if (tick && typeof tick.scrollIntoView === "function") {
      tick.scrollIntoView({ block: "nearest" });
    }
  }, [activeTurnKey]);

  // hover 委托（原型 rail mouseover/mouseleave 模式）：mouseover 冒泡 + closest
  // 命中刻度；刻度间移动持续更新，离开轨收起。focus 触发见刻度 onFocus。
  const handleRailOver = (e: ReactMouseEvent<HTMLElement>) => {
    const tick = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      "[data-tick-index]",
    );
    if (!tick) return;
    const index = Number(tick.dataset.tickIndex);
    const entry = entries[index];
    if (entry) setFlyout({ entry, index });
  };

  // ql-20260909-005（会话页整洁度二轮）：轮次 < 3 轨道无导航价值，整条隐藏
  // （短会话左侧 30px 占位回收给聊天区）；轮次增长后自动出现。early return 在
  // 全部 hooks 之后（React 规则）。
  if (entries.length < 3) return null;

  return (
    <div className="relative flex-shrink-0 flex">
      <nav
        ref={railRef}
        role="navigation"
        aria-label="轮次刻度导航"
        aria-busy={loadingEarlier || undefined}
        onMouseOver={handleRailOver}
        onMouseLeave={() => setFlyout(null)}
        className="w-[30px] flex flex-col items-center gap-[7px] py-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {/* 上下伪弹性撑块：刻度组垂直居中；刻度超高溢出时收缩到 0 回落顶对齐可滚动 */}
        <span aria-hidden className="flex-1 min-h-0" />
        {entries.map((entry, i) => {
          const isActive = entry.key === activeTurnKey;
          return (
            <button
              key={entry.key}
              type="button"
              data-tick-index={i}
              data-tick-key={entry.key}
              aria-label={buildAriaLabel(entry)}
              aria-current={isActive ? "true" : undefined}
              onClick={() => onJump(entry)}
              onFocus={() => setFlyout({ entry, index: i })}
              className={cn(
                // 基础：14×2px 细横杠（原型 .tick）
                "h-[2px] w-[14px] shrink-0 rounded-full transition-all outline-none",
                // hover / 键盘 focus-visible：放宽 + 品牌色常亮（原型 .tick:hover/:focus-visible）
                "hover:w-[20px] hover:bg-brand-600 hover:opacity-100",
                "focus-visible:w-[20px] focus-visible:bg-brand-600 focus-visible:opacity-100",
                // 状态底色：active > running > failed > 默认（对齐原型 CSS 级联顺序）
                isActive
                  ? "w-[20px] bg-brand-600 opacity-100"
                  : entry.status === "running"
                    ? "bg-warning opacity-100 animate-pulse"
                    : entry.status === "failed"
                      ? "bg-destructive opacity-75"
                      : "bg-muted-foreground opacity-45",
                // 未加载空心（原型 .tick.unloaded：inset 1px 描边无底色，hover 描边转品牌色）
                !entry.loaded &&
                  !isActive &&
                  "bg-transparent shadow-[inset_0_0_0_1px_hsl(var(--muted-foreground)/0.6)] hover:bg-transparent hover:shadow-[inset_0_0_0_1px_var(--color-brand-600)]",
              )}
            />
          );
        })}
        <span aria-hidden className="flex-1 min-h-0" />
      </nav>

      {/* 飞出摘要卡：单例绝对定位（原型 .tick-flyout：深色反转、轨右 40px、宽 300px）；
          触屏（hover:none）不挂载——点击刻度直接 onJump（design §9）。class "show"
          对齐原型可见态命名（实际可见性由 tailwind opacity/translate 过渡承载）。 */}
      {hasHover && (
        <div
          ref={flyoutRef}
          data-testid="tick-flyout"
          style={{ top: flyoutTop }}
          className={cn(
            "pointer-events-none absolute left-10 z-50 w-[300px] rounded-[10px] bg-foreground px-3.5 py-3 text-xs text-background shadow-xl",
            "transition-[opacity,transform] duration-150",
            flyout ? "show translate-y-0 opacity-100" : "-translate-y-1 opacity-0",
          )}
        >
          {flyout && (
            <>
              <div className="line-clamp-2 text-[12.5px] font-semibold leading-[1.55]">
                {flyout.entry.promptSummary
                  ? `${flyout.entry.turnNo} 轮 · ${flyout.entry.promptSummary}`
                  : `${flyout.entry.turnNo} 轮`}
              </div>
              {flyout.entry.answerSummary ? (
                <div className="mt-1 line-clamp-3 opacity-75 leading-[1.55]">
                  {flyout.entry.answerSummary}
                </div>
              ) : null}
              <div className="mt-[7px] text-[10px] opacity-55 leading-[1.55]">
                {flyoutMeta(flyout.entry)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

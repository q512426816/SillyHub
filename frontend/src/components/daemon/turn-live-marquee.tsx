"use client";

/**
 * 2026-10-22-conversation-live-marquee（FR-01~FR-06）：
 * 会话「对话」视图运行中轮次末尾的单行实时活动跑马灯。
 *
 * 目标（用户原话）：让用户感知对话还在真实跑着，不必看清具体内容；
 * 事件一到就进入轨道、有多少刷多少，一直流到最新一条为止，不循环回放。
 *
 * 数据源：现有 `TurnSegment[]`（SSE 实时装配，与「进度」视图同源），
 * 后端 / daemon / API 零改动：
 *   - `deriveLiveMarqueeEntries`：递归收集 process 类段（thinking / tool /
 *     子代理含内部工具 / file / stderr / preamble / compact / compact_status /
 *     user_msg / turn_trigger），跳过 text 答复段（正文已在对话流展示）；
 *     段 id 作唯一键，流式增长的思考、状态翻转的工具只更新原条目不重复入队；
 *   - `TurnLiveMarquee`：单行连续滚动轨道（2026-10-23 用户反馈修订）。
 *     不做"每条停留 N 秒"的逐条轮播，也不复制内容循环——条目按时间顺序
 *     等宽排列，轨道向左移动，**滚到最新一条贴住右侧即停**；新事件到达后
 *     继续向左推进，旧内容滑出、新内容从右进入，始终只向最新流动。
 *     速度按追赶距离自适应（事件越密集流得越快），空档期由容器内低频流光
 *     提供"仍在运行"的感知。组件不可见（IntersectionObserver）或系统开启
 *     减少动态效果时停表；reduced-motion 下静态展示最新一条。
 *
 * 渲染经济性（对齐 turn-status-bar 的先例）：派生 useMemo 只依赖 segments
 * 引用；滚动由单条 rAF 直接写 transform（不走 React 每帧 setState）。
 *
 * 2026-10-23-marquee-item-detail（FR-01~FR-06）单条目细化：
 *   - 图标改 lucide-react 组件（禁止 emoji 字符串）；
 *   - 运行中：右侧 CSS 转圈 + 文本区双份 CSS 横向循环（展示文本不同片段）；
 *   - 完成：停止滚动、截断文本、Timer 图标 + 格式化耗时；
 *   - 工具/子代理用段 startedAt/endedAt 真实差值；thinking 由客户端从首次
 *     观察到 running 计到完成；历史已完成且无数据的不显示（不伪造）。
 */

import {
  AlertTriangle,
  Bell,
  Bot,
  Brain,
  FileText,
  FileUp,
  Info,
  MessageSquare,
  Minimize2,
  Search,
  Sparkles,
  Terminal,
  Timer,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { diffStatFromPatch } from "@/components/agent-log/tool-diff";

import { DiffStatBadge } from "./diff-stat-badge";
import { processLabel } from "./process-labels";
import type { TurnSegment } from "./session-log-assembler";

/**
 * 轨道渲染队列上限（2026-10-23-marquee-queue-window）：只保留最近 12 条，
 * 更早的直接丢弃。12 条约 3 屏上下文，轨道总宽收敛在约 3.3k px——
 * 跑马灯定位是「感知」，完整过程由「进度」视图承担，无需保留长历史。
 */
export const LIVE_MARQUEE_MAX_ENTRIES = 12;
/** 追赶上限（px/s）；距离主导的缓出曲线见 marqueeSpeedForDistance。 */
export const LIVE_MARQUEE_MAX_SPEED = 1600;

/**
 * 轨道推进速度（px/s）——距离主导的缓出曲线（2026-10-23-marquee-motion-polish）：
 * 距离大时加速追赶，接近目标时自然减速；下限 40px/s 防长尾巴，上限沿用 1600。
 */
export function marqueeSpeedForDistance(distance: number): number {
  const d = Math.max(0, distance);
  return Math.min(LIVE_MARQUEE_MAX_SPEED, Math.max(40, d * 0.9));
}

/**
 * 轨道目标位置（2026-10-23-marquee-blank-track-fix）：
 *   - 达到条目上限后的窗口滑动（slideStep != null）：目标**回到 base**（最新条
 *     贴右缘），禁止在旧目标上继续累减——否则长会话每来一条就再推一条宽度，
 *     最终把整条轨道推出视口（只剩状态点与 LIVE）；
 *   - 普通内容增长：只向更负推进，不回滚。
 * 视觉连续由调用方补偿 offset 实现（滑动瞬间右移一条，再平滑滚回 base）。
 */
export function resolveMarqueeTarget(
  base: number,
  previousTarget: number,
  slideStep: number | null,
): number {
  if (slideStep != null) return base;
  return Math.min(previousTarget, base);
}
/** 单条摘要截断长度（用户不需要看清全文，单行不撑破）。 */
const CLIP_LENGTH = 64;

export type LiveMarqueeIcon =
  | "thinking"
  | "command"
  | "edit"
  | "search"
  | "tool"
  | "subagent"
  | "file"
  | "stderr"
  | "system"
  | "compact"
  | "user"
  | "wakeup"
  // 2026-10-23-marquee-awaiting-indicator：LLM 生成间隙的合成「等待模型响应」条目。
  | "awaiting";

export interface LiveMarqueeEntry {
  /** 段 id（子代理内部段带父路径前缀，保证树内唯一）。 */
  id: string;
  icon: LiveMarqueeIcon;
  text: string;
  status: "running" | "done" | "failed" | "neutral";
  /** 段真实开始/结束时刻（tool/subagent 可得；thinking 只有开始 ts）。 */
  startedAt: number | null;
  endedAt: number | null;
  /** 服务端权威时长（仅 startedAt/endedAt 均可信时有值）。 */
  durationMs: number | null;
  /**
   * 2026-10-29-edit-diff-stat-badge（FR-01/FR-03）：Edit/Write 完成态条目的
   * diff 统计（+新增/-删除行数）。仅 status=ok 且段携带 editPatch、解析出
   * 非零统计时派生；其余（运行中/失败/无数据/解析失败）恒 null 不渲染。
   * 可选字段：非 tool 分支（thinking/file 等条目）不构造，消费侧判空。
   */
  diffStat?: { added: number; removed: number } | null;
}

/** 项目 UI 图标（lucide 单色，禁止 emoji 字符串充数）。 */
const ICON_COMPONENTS: Record<LiveMarqueeIcon, LucideIcon> = {
  thinking: Brain,
  command: Terminal,
  edit: FileText,
  search: Search,
  tool: Wrench,
  subagent: Bot,
  file: FileUp,
  stderr: AlertTriangle,
  system: Info,
  compact: Minimize2,
  user: MessageSquare,
  wakeup: Bell,
  awaiting: Sparkles,
};

/** processLabel 类别 → 图标枚举（工具七类词表语义保留）。 */
function toolIconOf(label: string): LiveMarqueeIcon {
  switch (label) {
    case "运行命令":
      return "command";
    case "读写文件":
      return "edit";
    case "搜索":
      return "search";
    case "失败":
      return "stderr";
    default:
      return "tool";
  }
}

/** 耗时格式化：<1s 显示毫秒、<60s 显示一位小数秒、更长显示 m ss。 */
export function formatMarqueeDuration(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  if (safe < 1000) return `${safe}ms`;
  if (safe < 60_000) {
    const seconds = safe / 1000;
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(safe / 60_000);
  const rest = Math.round((safe % 60_000) / 1000);
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
}

/** 段真实时长：两端齐全且顺序合理才算，否则 null（不伪造）。 */
function segmentDuration(
  startedAt: number | null | undefined,
  endedAt: number | null | undefined,
): number | null {
  if (startedAt == null || endedAt == null) return null;
  const diff = endedAt - startedAt;
  return diff >= 0 ? diff : null;
}

/** 空白归一（不截断）：thinking 全文流动展示用。 */
function normalizeText(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** 单行摘要归一：折叠空白 + 截断（与 status-bar summarizeText 同口径）。 */
function clip(text: string | null | undefined, max = CLIP_LENGTH): string {
  const t = normalizeText(text);
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 工具短名：mcp__<server>__<tool> 取末段（与 processLabel 匹配口径一致）。 */
function toolBaseName(toolName: string | null): string {
  if (!toolName) return "工具";
  return toolName.split("__").pop() || toolName;
}

function toolEntryStatus(status: "running" | "ok" | "deny"): LiveMarqueeEntry["status"] {
  if (status === "running") return "running";
  return status === "deny" ? "failed" : "done";
}

/** 压缩过程段 JSON 载荷（phase=compacting/success/failed），解析失败按进行中。 */
function compactStatusOf(text: string): "compacting" | "success" | "failed" {
  try {
    const parsed = JSON.parse(text) as { phase?: unknown };
    return parsed.phase === "success" || parsed.phase === "failed"
      ? parsed.phase
      : "compacting";
  } catch {
    return "compacting";
  }
}

function collectEntries(
  segments: TurnSegment[],
  out: LiveMarqueeEntry[],
  prefix = "",
): void {
  for (const seg of segments) {
    switch (seg.kind) {
      case "text":
        // 答复正文不进跑马灯（对话流已完整展示，避免重复刷屏）。
        break;
      case "thinking":
        out.push({
          id: `${prefix}${seg.id}`,
          icon: "thinking",
          // 2026-10-23-marquee-thinking-fulltext（FR-01）：思考保留全文（仅折叠
          // 空白），运行中在条目窗口内完整流动；完成态由渲染层单行截断。
          text: normalizeText(seg.text) || "正在思考…",
          status: seg.streaming ? "running" : "done",
          startedAt: seg.ts,
          endedAt: null,
          durationMs: null,
        });
        break;
      case "tool": {
        const isSubagent = seg.children.length > 0;
        const label = processLabel("tool", seg.toolName, seg.status);
        const primary = clip(seg.primary, 44);
        // 2026-10-29-edit-diff-stat-badge（FR-03/FR-04）：仅完成（ok）且携带
        // structuredPatch 的工具段派生统计；运行中（patch 未配对）与 deny 门控
        // 不出，解析失败/零改动由 diffStatFromPatch 归一为 null（不伪造）。
        const diffStat =
          seg.status === "ok" && seg.editPatch
            ? diffStatFromPatch(seg.editPatch)
            : null;
        out.push({
          id: `${prefix}${seg.id}`,
          icon: isSubagent ? "subagent" : toolIconOf(label.label),
          text: isSubagent
            ? `子代理 · ${toolBaseName(seg.toolName)}${primary ? ` ${primary}` : ""}`
            : `${label.label} · ${toolBaseName(seg.toolName)}${primary ? ` ${primary}` : ""}`,
          status: toolEntryStatus(seg.status),
          startedAt: seg.startedAt,
          endedAt: seg.endedAt,
          durationMs: segmentDuration(seg.startedAt, seg.endedAt),
          diffStat,
        });
        // 2026-10-25-marquee-subagent-outer-only（FR-01）：子代理内部消息不再
        // 进入外部轨道（用户裁决：外部只显示容器条目，内部消息留在对话流
        // 的子代理卡片 SubagentBlockView 内展示——该路径零改动）。
        break;
      }
      case "subagent_stub":
        out.push({
          id: `${prefix}${seg.id}`,
          icon: "subagent",
          text: `子代理 · ${clip(seg.subagentType ?? "子代理", 40)}`,
          status: seg.orphaned ? "failed" : "running",
          startedAt: null,
          endedAt: null,
          durationMs: null,
        });
        break;
      case "stderr":
        out.push({
          id: `${prefix}${seg.id}`,
          icon: "stderr",
          text: `警告 · ${clip(seg.text, 56) || "输出异常"}`,
          status: "failed",
          startedAt: null,
          endedAt: null,
          durationMs: null,
        });
        break;
      case "file":
        out.push({
          id: `${prefix}${seg.id}`,
          icon: "file",
          text: `文件 · ${clip(seg.name, 40)}`,
          status: "done",
          startedAt: null,
          endedAt: null,
          durationMs: null,
        });
        break;
      case "preamble":
        out.push({
          id: `${prefix}${seg.id}`,
          icon: "system",
          text: `上下文 · ${clip(seg.text, 40)}`,
          status: "neutral",
          startedAt: null,
          endedAt: null,
          durationMs: null,
        });
        break;
      case "compact":
        out.push({
          id: `${prefix}${seg.id}`,
          icon: "compact",
          text: "上下文已重新压缩",
          status: "done",
          startedAt: null,
          endedAt: null,
          durationMs: null,
        });
        break;
      case "compact_status": {
        const phase = compactStatusOf(seg.text);
        out.push({
          id: `${prefix}${seg.id}`,
          icon: "compact",
          text:
            phase === "success"
              ? "上下文压缩完成"
              : phase === "failed"
                ? "上下文压缩失败"
                : "正在重新压缩上下文",
          status:
            phase === "compacting" ? "running" : phase === "failed" ? "failed" : "done",
          startedAt: null,
          endedAt: null,
          durationMs: null,
        });
        break;
      }
      case "user_msg":
        out.push({
          id: `${prefix}${seg.id}`,
          icon: "user",
          text: `引导 · ${clip(seg.text, 56)}`,
          status: "neutral",
          startedAt: null,
          endedAt: null,
          durationMs: null,
        });
        break;
      case "turn_trigger":
        out.push({
          id: `${prefix}${seg.id}`,
          icon: "wakeup",
          text: `唤醒 · ${clip(seg.text, 56)}`,
          status: "neutral",
          startedAt: null,
          endedAt: null,
          durationMs: null,
        });
        break;
    }
  }
}

/**
 * 段序列 → 单行跑马灯条目（纯函数，无 React 依赖）。
 *
 * 顺序 = 段文档序（与「进度」视图时间线同源）；同 id 段只保留一条；
 * 超过 LIVE_MARQUEE_MAX_ENTRIES 截断最旧。
 */
export function deriveLiveMarqueeEntries(
  segments: TurnSegment[],
): LiveMarqueeEntry[] {
  const out: LiveMarqueeEntry[] = [];
  collectEntries(segments, out);
  return out.length > LIVE_MARQUEE_MAX_ENTRIES
    ? out.slice(out.length - LIVE_MARQUEE_MAX_ENTRIES)
    : out;
}

/** 系统「减少动态效果」偏好（SSR 首帧 false，挂载后校正）。 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    // Safari 14 之前只有 addListener（项目支持面以现代浏览器为主，防御式兜底）。
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);
  return reduced;
}

/** 状态点颜色：运行中 brand / 完成 emerald / 失败 destructive / 中性灰。 */
function dotClass(status: LiveMarqueeEntry["status"]): string {
  switch (status) {
    case "running":
      return "bg-brand-500";
    case "done":
      return "bg-emerald-500";
    case "failed":
      return "bg-destructive";
    default:
      return "bg-muted-foreground/40";
  }
}

/** 条目内部一次性滚动速度（px/s）；全文滚到最后一个字符即停。 */
const TICKER_SPEED = 220;

/**
 * ticker 终点（2026-10-23-marquee-thinking-fulltext / FR-02）：
 * 文本末尾贴住窗口右缘（<=0）；文本不溢出窗口时为 0。
 * 规则：一次滚到最后一个字符即停，**不循环**；完成态回到开头截断显示。
 */
export function marqueeTickerEnd(textWidth: number, viewWidth: number): number {
  return Math.min(0, viewWidth - textWidth);
}

/**
 * 单条目视图（FR-01~FR-05）：固定 lucide 图标 + 文本区 + 状态/耗时区。
 *   - running：文本从开头一次向左滚到当前最后一个字符；流式思考持续增长时
 *     跟随新末尾继续滚（落后越多越快），不循环；
 *   - 完成：停止滚动，回到开头单份截断，右侧 Timer 图标 + 耗时；
 *   - reduced-motion：不滚动、不转圈，静态截断；
 * 只有文本区参与滚动，图标与耗时区固定。
 */
function MarqueeItemView({
  entry,
  durationMs,
  reduced,
  fixedWidth = true,
  testId = "marquee-item",
  runningElapsedMs,
}: {
  entry: LiveMarqueeEntry;
  durationMs: number | null;
  reduced: boolean;
  fixedWidth?: boolean;
  testId?: string;
  /** 运行中已耗时（FR-02/FR-03，2026-10-25-marquee-subagent-outer-only）；无起点为 null（只转圈）。 */
  runningElapsedMs?: number | null;
}) {
  const running = entry.status === "running";
  const Icon = ICON_COMPONENTS[entry.icon];
  const tickerWindowRef = useRef<HTMLSpanElement | null>(null);
  const tickerTextRef = useRef<HTMLSpanElement | null>(null);
  const tickerOffsetRef = useRef(0);
  const tickerEndRef = useRef(0);
  const tickerRafRef = useRef<number | null>(null);

  const stopTicker = useCallback(() => {
    if (tickerRafRef.current !== null) {
      cancelAnimationFrame(tickerRafRef.current);
      tickerRafRef.current = null;
    }
  }, []);

  /** 起排：向终点滚动，到达最后一个字符即停（不循环）。 */
  const ensureTickerScroll = useCallback(() => {
    if (!running || reduced || tickerRafRef.current !== null) return;
    const text = tickerTextRef.current;
    if (!text) return;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(80, now - last);
      last = now;
      const end = tickerEndRef.current;
      const distance = tickerOffsetRef.current - end;
      if (distance > 0) {
        // 跟随流式输出：落后越多滚得越快，避免永远追不上新增长的内容。
        const speed = Math.min(900, Math.max(TICKER_SPEED, distance * 1.5));
        tickerOffsetRef.current = Math.max(
          end,
          tickerOffsetRef.current - (speed * dt) / 1000,
        );
        text.style.transform = `translate3d(${tickerOffsetRef.current}px, 0, 0)`;
        tickerRafRef.current = requestAnimationFrame(step);
      } else {
        // 当前文本末尾已到达；思考若继续增长，文本变化 effect 会再次起排。
        tickerRafRef.current = null;
      }
    };
    tickerRafRef.current = requestAnimationFrame(step);
  }, [running, reduced]);

  // 测量文本/窗口宽度 → 更新终点；文本流式增长时终点变远，继续滚。
  useEffect(() => {
    if (!running || reduced) return;
    const text = tickerTextRef.current;
    const win = tickerWindowRef.current;
    if (!text || !win) return;
    const update = () => {
      tickerEndRef.current = marqueeTickerEnd(text.scrollWidth, win.clientWidth);
      ensureTickerScroll();
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(text);
    observer.observe(win);
    return () => observer.disconnect();
  }, [running, reduced, ensureTickerScroll]);

  // 流式思考持续增长：每次文本变化重新测量终点并继续滚（不重置位置），
  // 直到思考结束（status 变为 done 后切换到开头截断展示）。
  useEffect(() => {
    if (!running || reduced) return;
    const text = tickerTextRef.current;
    const win = tickerWindowRef.current;
    if (!text || !win) return;
    tickerEndRef.current = marqueeTickerEnd(text.scrollWidth, win.clientWidth);
    ensureTickerScroll();
  }, [entry.text, running, reduced, ensureTickerScroll]);

  // 新条目从开头开始；卸载/完成后停排。文本增长（同 id）不重置位置。
  useEffect(() => {
    tickerOffsetRef.current = 0;
    if (tickerTextRef.current) {
      tickerTextRef.current.style.transform = "translate3d(0, 0, 0)";
    }
    ensureTickerScroll();
    return stopTicker;
  }, [entry.id, ensureTickerScroll, stopTicker]);

  return (
    <span
      data-testid={testId}
      data-status={entry.status}
      className={cn(
        "flex items-center gap-1.5",
        fixedWidth ? "w-[16rem] shrink-0" : "min-w-0 flex-1",
      )}
    >
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span
        ref={tickerWindowRef}
        className={cn(
          "relative min-w-0 flex-1 overflow-hidden",
          // 运行中滚动窗口左右渐隐；完成态截断文本不加，保持清晰。
          running && !reduced && "sh-live-marquee-window",
        )}
      >
        {running && !reduced ? (
          <span
            ref={tickerTextRef}
            data-testid="marquee-ticker"
            className="sh-live-marquee-ticker inline-block whitespace-nowrap font-medium text-foreground"
          >
            {entry.text}
          </span>
        ) : (
          <span className="block truncate font-medium text-foreground" title={entry.text}>
            {entry.text}
          </span>
        )}
      </span>
      {running ? (
        <span className="flex shrink-0 items-center gap-1">
          <span
            aria-hidden
            data-testid="marquee-spinner"
            className={cn(
              "h-3 w-3 shrink-0 rounded-full border-2 border-primary/25 border-t-primary",
              !reduced && "animate-spin",
            )}
          />
          {runningElapsedMs != null && (
            <span
              data-testid="marquee-running-elapsed"
              className="flex items-center gap-0.5 text-[10.5px] tabular-nums text-muted-foreground"
            >
              <Timer aria-hidden className="h-3 w-3" />
              {formatMarqueeDuration(runningElapsedMs)}
            </span>
          )}
        </span>
      ) : (
        <>
          {/* 2026-10-29-edit-diff-stat-badge（FR-01）：Edit/Write 完成态条目
              尾部 diff 统计（+N 绿/-M 红），位于耗时区之前；仅 ok 且解析出
              非零统计的条目携带（派生层门控），其余条目不渲染。 */}
          {entry.diffStat != null && (
            <DiffStatBadge
              added={entry.diffStat.added}
              removed={entry.diffStat.removed}
            />
          )}
          {durationMs != null && (
            <span
              data-testid="marquee-duration"
              className="flex shrink-0 items-center gap-0.5 text-[10.5px] text-muted-foreground"
            >
              <Timer aria-hidden className="h-3 w-3" />
              <span className="tabular-nums">{formatMarqueeDuration(durationMs)}</span>
            </span>
          )}
        </>
      )}
    </span>
  );
}

export interface TurnLiveMarqueeProps {
  entries: LiveMarqueeEntry[];
  /**
   * 测试注入：强制减少动态效果（true=静态展示最新条）。
   * 缺省走系统 matchMedia 偏好。
   */
  reducedMotion?: boolean;
  /**
   * 布局变体（2026-10-25-subagent-card-unify-panel / FR-05）：
   *   - bar（默认）：会话对话视图轮尾的独立胶囊条（ml-9 / 52rem 限宽 / 圆角胶囊）；
   *   - inline：子代理卡片内嵌（w-full / 更低矮 / 贴卡片 indigo 底色）。
   */
  layout?: "bar" | "inline";
  /**
   * 手机端窄视口分支（2026-10-26-mobile-four-page-layout-fix / FR-01，默认 false）。
   * true 时隐藏右缘 LIVE 徽标（480px 视口省 ~30px 宽给轨道）；缺省 desktop 零变化。
   * 宽度基准修正（ml-9 与 w 的 100% 基准叠加溢出 36px）不分支——desktop 窄窗口同受益。
   */
  mobile?: boolean;
  /** 根节点 data-testid（缺省 turn-live-marquee；inline 场景用独立 id 消歧）。 */
  testId?: string;
  /**
   * 宿主是否仍在进行（2026-10-25-marquee-inactive-awaiting-fix / FR-01，默认 true）。
   * false = 宿主已终态（如已完成的子代理卡片）：不追加「等待模型响应」合成条目、
   * 等待计时不启动——等待指示只属于仍在运行的宿主。
   */
  active?: boolean;
  /**
   * 最后事件的服务端毫秒时间戳（2026-10-25-marquee-awaiting-real-data / FR-01）。
   * 等待计时起点优先取它（Date.now() - lastEventAt）——刷新/中途打开后等待时长
   * 继续累计不重置；缺省回退客户端首次观察起点。
   */
  lastEventAt?: number | null;
  /**
   * 本轮累计 token（FR-02；来自 tokens 事件实时更新的轮级 inputTokens/outputTokens）。
   * 等待条目回显「↑输入 ↓输出」；两值皆 null / 缺省不显示 token 段。
   */
  turnTokens?: { input: number | null; output: number | null } | null;
}

/**
 * 单行实时活动跑马灯（FR-01~FR-06）。
 *
 * 组件自身不判断轮次状态——「仅运行中轮次渲染」由消费方门控
 * （turn-timeline 的 SegmentedTurnBody），保证状态语义只有一个来源。
 */
export const TurnLiveMarquee = memo(function TurnLiveMarquee({
  entries,
  reducedMotion,
  layout = "bar",
  mobile = false,
  testId,
  active = true,
  lastEventAt,
  turnTokens,
}: TurnLiveMarqueeProps) {
  const prefersReduced = usePrefersReducedMotion();
  const reduced = reducedMotion ?? prefersReduced;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  /** 轨道当前左移距离（<=0）；target 为「最新条贴住右缘」的位置。 */
  const offsetRef = useRef(0);
  const targetRef = useRef(0);
  const initializedRef = useRef(false);
  /** 上一次渲染的首条 id：识别「达到上限后窗口滑动淘汰最旧」的瞬间。 */
  const prevFirstIdRef = useRef<string | null>(null);
  const [visible, setVisible] = useState(true);
  const [ready, setReady] = useState(false);
  /** 无段真实时长的条目（thinking 等）客户端计时：id → 首次观察 running 的时刻。 */
  const runtimeStartsRef = useRef(new Map<string, number>());
  /** 已完成条目的客户端时长快照（仅无服务端时长时写入）。 */
  const [runtimeDurations, setRuntimeDurations] = useState<Record<string, number>>({});

  /** 滚动循环句柄（null=未在跑）：追平即停排，target 更新/恢复可见时重启
   *（2026-10-23-review-risk-fixes-2：旧形态 step 在追平分支外无条件续排，
   * 可见且追平后仍 ~60fps 空转至轮终态卸载）。 */
  const rafRef = useRef<number | null>(null);
  /** visible 的 ref 镜像——ensureScroll 从 applyTarget 回调侧免陈闭包读取。 */
  const visibleRef = useRef(visible);
  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  const stopScroll = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  /** 起排（未在跑时）：追向「最新条贴右缘」的目标；到达即停，不循环、不回跳。 */
  const ensureScroll = useCallback(() => {
    if (reduced || !visibleRef.current) return;
    if (rafRef.current !== null) return; // 循环已在跑
    const track = trackRef.current;
    if (!track) return;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(80, now - last);
      last = now;
      const target = targetRef.current;
      const distance = offsetRef.current - target;
      if (distance > 0.5) {
        // 距离主导的缓出：追近时减速，事件密集时加速追赶（2026-10-23-marquee-motion-polish）。
        const speed = marqueeSpeedForDistance(distance);
        const delta = Math.min(distance, (speed * dt) / 1000);
        offsetRef.current -= delta;
        if (offsetRef.current - target < 0.5) offsetRef.current = target;
        track.style.transform = `translate3d(${offsetRef.current}px, 0, 0)`;
        rafRef.current = requestAnimationFrame(step); // 只有仍在追才续排
      } else {
        rafRef.current = null; // 追平停排；applyTarget/恢复可见时再重启
      }
    };
    rafRef.current = requestAnimationFrame(step);
  }, [reduced]);

  const latest = entries.length > 0 ? entries[entries.length - 1]! : null;

  // 2026-10-23-marquee-awaiting-indicator（FR-01~FR-03）：LLM 生成间隙指示。
  // 组件仅在运行中轮次被消费方渲染，因此「最新真实条目非 running」即可判定
  // 处于「工具已完成、下一段未到」的等待态——追加合成「等待模型响应」条目，
  // 计时每秒递增；新事件到达/回到 running 即消失并清零（渲染层拼接，不进
  // entries / 计时 Map / 窗口滑动检测）。
  const awaitingSinceRef = useRef<number | null>(null);
  const [awaitingElapsedMs, setAwaitingElapsedMs] = useState(0);
  // 数值段（时长/token）挂载后渲染——SSR/水合首帧只渲染骨架文案，避免
  // Date.now 派生值的服务端/客户端不一致（同 runningElapsed 的 elapsedMounted 门控）。
  const [awaitingMounted, setAwaitingMounted] = useState(false);
  useEffect(() => {
    setAwaitingMounted(true);
  }, []);
  // 等待条目仅在宿主仍在进行时出现（终态卡片不得假等——FR-01）。
  const isAwaiting = active && latest != null && latest.status !== "running";
  const awaitingKey = `${latest?.id ?? "none"}:${latest?.status ?? "none"}`;

  // 2026-10-25-marquee-awaiting-real-data（FR-01）：等待起点优先最后事件的
  // 服务端时间戳——刷新/中途打开后等待时长继续累计不重置；缺省回退客户端
  // 首次观察起点（旧数据/无时间戳）。
  const awaitingAnchor = (): number | null =>
    lastEventAt ?? awaitingSinceRef.current ?? null;

  useEffect(() => {
    if (isAwaiting) {
      // 新的已完成条目到达（latest.id 变化）= 新间隙开始，客户端兜底起点重记。
      awaitingSinceRef.current = Date.now();
      const anchor = awaitingAnchor();
      setAwaitingElapsedMs(anchor != null ? Math.max(0, Date.now() - anchor) : 0);
    } else {
      awaitingSinceRef.current = null;
    }
    // awaitingAnchor 读 lastEventAt / ref——不进依赖（ref 可变引用），lastEventAt
    // 变化即新事件到达，isAwaiting/awaitingKey 随之翻转触发本 effect。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAwaiting, awaitingKey, lastEventAt]);

  useEffect(() => {
    if (!isAwaiting) return;
    const timer = window.setInterval(() => {
      const anchor = awaitingAnchor();
      if (anchor != null) setAwaitingElapsedMs(Math.max(0, Date.now() - anchor));
    }, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAwaiting, awaitingKey, lastEventAt]);

  // FR-02：本轮累计 token 段（tokens 事件实时更新；两值皆 null 不显示——旧 daemon/早期）。
  const tokenSuffix =
    turnTokens != null && (turnTokens.input != null || turnTokens.output != null)
      ? ` · ↑${(turnTokens.input ?? 0).toLocaleString("zh-CN")} ↓${(turnTokens.output ?? 0).toLocaleString("zh-CN")}`
      : "";
  const awaitingEntry: LiveMarqueeEntry | null =
    isAwaiting && latest != null
      ? {
          id: "marquee-awaiting",
          icon: "awaiting",
          // 数值段挂载后渲染（awaitingMounted）：SSR 首帧骨架，客户端水合后填时长/token。
          text: awaitingMounted
            ? `等待模型响应 · ${formatMarqueeDuration(awaitingElapsedMs)}${tokenSuffix}`
            : "等待模型响应…",
          status: "running",
          startedAt: null,
          endedAt: null,
          durationMs: null,
        }
      : null;
  const displayEntries = awaitingEntry != null ? [...entries, awaitingEntry] : entries;

  // 2026-10-25-marquee-subagent-outer-only（FR-02/FR-03）：运行中条目走秒计时。
  // 起点：段 startedAt（挂钟，attach 场景为真实已运行时长）优先，缺省用组件
  // 首次观察到 running 的客户端时刻；两者皆无 → 只转圈不显示时间（不伪造）。
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [elapsedMounted, setElapsedMounted] = useState(false);
  const hasRunning = entries.some((entry) => entry.status === "running");
  useEffect(() => {
    setElapsedMounted(true);
  }, []);
  useEffect(() => {
    if (!hasRunning && !isAwaiting) return;
    const timer = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasRunning, isAwaiting]);

  const runningElapsedFor = (entry: LiveMarqueeEntry): number | null => {
    if (entry.status !== "running" || entry.id === "marquee-awaiting") return null;
    if (!elapsedMounted) return null;
    const startedAt =
      entry.startedAt ?? runtimeStartsRef.current.get(entry.id) ?? null;
    return startedAt != null ? Math.max(0, nowTs - startedAt) : null;
  };

  /**
   * 计算目标位置：内容右端贴视口右缘（即显示最新条）；内容不满一屏时 0。
   * 首次测量直接定位（打开即看到最新），之后只向更负的方向推进，不回滚。
   *
   * @param slideByOne 达到条目上限后窗口滑动（淘汰最旧/追加最新）时为 true：
   *   内容整体左移一条。先把 offset 右移一条抵消视觉跳变，再平滑滚回 base
   *   （2026-10-23-marquee-blank-track-fix：目标禁止在旧值上累减，否则长会话
   *   会把轨道永久推出视口变成空白条）。
   */
  const applyTarget = useCallback((slideByOne = false) => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;
    const base = Math.min(0, viewport.clientWidth - track.scrollWidth);
    let slideStep: number | null = null;
    if (slideByOne) {
      const firstItem = track.firstElementChild as HTMLElement | null;
      const gap = Number.parseFloat(getComputedStyle(track).columnGap || "0") || 0;
      slideStep = (firstItem?.offsetWidth ?? 208) + gap;
      // DOM 内容整体左移一条 → offset 右移一条抵消（clamp ≤ 0），保持画面不跳；
      // rAF 随后从补偿位置平滑滚回 base，每次滑动只前进一条、位移不累积。
      offsetRef.current = Math.min(0, offsetRef.current + slideStep);
      if (initializedRef.current) {
        track.style.transform = `translate3d(${offsetRef.current}px, 0, 0)`;
      }
    }
    targetRef.current = resolveMarqueeTarget(base, targetRef.current, slideStep);
    if (!initializedRef.current) {
      initializedRef.current = true;
      offsetRef.current = targetRef.current;
      track.style.transform = `translate3d(${offsetRef.current}px, 0, 0)`;
      setReady(true);
    }
    // target 更新是重启滚动的入口之一（此前停排时新目标到来要能再起排）。
    ensureScroll();
  }, [ensureScroll]);

  // 2026-10-23-marquee-item-detail（FR-03）：无段真实时长的条目（thinking 等）
  // 由客户端计时——首次观察到 running 记起点，观察到完成算差值；挂载时已经
  // 完成的条目没有起点 → 不显示耗时（宁缺勿假）。
  useEffect(() => {
    const starts = runtimeStartsRef.current;
    const now = Date.now();
    const finished: Record<string, number> = {};
    for (const entry of entries) {
      if (entry.status === "running") {
        if (entry.durationMs == null && !starts.has(entry.id)) {
          starts.set(entry.id, now);
        }
      } else if (entry.status === "done" || entry.status === "failed") {
        const startedAt = starts.get(entry.id);
        starts.delete(entry.id);
        if (startedAt != null && entry.durationMs == null) {
          finished[entry.id] = Math.max(0, now - startedAt);
        }
      }
    }
    // 淘汰/切轮后清掉不在当前条目的起点，避免 Map 无界增长。
    for (const id of starts.keys()) {
      if (!entries.some((entry) => entry.id === id)) starts.delete(id);
    }
    if (Object.keys(finished).length > 0) {
      setRuntimeDurations((prev) => ({ ...prev, ...finished }));
    }
  }, [entries]);

  // entries 变化 / 挂载：重算目标（首帧直接定位到最新；ready 前隐藏防闪）。
  useEffect(() => {
    if (reduced) return;
    const firstId = entries.length > 0 ? entries[0]!.id : null;
    const prevFirstId = prevFirstIdRef.current;
    const slid =
      prevFirstId != null &&
      firstId != null &&
      firstId !== prevFirstId &&
      entries.length >= LIVE_MARQUEE_MAX_ENTRIES;
    prevFirstIdRef.current = firstId;
    applyTarget(slid);
  }, [entries, reduced, applyTarget]);

  // 视口尺寸变化（窗口缩放 / 侧栏开合）时重算目标。
  useEffect(() => {
    if (reduced) return;
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => applyTarget());
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [reduced, applyTarget]);

  // 滚动生命周期：不可见/reduced 暂停（cancel），恢复可见时重启；追平停排后
  // 由 applyTarget（entries/resize 的 target 更新入口）负责再起排。
  useEffect(() => {
    if (reduced || !visible) {
      stopScroll();
      return;
    }
    ensureScroll();
    return stopScroll;
  }, [reduced, visible, ensureScroll, stopScroll]);

  // 可见性暂停（FR-06）：observer 不可用时不报错，默认保持运行。
  useEffect(() => {
    const el = rootRef.current;
    if (el == null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (records) => {
        const record = records[0];
        if (record) setVisible(record.isIntersecting);
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (entries.length === 0 || latest == null) return null;

  const rootTestId = testId ?? "turn-live-marquee";
  const trackTestId = testId != null ? `${testId}-track` : "turn-live-marquee-track";
  const itemTestId = testId != null ? `${testId}-item` : "marquee-item";
  const awaitingTestId = testId != null ? `${testId}-awaiting` : "marquee-awaiting";

  return (
    <div
      ref={rootRef}
      data-testid={rootTestId}
      role="status"
      aria-live="off"
      aria-label="实时活动流"
      className={cn(
        "sh-live-marquee flex items-center gap-2 overflow-hidden text-[12px] leading-none text-muted-foreground",
        layout === "inline"
          ? "h-7 w-full rounded-md border border-indigo-200/60 bg-card/70 px-2.5 text-[11px]"
          // 宽度基准扣自身 ml-9（2.25rem）——原 min(100%,52rem) 的 100% 未扣左边距，
          // 右缘恒溢出 36px（手机端整条被裁的根因；desktop 窄窗口同受益）。
          : "ml-9 h-8 w-[min(calc(100%-2.25rem),52rem)] rounded-full border border-border/70 bg-card px-3 shadow-sm",
      )}
    >
      {/* 运行状态点：运行中脉冲（reduced-motion 时静止）。等待态（合成条目
          running）同样脉冲，保证 LLM 生成间隙仍有运行感知。 */}
      <span aria-hidden className="relative z-10 flex h-2 w-2 shrink-0">
        {!reduced && (latest.status === "running" || awaitingEntry != null) && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-60" />
        )}
        <span
          className={cn(
            "relative inline-flex h-2 w-2 rounded-full",
            dotClass(awaitingEntry != null ? "running" : latest.status),
          )}
        />
      </span>

      {reduced ? (
        // 减少动态效果：静态展示最新一条（等待态优先显示等待条目），不滚动、不转圈。
        <MarqueeItemView
          entry={awaitingEntry ?? latest}
          durationMs={
            awaitingEntry != null
              ? null
              : (latest.durationMs ?? runtimeDurations[latest.id] ?? null)
          }
          runningElapsedMs={awaitingEntry != null ? null : runningElapsedFor(latest)}
          reduced
          fixedWidth={false}
          testId={awaitingEntry != null ? awaitingTestId : itemTestId}
        />
      ) : (
        // 连续轨道：条目按时间顺序等宽排列，向左滚到最新条贴右缘即停。
        <div
          ref={viewportRef}
          className={cn(
            "sh-live-marquee-vp relative z-10 min-w-0 flex-1 overflow-hidden transition-opacity duration-200",
            !ready && "opacity-0",
          )}
        >
          <div
            ref={trackRef}
            data-testid={trackTestId}
            className="flex w-max items-center gap-5 will-change-transform"
          >
            {displayEntries.map((entry) => (
              <MarqueeItemView
                key={entry.id}
                entry={entry}
                durationMs={entry.durationMs ?? runtimeDurations[entry.id] ?? null}
                runningElapsedMs={runningElapsedFor(entry)}
                reduced={false}
                testId={
                  entry.id === "marquee-awaiting" ? awaitingTestId : itemTestId
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* 右缘 LIVE 徽标：mobile 分支隐藏（窄视口省宽给轨道，FR-01）；desktop 照旧。 */}
      {!mobile && (
        <span
          aria-hidden
          className="relative z-10 shrink-0 text-[9px] tracking-[0.12em] text-muted-foreground/50"
        >
          LIVE
        </span>
      )}
    </div>
  );
});

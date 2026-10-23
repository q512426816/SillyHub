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
  Terminal,
  Timer,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

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
  | "wakeup";

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

/** 单行摘要归一：折叠空白 + 截断（与 status-bar summarizeText 同口径）。 */
function clip(text: string | null | undefined, max = CLIP_LENGTH): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
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
          text: clip(seg.text) || "正在思考…",
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
        });
        // 子代理内部工具同样进入流（「全部过程信息」）。
        collectEntries(seg.children, out, `${prefix}${seg.id}/`);
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
        collectEntries(seg.children, out, `${prefix}${seg.id}/`);
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

/**
 * 单条目视图（FR-01~FR-05）：固定 lucide 图标 + 文本区 + 状态/耗时区。
 *   - running：文本双份 CSS 循环滚动，右侧 CSS 转圈；
 *   - 完成：文本单份截断，右侧 Timer 图标 + 耗时（无数据不显示）；
 *   - reduced-motion：不滚动、不转圈，静态截断。
 * 只有文本区参与滚动，图标与耗时区固定。
 */
function MarqueeItemView({
  entry,
  durationMs,
  reduced,
  fixedWidth = true,
}: {
  entry: LiveMarqueeEntry;
  durationMs: number | null;
  reduced: boolean;
  fixedWidth?: boolean;
}) {
  const running = entry.status === "running";
  const Icon = ICON_COMPONENTS[entry.icon];
  return (
    <span
      data-testid="marquee-item"
      data-status={entry.status}
      className={cn(
        "flex items-center gap-1.5",
        fixedWidth ? "w-[16rem] shrink-0" : "min-w-0 flex-1",
      )}
    >
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span
        className={cn(
          "relative min-w-0 flex-1 overflow-hidden",
          // 运行中滚动窗口左右渐隐；完成态截断文本不加，保持清晰。
          running && !reduced && "sh-live-marquee-window",
        )}
      >
        {running && !reduced ? (
          <span className="sh-live-marquee-ticker inline-flex w-max items-center">
            <span className="whitespace-nowrap pr-6 font-medium text-foreground">
              {entry.text}
            </span>
            <span aria-hidden className="whitespace-nowrap pr-6 font-medium text-foreground">
              {entry.text}
            </span>
          </span>
        ) : (
          <span className="block truncate font-medium text-foreground" title={entry.text}>
            {entry.text}
          </span>
        )}
      </span>
      {running ? (
        <span
          aria-hidden
          data-testid="marquee-spinner"
          className={cn(
            "h-3 w-3 shrink-0 rounded-full border-2 border-primary/25 border-t-primary",
            !reduced && "animate-spin",
          )}
        />
      ) : durationMs != null ? (
        <span
          data-testid="marquee-duration"
          className="flex shrink-0 items-center gap-0.5 text-[10.5px] text-muted-foreground"
        >
          <Timer aria-hidden className="h-3 w-3" />
          <span className="tabular-nums">{formatMarqueeDuration(durationMs)}</span>
        </span>
      ) : null}
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

  return (
    <div
      ref={rootRef}
      data-testid="turn-live-marquee"
      role="status"
      aria-live="off"
      aria-label="实时活动流"
      className={cn(
        "sh-live-marquee ml-9 flex h-8 w-[min(100%,52rem)] items-center gap-2 overflow-hidden rounded-full border border-border/70 bg-card px-3 text-[12px] leading-none text-muted-foreground shadow-sm",
      )}
    >
      {/* 运行状态点：运行中脉冲（reduced-motion 时静止）。 */}
      <span aria-hidden className="relative z-10 flex h-2 w-2 shrink-0">
        {!reduced && latest.status === "running" && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-60" />
        )}
        <span
          className={cn("relative inline-flex h-2 w-2 rounded-full", dotClass(latest.status))}
        />
      </span>

      {reduced ? (
        // 减少动态效果：静态展示最新一条，不滚动、不转圈。
        <MarqueeItemView
          entry={latest}
          durationMs={latest.durationMs ?? runtimeDurations[latest.id] ?? null}
          reduced
          fixedWidth={false}
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
            data-testid="turn-live-marquee-track"
            className="flex w-max items-center gap-5 will-change-transform"
          >
            {entries.map((entry) => (
              <MarqueeItemView
                key={entry.id}
                entry={entry}
                durationMs={entry.durationMs ?? runtimeDurations[entry.id] ?? null}
                reduced={false}
              />
            ))}
          </div>
        </div>
      )}

      <span
        aria-hidden
        className="relative z-10 shrink-0 text-[9px] tracking-[0.12em] text-muted-foreground/50"
      >
        LIVE
      </span>
    </div>
  );
});

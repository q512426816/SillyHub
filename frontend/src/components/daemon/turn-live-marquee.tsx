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
 */

import { memo, useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { processLabel } from "./process-labels";
import type { TurnSegment } from "./session-log-assembler";

/**
 * 轨道条目上限：超出只保留最近 200 条（更早的早已滚出视口）。
 * 上限内不做窗口替换，保证"只向最新流、不回跳"。
 */
export const LIVE_MARQUEE_MAX_ENTRIES = 200;
/** 滚动基础速度（px/s）与追赶上限；距离越大越快，事件爆发时能追平。 */
export const LIVE_MARQUEE_BASE_SPEED = 180;
export const LIVE_MARQUEE_MAX_SPEED = 1600;
/** 单条摘要截断长度（用户不需要看清全文，单行不撑破）。 */
const CLIP_LENGTH = 64;

export type LiveMarqueeIcon =
  | "thinking"
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
  /** 单行展示图标（emoji；工具按 processLabel 类别区分）。 */
  glyph: string;
  text: string;
  status: "running" | "done" | "failed" | "neutral";
}

const ICON_GLYPH: Record<LiveMarqueeIcon, string> = {
  thinking: "💭",
  tool: "🔧",
  subagent: "🤖",
  file: "📎",
  stderr: "⚠",
  system: "ℹ",
  compact: "🗜",
  user: "💬",
  wakeup: "🔔",
};

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
          glyph: ICON_GLYPH.thinking,
          text: clip(seg.text) || "正在思考…",
          status: seg.streaming ? "running" : "done",
        });
        break;
      case "tool": {
        const isSubagent = seg.children.length > 0;
        const label = processLabel("tool", seg.toolName, seg.status);
        const primary = clip(seg.primary, 44);
        out.push({
          id: `${prefix}${seg.id}`,
          icon: isSubagent ? "subagent" : "tool",
          glyph: isSubagent ? ICON_GLYPH.subagent : label.icon,
          text: isSubagent
            ? `子代理 · ${toolBaseName(seg.toolName)}${primary ? ` ${primary}` : ""}`
            : `${label.label} · ${toolBaseName(seg.toolName)}${primary ? ` ${primary}` : ""}`,
          status: toolEntryStatus(seg.status),
        });
        // 子代理内部工具同样进入流（「全部过程信息」）。
        collectEntries(seg.children, out, `${prefix}${seg.id}/`);
        break;
      }
      case "subagent_stub":
        out.push({
          id: `${prefix}${seg.id}`,
          icon: "subagent",
          glyph: ICON_GLYPH.subagent,
          text: `子代理 · ${clip(seg.subagentType ?? "子代理", 40)}`,
          status: seg.orphaned ? "failed" : "running",
        });
        collectEntries(seg.children, out, `${prefix}${seg.id}/`);
        break;
      case "stderr":
        out.push({
          id: `${prefix}${seg.id}`,
          icon: "stderr",
          glyph: ICON_GLYPH.stderr,
          text: `警告 · ${clip(seg.text, 56) || "输出异常"}`,
          status: "failed",
        });
        break;
      case "file":
        out.push({
          id: `${prefix}${seg.id}`,
          icon: "file",
          glyph: ICON_GLYPH.file,
          text: `文件 · ${clip(seg.name, 40)}`,
          status: "done",
        });
        break;
      case "preamble":
        out.push({
          id: `${prefix}${seg.id}`,
          icon: "system",
          glyph: ICON_GLYPH.system,
          text: `上下文 · ${clip(seg.text, 40)}`,
          status: "neutral",
        });
        break;
      case "compact":
        out.push({
          id: `${prefix}${seg.id}`,
          icon: "compact",
          glyph: ICON_GLYPH.compact,
          text: "上下文已重新压缩",
          status: "done",
        });
        break;
      case "compact_status": {
        const phase = compactStatusOf(seg.text);
        out.push({
          id: `${prefix}${seg.id}`,
          icon: "compact",
          glyph: ICON_GLYPH.compact,
          text:
            phase === "success"
              ? "上下文压缩完成"
              : phase === "failed"
                ? "上下文压缩失败"
                : "正在重新压缩上下文",
          status:
            phase === "compacting" ? "running" : phase === "failed" ? "failed" : "done",
        });
        break;
      }
      case "user_msg":
        out.push({
          id: `${prefix}${seg.id}`,
          icon: "user",
          glyph: ICON_GLYPH.user,
          text: `引导 · ${clip(seg.text, 56)}`,
          status: "neutral",
        });
        break;
      case "turn_trigger":
        out.push({
          id: `${prefix}${seg.id}`,
          icon: "wakeup",
          glyph: ICON_GLYPH.wakeup,
          text: `唤醒 · ${clip(seg.text, 56)}`,
          status: "neutral",
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
        // 追赶距离越大速度越快：事件密集时加速，稀疏时慢速流动。
        const speed = Math.min(
          LIVE_MARQUEE_MAX_SPEED,
          LIVE_MARQUEE_BASE_SPEED + distance * 1.2,
        );
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
   *   轨道宽度不变但内容整体左移了一条，需额外推进一条宽度，让新条目进入
   *   视口——否则轨道会停在原处、最新事件永远看不见。
   */
  const applyTarget = useCallback((slideByOne = false) => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;
    const base = Math.min(0, viewport.clientWidth - track.scrollWidth);
    // 目标单调不增：内容文本更新不该把已滚过的位置拉回来；窗口滑动时在
    // 上一次目标基础上再推进一条（不能回到 base，否则新条目会瞬间跳入）。
    let next = Math.min(targetRef.current, base);
    if (slideByOne) {
      const firstItem = track.firstElementChild as HTMLElement | null;
      const gap = Number.parseFloat(getComputedStyle(track).columnGap || "0") || 0;
      next -= (firstItem?.offsetWidth ?? 208) + gap;
    }
    targetRef.current = next;
    if (!initializedRef.current) {
      initializedRef.current = true;
      offsetRef.current = next;
      track.style.transform = `translate3d(${next}px, 0, 0)`;
      setReady(true);
    }
    // target 更新是重启滚动的入口之一（此前停排时新目标到来要能再起排）。
    ensureScroll();
  }, [ensureScroll]);

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
        // 减少动态效果：静态展示最新一条，不滚动。
        <>
          <span aria-hidden className="relative z-10 shrink-0 text-[12.5px]">
            {latest.glyph}
          </span>
          <span
            className="relative z-10 min-w-0 flex-1 truncate font-medium text-foreground"
            title={latest.text}
          >
            {latest.text}
          </span>
        </>
      ) : (
        // 连续轨道：条目按时间顺序等宽排列，向左滚到最新条贴右缘即停。
        <div
          ref={viewportRef}
          className={cn(
            "relative z-10 min-w-0 flex-1 overflow-hidden transition-opacity duration-200",
            !ready && "opacity-0",
          )}
        >
          <div
            ref={trackRef}
            data-testid="turn-live-marquee-track"
            className="flex w-max items-center gap-5 will-change-transform"
          >
            {entries.map((entry) => (
              <span
                key={entry.id}
                className="flex w-[13rem] shrink-0 items-center gap-1.5"
              >
                <span aria-hidden className="shrink-0 text-[12.5px]">
                  {entry.glyph}
                </span>
                <span
                  className="min-w-0 flex-1 truncate font-medium text-foreground"
                  title={entry.text}
                >
                  {entry.text}
                </span>
              </span>
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

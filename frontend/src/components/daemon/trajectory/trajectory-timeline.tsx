"use client";

/**
 * 轨迹泳道时间轴（Trajectory swimlane timeline）—— 2026-10-20-session-page-dsh-alignment 档 1（D-024 / D-026）。
 *
 * 形态（三条泳道共用**同一个绝对时间轴**，可缩放 / 可平移）：
 *
 *   [ 输入  ▍     ▍       ▍   ▍        ]  tick（user_input，success token）
 *   [ 模型  ▬▬▬   ▬▬▬    ▬▬▬▬▬  ▬▬     ]  条（模型活动，brand token）
 *   [ 工具    ▬▬   ▬   ▬▬▬▬      ▬▬▬▬ ]  条（工具调用，warning token）
 *   [ 总览  ▏███████████▕            ]  整窗 + 视野刷子（10px）
 *           └──── 共享绝对时间轴（轮边界 1px 竖线）────┘
 *
 * 数据全部来自纯函数 `build-trajectory.ts` 的 `trajectory.lanes`；所有时间↔位置
 * 的数学在 `zoom.ts`（纯函数、可单测），本组件只做三件事：
 *   1. 指针坐标 → `ratio`（`getBoundingClientRect` 量一次轨道宽度）；
 *   2. 把 `zoomAt` / `panView` 的结果存进 `view` 状态；
 *   3. 渲染 `left% = (start - view.start) / (view.end - view.start)`。
 *
 * 交互（全部围绕 `view`，不动 `windowStart/windowEnd`）：
 *   - **滚轮**：以指针所指时刻为锚点缩放，一档 1.15 倍；跨度钳在 [60s, 整窗]。
 *     监听器用 `addEventListener(..., { passive: false })` 注册——React 的
 *     `onWheel` 是 passive 的，`preventDefault` 会被浏览器忽略并刷控制台警告。
 *   - **拖拽**：在泳道空白处按下并移动 = 平移；在条上按下 = 选中（不平移）。
 *     平移量由「按下时的视野 + 相对按下点的位移」算出，因此对同一手势重复应用
 *     是幂等的（不会因为逐帧累计而加速）。
 *   - **双击**：回到整窗；右上角另有 `重置` 按钮（已是整窗时禁用）。
 *   - **总览刷子**：整窗缩略条上的半透明矩形就是当前视野；拖它平移视野，
 *     点刷子外面则把视野中心挪到指针处。
 *   - **命中判定**：条本身可能只有 2px，命中带按 6px 算（`pickSpanAt`）；
 *     重叠时取**中心离指针最近**的那根（真实数据 415 根 tool 条在整窗下必然重叠）。
 *
 * 性能：`wheel` / `pointermove` 都只写 ref + `requestAnimationFrame` 合帧，
 * 一帧最多一次 `setView`；位置换算全部在 `useMemo`（依赖 `view`）里，选中行变化
 * 不会重算几百个百分比。
 *
 * 颜色只用语义 token：input=success / model=brand / tool=warning，三主题
 * （ai-native / blue / dark）随 `html[data-theme]` 自动换肤，无字面色。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

import { cn } from "@/lib/utils";

import type {
  Trajectory,
  TrajectoryLaneKind,
  TrajectorySpan,
} from "./build-trajectory";
import {
  HIT_BAND_PX,
  ZOOM_STEP,
  formatTickLabel,
  formatViewRangeLabel,
  fullWindowSpan,
  panView,
  pickSpanAt,
  ratioAtTime,
  tickTimes,
  viewSpan,
  zoomAt,
  type SpanBand,
  type ViewLimits,
  type ViewWindow,
} from "./zoom";

/** 左侧固定标签栏宽（px）——标签与轨道用同一常量，避免两处漂移。 */
const GUTTER_PX = 44;

/** 每行泳道高（px）与条高（px）：条 7px 居中在 16px 行里，留 4.5px 呼吸。 */
const LANE_HEIGHT_PX = 12;
const BAR_HEIGHT_PX = 7;

/** 总览缩略条高度（px）——刻意压在 10px，视线仍以三条泳道为主。 */
const OVERVIEW_HEIGHT_PX = 10;

/** 轴上的时间刻度数量（5–7 档；整窗 577 分钟取 7 档，缩到 1 分钟后同样 7 档）。 */
const AXIS_TICK_COUNT = 7;

/** 条的最小可点宽度（px）：2px 的条 + 6px 命中带 = `HIT_BAND_PX`。 */
const MIN_BAR_PX = 2;

/** 驾驶手势的位移阈值（px）：小于它算点击，不抑制 click。 */
const DRAG_THRESHOLD_PX = 3;

/** 泳道 → 语义色 / 标签（顺序即渲染顺序：输入、模型、工具）。 */
const LANE_ROWS: Array<{ key: TrajectoryLaneKind; label: string; bar: string }> = [
  { key: "input", label: "输入", bar: "bg-success" },
  { key: "model", label: "模型", bar: "bg-brand-500" },
  { key: "tool", label: "工具", bar: "bg-warning" },
];

/**
 * 模型泳道口径标注（task-12）：
 *   - `observed` → 「真实占用」（每个 attempt 的起止区间，TTFT 见条 title）；
 *   - `approx`   → 「近似（无 TTFT 采样）」（整段非工具空档，见 D-024 / D-026）。
 * 两态互斥：同一时刻只会渲染其中一个文案。
 */
const MODEL_BASIS_LABEL: Record<"observed" | "approx", string> = {
  observed: "真实占用",
  approx: "近似（无 TTFT 采样）",
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function pad2(value: number): string {
  return String(Math.max(0, Math.trunc(value))).padStart(2, "0");
}

/** 时长：`<1s` → ms；`<1min` → 1 位小数秒；否则 `XmYYs`。 */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${pad2(seconds)}s`;
}

export type TrajectoryScaleMode = "duration" | "equal";

export interface TrajectoryTimelineProps {
  trajectory: Trajectory;
  selectedRowId?: string | null;
  onSelectRow?: (_rowId: string) => void;
  /**
   * 时间线投影模式（2026-10-22-trajectory-view-redesign / D-016）：
   * `duration` = 现有真实时间轴（缩放/平移/刷子可用）；`equal` = 只读概览，
   * 条块按出现顺序等宽排列，禁用手势、隐藏时间刻度与轮边界竖线。
   */
  scaleMode?: TrajectoryScaleMode;
  className?: string;
}

interface PlacedSpan {
  span: TrajectorySpan;
  /** 相对**当前视野**的百分比位置（可为负 = 视野左侧之外，靠 overflow 裁掉）。 */
  left: number;
  /** 百分比宽度（可为 0，靠 min-width 兜底）。 */
  width: number;
}

export function TrajectoryTimeline({
  trajectory,
  selectedRowId,
  onSelectRow,
  scaleMode = "duration",
  className,
}: TrajectoryTimelineProps) {
  const equalMode = scaleMode === "equal";
  const { turns, lanes, windowStart, windowEnd, coverage, modelBasis } = trajectory;

  const limits = useMemo<ViewLimits>(
    () => ({ start: windowStart, end: windowEnd }),
    [windowStart, windowEnd],
  );
  const [view, setView] = useState<ViewWindow>(() => ({ start: windowStart, end: windowEnd }));

  // 手势回调在 rAF 里读的是「最新已提交值」，用 ref 镜像一份（不在渲染期依赖闭包）。
  const viewRef = useRef(view);
  viewRef.current = view;
  const limitsRef = useRef(limits);
  limitsRef.current = limits;

  const trackRef = useRef<HTMLDivElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const overviewRef = useRef<HTMLDivElement | null>(null);

  const rafRef = useRef<number | null>(null);
  const zoomPendingRef = useRef<{ steps: number; clientX: number } | null>(null);
  const panPendingRef = useRef<number | null>(null);
  const brushPendingRef = useRef<number | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    view: ViewWindow;
    width: number;
    moved: boolean;
    captured: boolean;
  } | null>(null);
  const brushDragRef = useRef<{
    pointerId: number;
    grabOffsetMs: number;
    fullSpan: number;
  } | null>(null);
  /** 刚平移过 → 吞掉紧随其后的 click（否则拖完会顺手选中一根条）。 */
  const suppressClickRef = useRef(false);

  // 数据集换人（重新 staging 真实导出）时回到整窗。
  useEffect(() => {
    setView({ start: windowStart, end: windowEnd });
  }, [windowStart, windowEnd]);

  useEffect(
    () => () => {
      if (rafRef.current == null) return;
      if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(rafRef.current);
      } else {
        clearTimeout(rafRef.current);
      }
      rafRef.current = null;
    },
    [],
  );

  /** 一帧的合并刷新：缩放 / 平移 / 刷子拖拽各自最多一次 `setView`。 */
  const flush = useCallback(() => {
    rafRef.current = null;

    const zoom = zoomPendingRef.current;
    zoomPendingRef.current = null;
    if (zoom && trackRef.current) {
      const rect = trackRef.current.getBoundingClientRect();
      if (rect.width > 0) {
        // ratio 只取决于布局（轨道宽），与视野无关，可以先算；
        // 锚点时刻必须用「这份更新真正要作用的那份视野」现算——若用 viewRef 里的
        // 已提交值，连续多档时每档都会差一个 span 的 13%，锚点会一路滑走。
        const ratio = clamp01((zoom.clientX - rect.left) / rect.width);
        const factor = Math.pow(ZOOM_STEP, -zoom.steps);
        setView((previous) =>
          zoomAt(
            previous,
            previous.start + ratio * viewSpan(previous),
            factor,
            limitsRef.current,
          ),
        );
      }
    }

    const panDelta = panPendingRef.current;
    panPendingRef.current = null;
    if (panDelta != null) {
      const drag = dragRef.current;
      if (drag && drag.width > 0) {
        // 位移是「相对按下点」的绝对量，基准视野取按下时那一份 → 逐帧重复应用幂等
        // （否则每帧都在上一帧的结果上再挪一次，手感会加速 3–5 倍）。
        const deltaMs = -(panDelta / drag.width) * viewSpan(drag.view);
        setView(panView(drag.view, deltaMs, limitsRef.current));
      }
    }

    const brushTarget = brushPendingRef.current;
    brushPendingRef.current = null;
    if (brushTarget != null) {
      setView((previous) =>
        panView(previous, brushTarget - previous.start, limitsRef.current),
      );
    }
  }, []);

  const scheduleFrame = useCallback(() => {
    if (rafRef.current != null) return;
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      rafRef.current = window.requestAnimationFrame(flush);
    } else {
      // 无 rAF 的环境（老旧 jsdom / SSR 测试）：退化为 16ms 定时器，语义一致。
      rafRef.current = setTimeout(flush, 16) as unknown as number;
    }
  }, [flush]);

  /** 滚轮：非 passive 监听（React 的 onWheel 是 passive，preventDefault 会失效）。 */
  useEffect(() => {
    // 等宽模式为只读概览：不注册滚轮监听，让页面正常滚动（D-016）。
    if (equalMode) return;
    const element = sectionRef.current;
    if (!element || typeof element.addEventListener !== "function") return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // deltaMode: 0=像素 1=行 2=页。统一折算成「档」：一档 ≈ 100 像素。
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      const steps = Math.max(-3, Math.min(3, (event.deltaY * unit) / 100));
      if (!Number.isFinite(steps) || steps === 0) return;
      const previous = zoomPendingRef.current;
      zoomPendingRef.current = {
        steps: (previous?.steps ?? 0) + steps,
        clientX: event.clientX,
      };
      scheduleFrame();
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [scheduleFrame, equalMode]);

  /* ───────────────────────── 位置换算（依赖 view） ───────────────────────── */

  const fullSpan = Math.max(0, windowEnd - windowStart);
  const currentSpan = viewSpan(view);
  const zoomFactor = currentSpan > 0 && fullSpan > 0 ? fullSpan / currentSpan : 1;
  const isFullView = view.start <= windowStart + 0.5 && view.end >= windowEnd - 0.5;

  const placed = useMemo(() => {
    // 等宽模式（D-016）：每条泳道内按出现顺序均分槽位，不参与时间换算。
    if (equalMode) {
      const placeLane = (items: TrajectorySpan[]): PlacedSpan[] => {
        const count = Math.max(1, items.length);
        const slot = 100 / count;
        return items.map((item, index) => ({
          span: item,
          left: index * slot + slot * 0.08,
          width: slot * 0.84,
        }));
      };
      return {
        span: 0,
        input: placeLane(lanes.input),
        model: placeLane(lanes.model),
        tool: placeLane(lanes.tool),
      };
    }
    const span = Math.max(1, viewSpan(view));
    const pct = (at: number) => ((at - view.start) / span) * 100;
    const place = (item: TrajectorySpan): PlacedSpan => {
      const left = pct(item.start);
      const right = pct(item.end);
      return { span: item, left, width: Math.max(0, right - left) };
    };
    return {
      span,
      input: lanes.input.map(place),
      model: lanes.model.map(place),
      tool: lanes.tool.map(place),
    };
  }, [lanes, view, equalMode]);

  /** 轮边界竖线（每轮 start 一条，画在条下面；等宽模式隐藏，D-016）。 */
  const guides = useMemo(
    () =>
      equalMode
        ? []
        : turns.map((turn) => ({
            key: turn.runId,
            left: ratioAtTime(view, turn.startedAt) * 100,
          })),
    [turns, view, equalMode],
  );

  /** 轴刻度：按当前视野等距 7 档，两端落在视野边界；文案随视野重算（见 zoom.ts）。 */
  const axisTicks = useMemo(() => {
    if (equalMode) return [];
    const span = viewSpan(view);
    const total = Math.max(1, span);
    return tickTimes(view.start, view.end, AXIS_TICK_COUNT).map((at, index) => ({
      key: `tick-${index}`,
      left: ((at - view.start) / total) * 100,
      label: formatTickLabel(at, view, fullSpan),
    }));
  }, [view, fullSpan, equalMode]);

  /** 总览刷子：整窗上的视野矩形（百分比）。 */
  const brush = useMemo(() => {
    const full = Math.max(1, fullWindowSpan(limits));
    const left = ((view.start - limits.start) / full) * 100;
    const width = (viewSpan(view) / full) * 100;
    return {
      left: Math.max(0, Math.min(100, left)),
      width: Math.max(0, Math.min(100, width)),
    };
  }, [view, limits]);

  const coveragePct = useMemo(() => {
    const total = Math.max(1, coverage.windowMs);
    const model = Math.round((coverage.modelMs / total) * 100);
    const tool = Math.round((coverage.toolMs / total) * 100);
    return { model, tool, gap: Math.max(0, 100 - model - tool) };
  }, [coverage]);

  /* ───────────────────────── 交互 ───────────────────────── */

  const resetView = useCallback(() => {
    dragRef.current = null;
    brushDragRef.current = null;
    panPendingRef.current = null;
    brushPendingRef.current = null;
    zoomPendingRef.current = null;
    setView({ start: limitsRef.current.start, end: limitsRef.current.end });
  }, []);

  const selectAt = useCallback(
    (laneKey: TrajectoryLaneKind, clientX: number, fallback: PlacedSpan | null) => {
      const rect = trackRef.current?.getBoundingClientRect() ?? null;
      let hit: PlacedSpan | null = null;
      if (rect && rect.width > 0) {
        const items =
          laneKey === "input" ? placed.input : laneKey === "model" ? placed.model : placed.tool;
        const bands: SpanBand<PlacedSpan>[] = items.map((item) => {
          const leftPx = rect.left + (item.left / 100) * rect.width;
          const rightPx = rect.left + ((item.left + item.width) / 100) * rect.width;
          return { span: item, leftPx, rightPx: Math.max(rightPx, leftPx + MIN_BAR_PX) };
        });
        hit = pickSpanAt(bands, clientX, HIT_BAND_PX / 2);
      }
      const chosen = hit ?? fallback;
      if (chosen) onSelectRow?.(chosen.span.rowId);
    },
    [onSelectRow, placed],
  );

  const handleLaneClick = useCallback(
    (laneKey: TrajectoryLaneKind) => (event: ReactMouseEvent<HTMLDivElement>) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      selectAt(laneKey, event.clientX, null);
    },
    [selectAt],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // 等宽模式只读：不进入拖拽平移（D-016）。
      if (equalMode) return;
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      // 条上按下 = 选中（不平移），把拖拽让给 click。
      if (target?.closest('[data-testid="trajectory-bar"]')) return;
      const rect = trackRef.current?.getBoundingClientRect() ?? null;
      if (!rect || rect.width <= 0) return;
      suppressClickRef.current = false;
      // 注意：这里**不** setPointerCapture。捕获会把随后的 click 重定向到捕获元素，
      // 泳道上的 onClick 就永远收不到——「点条外侧的 6px 命中带」会变成死区。
      // 捕获推迟到「真的开始拖」（位移 ≥ 3px）时再做。
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        view: viewRef.current,
        width: rect.width,
        moved: false,
        captured: false,
      };
    },
    [equalMode],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = event.clientX - drag.startX;
      if (Math.abs(delta) >= DRAG_THRESHOLD_PX) drag.moved = true;
      if (drag.moved && !drag.captured) {
        const element = event.currentTarget;
        if (typeof element.setPointerCapture === "function") {
          try {
            element.setPointerCapture(drag.pointerId);
          } catch {
            // 指针已失效：忽略，拖拽仍由普通 pointermove 驱动
          }
        }
        drag.captured = true;
      }
      panPendingRef.current = delta;
      scheduleFrame();
    },
    [scheduleFrame],
  );

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.moved) suppressClickRef.current = true;
    if (!drag.captured) return;
    const element = event.currentTarget;
    if (typeof element.releasePointerCapture === "function") {
      try {
        element.releasePointerCapture(drag.pointerId);
      } catch {
        // 指针已被系统释放：忽略
      }
    }
  }, []);

  const handleBrushPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const element = overviewRef.current;
      const rect = element?.getBoundingClientRect() ?? null;
      if (!element || !rect || rect.width <= 0) return;
      const limitsNow = limitsRef.current;
      const full = Math.max(1, fullWindowSpan(limitsNow));
      const pointerTime =
        limitsNow.start + clamp01((event.clientX - rect.left) / rect.width) * full;
      const current = viewRef.current;
      const span = viewSpan(current) || full;
      const brushLeftPx =
        rect.left + ((current.start - limitsNow.start) / full) * rect.width;
      const brushRightPx =
        rect.left + ((current.end - limitsNow.start) / full) * rect.width;
      const inside =
        event.clientX >= brushLeftPx - 1 &&
        event.clientX <= Math.max(brushRightPx, brushLeftPx + MIN_BAR_PX) + 1;
      brushDragRef.current = {
        pointerId: event.pointerId,
        // 拖刷子保持「指针下的时刻」与刷子左端的相对偏移；点外面则以指针为中心。
        grabOffsetMs: inside ? pointerTime - current.start : span / 2,
        fullSpan: full,
      };
      if (typeof element.setPointerCapture === "function") {
        element.setPointerCapture(event.pointerId);
      }
      brushPendingRef.current = pointerTime - brushDragRef.current.grabOffsetMs;
      scheduleFrame();
    },
    [scheduleFrame],
  );

  const handleBrushPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = brushDragRef.current;
      if (!drag) return;
      const rect = overviewRef.current?.getBoundingClientRect() ?? null;
      if (!rect || rect.width <= 0) return;
      const pointerTime =
        limitsRef.current.start +
        clamp01((event.clientX - rect.left) / rect.width) * drag.fullSpan;
      brushPendingRef.current = pointerTime - drag.grabOffsetMs;
      scheduleFrame();
    },
    [scheduleFrame],
  );

  const handleBrushPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = brushDragRef.current;
    brushDragRef.current = null;
    if (!drag) return;
    const element = event.currentTarget;
    if (typeof element.releasePointerCapture === "function") {
      try {
        element.releasePointerCapture(drag.pointerId);
      } catch {
        // 指针已被系统释放：忽略
      }
    }
  }, []);

  const barTitle = (item: PlacedSpan): string =>
    `${item.span.label} · ${formatDuration(item.span.end - item.span.start)}`;

  return (
    <section
      ref={sectionRef}
      aria-label="轨迹泳道时间轴"
      data-testid="trajectory-timeline"
      data-view-start={Math.round(view.start)}
      data-view-end={Math.round(view.end)}
      data-span-ms={Math.round(currentSpan)}
      data-full-span-ms={Math.round(fullSpan)}
      data-window-start={Math.round(windowStart)}
      data-window-end={Math.round(windowEnd)}
      onDoubleClick={equalMode ? undefined : resetView}
      className={cn("shrink-0 border-b border-border bg-card pb-0.5 pt-0.5", className)}
    >
      {/* ── 说明行（D-017 裁剪：保留 DOM 供既有测试与无障碍文本，视觉隐藏） ── */}
      <div className="hidden flex-wrap items-center gap-x-2 gap-y-0.5 px-3 text-[10.5px] leading-4">
        <span className="font-semibold tracking-wide text-foreground">泳道时间轴</span>
        <span
          data-testid="trajectory-view-range"
          className="font-mono tabular-nums text-muted-foreground"
        >
          {formatViewRangeLabel(view, windowStart, fullSpan)}
        </span>
        <span className="font-mono tabular-nums text-muted-foreground/70">
          ×{zoomFactor < 1.05 ? "1.0" : zoomFactor.toFixed(1)}
        </span>
        <span className="flex items-center gap-2 text-muted-foreground">
          {LANE_ROWS.map((lane) => (
            <span key={lane.key} className="flex items-center gap-1">
              <span aria-hidden className={cn("inline-block h-1.5 w-2.5 rounded-[1px]", lane.bar)} />
              {lane.label}
            </span>
          ))}
        </span>
        <span
          data-testid="trajectory-coverage"
          className="font-mono tabular-nums text-muted-foreground"
          title={`模型 ${formatDuration(coverage.modelMs)} · 工具 ${formatDuration(
            coverage.toolMs,
          )} · 整窗 ${formatDuration(coverage.windowMs)}（并集口径）`}
        >
          模型 {coveragePct.model}% · 工具 {coveragePct.tool}% · 空档 {coveragePct.gap}%
        </span>
        <span
          data-testid="trajectory-model-basis"
          data-basis={modelBasis}
          title={
            modelBasis === "observed"
              ? "模型条按每次 attempt 的起止绘制（单色，TTFT 见条提示）"
              : "无 TTFT / attempt 采样：模型条为整段非工具空档的近似"
          }
          className={cn(
            "rounded border px-1 py-px text-[10px] leading-[13px]",
            modelBasis === "observed"
              ? "border-brand-400/60 bg-brand-500/10 text-brand-600 dark:text-brand-300"
              : "border-border text-muted-foreground",
          )}
        >
          {MODEL_BASIS_LABEL[modelBasis]}
        </span>
        <button
          type="button"
          data-testid="trajectory-reset"
          onClick={resetView}
          disabled={isFullView}
          title="回到整窗（也可双击时间轴）"
          className={cn(
            "rounded border border-border px-1.5 py-px text-[10px] leading-[13px]",
            isFullView
              ? "cursor-default text-muted-foreground/50"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          重置
        </button>
        <span className="ml-auto text-muted-foreground">
          {modelBasis === "observed"
            ? "模型条按 attempt 起止绘制（单色，TTFT 见条提示）"
            : "模型条为近似（非工具时段的思考/答复跨度）"}
          · 竖线＝轮边界 · 共 {turns.length} 轮 · 滚轮缩放 / 拖拽平移 / 双击重置
        </span>
      </div>

      {/* ── 轴（等宽模式不渲染，D-016） ───────────────────────────────────── */}
      {!equalMode && (
      <div className="flex items-end pl-3">
        <span aria-hidden className="shrink-0" style={{ width: GUTTER_PX }} />
        <div className="relative h-[12px] min-w-0 flex-1" data-testid="trajectory-axis">
          {axisTicks.map((tick, index) => (
            <span
              key={tick.key}
              data-testid="trajectory-axis-tick"
              className="absolute top-0 whitespace-nowrap font-mono text-[9.5px] tabular-nums text-muted-foreground"
              style={{
                left: `${tick.left}%`,
                transform:
                  index === 0
                    ? "none"
                    : index === axisTicks.length - 1
                      ? "translateX(-100%)"
                      : "translateX(-50%)",
              }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      </div>
      )}

      {/* ── 三条泳道（共享同一根轴；拖拽平移 / 点击选行） ────────────────── */}
      <div
        className="relative touch-none pl-3"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        data-testid="trajectory-surface"
      >
        {/* 轮边界竖线：位于三条轨道之下，只覆盖轨道区（跳过 44px 标签栏）。 */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0"
          style={{ left: GUTTER_PX + 12 }}
        >
          {guides.map((guide) => (
            <span
              key={guide.key}
              data-testid="trajectory-turn-guide"
              className="absolute inset-y-0 w-px bg-border/70"
              style={{ left: `${guide.left}%` }}
            />
          ))}
        </div>

        {LANE_ROWS.map((lane) => {
          const items =
            lane.key === "input" ? placed.input : lane.key === "model" ? placed.model : placed.tool;
          return (
            <div
              key={lane.key}
              className="relative flex items-center"
              style={{ height: LANE_HEIGHT_PX }}
            >
              <span
                data-testid="trajectory-lane-label"
                data-lane={lane.key}
                title={`${lane.label}（${items.length} 条）`}
                className="shrink-0 select-none text-[10px] leading-none text-muted-foreground"
                style={{ width: GUTTER_PX }}
              >
                {lane.label}
                <span className="ml-1 font-mono tabular-nums text-muted-foreground/70">
                  {items.length}
                </span>
              </span>
              <div
                ref={lane.key === "input" ? trackRef : undefined}
                className="relative h-full min-w-0 flex-1 cursor-grab overflow-hidden active:cursor-grabbing"
                data-lane={lane.key}
                data-testid="trajectory-lane"
                onClick={handleLaneClick(lane.key)}
              >
                {items.length === 0 ? (
                  <span
                    aria-hidden
                    className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border/60"
                  />
                ) : null}
                {items.map((item) => {
                  const selected = selectedRowId != null && selectedRowId === item.span.rowId;
                  const title = barTitle(item);
                  return (
                    <button
                      key={item.span.id}
                      type="button"
                      data-testid="trajectory-bar"
                      data-lane={lane.key}
                      data-row-id={item.span.rowId}
                      data-start={item.span.start}
                      data-end={item.span.end}
                      title={title}
                      aria-label={title}
                      aria-pressed={selected}
                      onClick={(event) => {
                        // 条自己也有 click：jsdom 里直接派发到条上（无几何信息时回退自身），
                        // 真实浏览器里再由 `selectAt` 按「中心最近」纠正到正确的那根。
                        event.stopPropagation();
                        if (suppressClickRef.current) {
                          suppressClickRef.current = false;
                          return;
                        }
                        selectAt(lane.key, event.clientX, item);
                      }}
                      className={cn(
                        "absolute top-1/2 -translate-y-1/2 cursor-pointer rounded-[1px] outline-offset-0 transition-opacity",
                        "hover:opacity-100 focus-visible:opacity-100",
                        lane.bar,
                        selected
                          ? "z-[2] opacity-100 outline outline-2 outline-foreground"
                          : "opacity-80",
                      )}
                      style={{
                        left: `${item.left}%`,
                        width: lane.key === "input" ? `${MIN_BAR_PX}px` : `${item.width}%`,
                        minWidth: 2,
                        height: BAR_HEIGHT_PX,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── 总览缩略条（D-017 裁剪：保留 DOM 与刷子逻辑，视觉隐藏） ──────── */}
      <div className="hidden items-center pl-3 pt-0.5" style={{ height: 14 }}>
        <span
          aria-hidden
          className="shrink-0 select-none pr-1 text-right font-mono text-[9px] leading-none text-muted-foreground/70"
          style={{ width: GUTTER_PX }}
        >
          总览
        </span>
        <div
          ref={overviewRef}
          data-testid="trajectory-overview"
          title="总览：拖动色块平移视野；点空白把视野中心移到指针"
          className="relative min-w-0 flex-1 cursor-grab touch-none overflow-hidden rounded-[1px] bg-muted/40 active:cursor-grabbing"
          style={{ height: OVERVIEW_HEIGHT_PX }}
          onPointerDown={handleBrushPointerDown}
          onPointerMove={handleBrushPointerMove}
          onPointerUp={handleBrushPointerUp}
          onPointerCancel={handleBrushPointerUp}
        >
          <span aria-hidden className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
          {turns.map((turn) => (
            <span
              key={turn.runId}
              aria-hidden
              className="absolute inset-y-0 w-px bg-border/50"
              style={{
                left: `${fullSpan > 0 ? clamp01((turn.startedAt - windowStart) / fullSpan) * 100 : 0}%`,
              }}
            />
          ))}
          <span
            data-testid="trajectory-overview-brush"
            className="absolute inset-y-0 rounded-[1px] border border-brand-500/70 bg-brand-500/25"
            style={{
              left: `${brush.left}%`,
              width: `${brush.width}%`,
              minWidth: MIN_BAR_PX,
            }}
          />
        </div>
      </div>
    </section>
  );
}
